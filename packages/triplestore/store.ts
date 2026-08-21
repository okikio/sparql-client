/** Crash-recoverable persistent RDF dataset store. @module */

import {
  Dataset,
  type GraphTermType,
  iterate,
  key,
  type ObjectTermType,
  type PredicateTermType,
  type Quad,
  type SubjectTermType,
} from '@okikio/rdf'
import { parse as parseNQuads, write as writeNQuads } from '@okikio/rdf/nquads'
import {
  type CommitType,
  FORMAT,
  generationName,
  parseCommit,
  parseFormat,
  writeRecord,
} from './format.ts'
import type { FileSystemType } from './storage.ts'

/** Default path used when the caller does not provide an override. */
const DEFAULT_PATH = '/rdf'
/** Default max segment bytes used when the caller does not provide an override. */
const DEFAULT_MAX_SEGMENT_BYTES = 256 * 1024 * 1024
/** Default batch size used when the caller does not provide an override. */
const DEFAULT_BATCH_SIZE = 10_000

/** Persistent store options. */
export interface OpenOptionsType {
  /** Virtual filesystem directory owned by this store. */
  readonly path?: string
  /** Maximum immutable segment bytes accepted during recovery. */
  readonly maxSegmentBytes?: number
  /** Cooperative cancellation for open and recovery. */
  readonly signal?: AbortSignal
}

/** Mutation options shared by durable writes. */
export interface WriteOptionsType {
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/** Streaming import options. */
export interface ImportOptionsType extends WriteOptionsType {
  /** Maximum quads committed in one immutable delta segment. */
  readonly batchSize?: number
}

/** One recovery problem that did not prevent opening an earlier valid generation. */
export interface RecoveryProblemType {
  /** Whether the artifact was an incomplete publication or a corrupt committed generation. */
  readonly kind: 'incomplete-commit' | 'corrupt-generation'
  /** Durable commit or segment path ignored because recovery could not trust that artifact. */
  readonly path: string
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
}

/**
 * Persistent RDF Dataset backed by immutable commit records and segments.
 *
 * The store borrows the supplied filesystem. Closing the store never closes or
 * disposes that filesystem. One store path supports one writer at a time; this
 * baseline does not claim cross-process writer coordination.
 */
export class Store implements AsyncDisposable {
  /** Borrowed filesystem used for durable I/O. Closing the store never disposes it. */
  readonly #fs: FileSystemType
  /** Store root containing format, commit, and immutable segment records. */
  readonly #path: string
  /** Recovery admission limit for one immutable segment, which caps materialized segment memory. */
  readonly #maxSegmentBytes: number
  /** Indexed in-memory snapshot of the latest committed generation. */
  #dataset: Dataset
  /** Generation number represented by `#dataset` and the latest valid commit record. */
  #generation: number
  /** Prevents new mutations from entering the write chain after close starts. */
  #closing = false
  /** Marks the terminal lifecycle state after all queued mutations have settled. */
  #closed = false
  /** Serial mutation chain that preserves commit order inside this store instance. */
  #tail: Promise<void> = Promise.resolve()
  /** Non-fatal artifacts ignored while selecting the latest valid generation during recovery. */
  #recovery: RecoveryProblemType[]

  /** Creates one live store over an already-recovered Dataset; filesystem ownership remains with the caller. */
  private constructor(
    fs: FileSystemType,
    path: string,
    maxSegmentBytes: number,
    dataset: Dataset,
    generation: number,
    recovery: RecoveryProblemType[],
  ) {
    this.#fs = fs
    this.#path = path
    this.#maxSegmentBytes = maxSegmentBytes
    this.#dataset = dataset
    this.#generation = generation
    this.#recovery = recovery
  }

  /** Number of unique quads in the latest committed generation. */
  get size(): number {
    this.#assertOpen()
    return this.#dataset.size
  }

  /** Latest committed generation, or zero for a new empty store. */
  get generation(): number {
    this.#assertOpen()
    return this.#generation
  }

  /** Non-fatal invalid newer artifacts ignored during recovery. */
  get recovery(): readonly RecoveryProblemType[] {
    return this.#recovery
  }

  /** Returns whether the latest committed generation contains one equal quad. */
  has(quad: Quad): boolean {
    this.#assertOpen()
    return this.#dataset.has(quad)
  }

  /** Returns an inexpensive cardinality estimate from the current in-memory indexes. */
  estimate(options: {
    /** RDF subject term represented by this statement or operation filter. */
    readonly subject?: SubjectTermType | null
    /** RDF predicate IRI represented by this statement or operation filter. */
    readonly predicate?: PredicateTermType | null
    /** RDF object term represented by this statement or operation filter. */
    readonly object?: ObjectTermType | null
    /** RDF graph that receives quads produced by triplestore work. */
    readonly graph?: GraphTermType | null
  } = {}): number | undefined {
    this.#assertOpen()
    return this.#dataset.estimate(options)
  }

  /** Lazily reads quads matching an RDF/JS-compatible quad pattern. */
  async *match(
    subject: SubjectTermType | null = null,
    predicate: PredicateTermType | null = null,
    object: ObjectTermType | null = null,
    graph: GraphTermType | null = null,
  ): AsyncGenerator<Quad> {
    this.#assertOpen()
    for (const quad of this.#dataset.matchIter({ subject, predicate, object, graph })) yield quad
  }

  /** Durably adds one quad. Equal existing quads do not create a generation. */
  async add(quad: Quad, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (this.#dataset.has(quad)) return
      await this.#commit([{ kind: 'add', quad }], options.signal)
    })
    return this
  }

  /** Durably removes one quad. Missing quads do not create a generation. */
  async delete(quad: Quad, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (!this.#dataset.has(quad)) return
      await this.#commit([{ kind: 'delete', quad }], options.signal)
    })
    return this
  }

  /** Durably adds one materialized batch as a single generation. */
  async addAll(quads: Iterable<Quad>, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      const operations: OperationType[] = []
      const pending = new Set<string>()
      for (const quad of quads) {
        abort(options.signal)
        const id = key(quad)
        if (this.#dataset.has(quad) || pending.has(id)) continue
        pending.add(id)
        operations.push({ kind: 'add', quad })
      }
      if (operations.length > 0) await this.#commit(operations, options.signal)
    })
    return this
  }

  /**
   * Imports a sync/async source in bounded durable batches.
   *
   * Earlier completed batches remain committed if a later batch fails or the
   * caller aborts. This is an explicit streaming-import contract, not an atomic
   * transaction over the whole source.
   */
  async import(
    source: Iterable<Quad> | AsyncIterable<Quad>,
    options: ImportOptionsType = {},
  ): Promise<this> {
    const batchSize = positive(options.batchSize ?? DEFAULT_BATCH_SIZE, 'batchSize')
    let batch: Quad[] = []
    for await (const quad of iterate(source)) {
      abort(options.signal)
      batch.push(quad)
      if (batch.length < batchSize) continue
      await this.addAll(batch, options)
      batch = []
    }
    if (batch.length > 0) await this.addAll(batch, options)
    return this
  }

  /** Durably removes every quad matching one pattern in a single generation. */
  async deleteMatches(
    subject: SubjectTermType | null = null,
    predicate: PredicateTermType | null = null,
    object: ObjectTermType | null = null,
    graph: GraphTermType | null = null,
    options: WriteOptionsType = {},
  ): Promise<this> {
    await this.#mutate(async () => {
      const operations = [...this.#dataset.matchIter({ subject, predicate, object, graph })]
        .map((quad): OperationType => ({ kind: 'delete', quad }))
      if (operations.length > 0) await this.#commit(operations, options.signal)
    })
    return this
  }

  /** Durably clears the store by publishing an empty snapshot generation. */
  async clear(options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (this.#dataset.size === 0) return
      await this.#snapshot(new Dataset(), options.signal)
    })
    return this
  }

  /**
   * Publishes a complete immutable N-Quads snapshot of the current generation.
   *
   * The baseline keeps older immutable artifacts. Physical garbage collection
   * is intentionally separate because safe deletion needs reader/retention rules.
   */
  async compact(options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      await this.#snapshot(new Dataset(this.#dataset), options.signal)
    })
    return this
  }

  /** Returns a detached in-memory snapshot for synchronous RDF Dataset operations. */
  snapshot(): Dataset {
    this.#assertOpen()
    return new Dataset(this.#dataset)
  }

  /** Ends this store handle without disposing the borrowed filesystem. */
  async close(): Promise<void> {
    if (this.#closed || this.#closing) {
      await this.#tail
      return
    }
    this.#closing = true
    await this.#tail
    this.#closed = true
  }

  /** Allows `await using` to close this store without disposing the borrowed filesystem. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  /** Commit as one isolated step of the Store state machine. */
  async #commit(operations: readonly OperationType[], signal?: AbortSignal): Promise<void> {
    abort(signal)
    const generation = this.#generation + 1
    const stem = generationName(generation)
    const kind = operationKind(operations)
    const segment = `segments/${stem}.delta.nq`
    const segmentText = writeNQuads(operations.map((operation) => operation.quad))
    const next = new Dataset(this.#dataset)
    for (const operation of operations) apply(next, operation)
    const commit: CommitType = {
      version: 2,
      generation,
      parent: this.#generation,
      mode: 'delta',
      operation: kind,
      segment,
      checksum: await checksum(segmentText),
      quadCount: next.size,
    }

    await this.#publish(commit, segmentText, signal)
    this.#dataset = next
    this.#generation = generation
  }

  /** Snapshot as one isolated step of the Store state machine. */
  async #snapshot(dataset: Dataset, signal?: AbortSignal): Promise<void> {
    abort(signal)
    const generation = this.#generation + 1
    const stem = generationName(generation)
    const segment = `segments/${stem}.nq`
    const segmentText = writeNQuads(dataset)
    const commit: CommitType = {
      version: 2,
      generation,
      parent: this.#generation,
      mode: 'snapshot',
      segment,
      checksum: await checksum(segmentText),
      quadCount: dataset.size,
    }

    await this.#publish(commit, segmentText, signal)
    this.#dataset = dataset
    this.#generation = generation
  }

  /** Publish as one isolated step of the Store state machine. */
  async #publish(commit: CommitType, segmentText: string, signal?: AbortSignal): Promise<void> {
    abort(signal)
    if (byteLength(segmentText) > this.#maxSegmentBytes) {
      throw new RangeError(`Segment exceeds maxSegmentBytes (${this.#maxSegmentBytes}).`)
    }
    const segmentPath = join(this.#path, commit.segment)
    const commitPath = join(this.#path, `commits/${generationName(commit.generation)}.json`)
    if (await this.#fs.exists(commitPath, signalOptions(signal))) {
      const text = await this.#fs.readText(commitPath, signalOptions(signal))
      let existing: CommitType | undefined
      try {
        existing = parseCommit(text)
      } catch {
        // An interrupted commit-file write can leave invalid JSON or an incomplete
        // record at this exact generation. Recovery already classifies that file
        // as unpublished, so a live handle may replace the same debris on retry.
      }
      if (existing !== undefined) {
        throw new StoreError(
          'writer-conflict',
          `Commit generation ${commit.generation} already exists.`,
        )
      }
    }

    // Publication order is the durability invariant. A segment may be orphaned,
    // but a commit never becomes authoritative before its segment is complete.
    await this.#fs.writeFile(segmentPath, segmentText, writeOptions(signal))
    abort(signal)
    await this.#fs.writeFile(commitPath, writeRecord(commit), writeOptions(signal))
  }

  /** Mutate as one isolated step of the Store state machine. */
  async #mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.#assertWritable()
    const run = this.#tail.then(operation, operation)
    this.#tail = run.then(() => undefined, () => undefined)
    return await run
  }

  /** Assert open as one isolated step of the Store state machine. */
  #assertOpen(): void {
    if (this.#closed) throw new StoreError('closed', 'Triplestore is closed.')
  }

  /** Assert writable as one isolated step of the Store state machine. */
  #assertWritable(): void {
    if (this.#closing || this.#closed) {
      throw new StoreError('closed', 'Triplestore is closing or closed.')
    }
  }

  /** Opens or creates one store and recovers its newest valid generation. */
  static async open(fs: FileSystemType, options: OpenOptionsType = {}): Promise<Store> {
    const path = normalizePath(options.path ?? DEFAULT_PATH)
    const maxSegmentBytes = positive(
      options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES,
      'maxSegmentBytes',
    )
    abort(options.signal)
    await fs.ensureDir(path, signalOptions(options.signal))
    await fs.ensureDir(join(path, 'segments'), signalOptions(options.signal))
    await fs.ensureDir(join(path, 'commits'), signalOptions(options.signal))
    await ensureFormat(fs, path, options.signal)

    const candidates: number[] = []
    const recovery: RecoveryProblemType[] = []
    for await (const entry of fs.readDir(join(path, 'commits'), signalOptions(options.signal))) {
      if (entry.kind !== 'file') continue
      const match = /^([0-9]{16})\.json$/.exec(entry.name)
      if (match?.[1]) candidates.push(Number.parseInt(match[1], 10))
    }
    candidates.sort((a, b) => b - a)

    let committedFailure: unknown
    for (const generation of candidates) {
      const commitPath = join(path, `commits/${generationName(generation)}.json`)
      try {
        // Invalid JSON or an incomplete record can be left by an interrupted
        // commit-file write. It never became a valid published generation.
        parseCommit(await fs.readText(commitPath, signalOptions(options.signal)))
      } catch (error) {
        recovery.push({ kind: 'incomplete-commit', path: commitPath, message: message(error) })
        continue
      }

      try {
        const dataset = await recover(fs, path, generation, maxSegmentBytes, options.signal)
        return new Store(fs, path, maxSegmentBytes, dataset, generation, recovery)
      } catch (error) {
        committedFailure ??= error
        recovery.push({ kind: 'corrupt-generation', path: commitPath, message: message(error) })
      }
    }

    if (committedFailure !== undefined) {
      throw new StoreError(
        'corrupt',
        'No valid committed triplestore generation could be recovered.',
        {
          cause: committedFailure,
        },
      )
    }
    return new Store(fs, path, maxSegmentBytes, new Dataset(), 0, recovery)
  }
}

/** Store failure categories stable enough for callers to inspect. */
export type StoreErrorKindType = 'closed' | 'format' | 'corrupt' | 'writer-conflict'

/** Normalized persistent-store failure. */
export class StoreError extends Error {
  /** Stable failure category that callers can branch on without parsing the error message. */
  readonly kind: StoreErrorKindType

  /** Creates a normalized storage failure with its stable category and underlying cause. */
  constructor(kind: StoreErrorKindType, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StoreError'
    this.kind = kind
  }
}

/** One pending store mutation; generations are homogeneous so publication later groups these by operation kind. */
type OperationType = {
  /** Discriminates the concrete OperationType variant. */
  readonly kind: 'add' | 'delete'
  /** RDF quad carried by this event or triplestore mutation. */
  readonly quad: Quad
}

/**
 * Creates or opens one persistent RDF store over a caller-owned filesystem.
 *
 * Opening validates the format marker and recovers the latest trustworthy
 * generation. The returned store borrows `fs`; closing the store does not close
 * or dispose that filesystem.
 *
 * @example
 * ```ts
 * import * as triplestore from '@okikio/triplestore'
 *
 * const store = await triplestore.open(fileSystem, { path: '/rdf' })
 * try {
 *   console.log(store.size)
 * } finally {
 *   await store.close()
 * }
 * ```
 */
export async function open(fs: FileSystemType, options: OpenOptionsType = {}): Promise<Store> {
  return await Store.open(fs, options)
}

/** Creates or validates the root format marker before any generation is recovered or published. */
async function ensureFormat(fs: FileSystemType, root: string, signal?: AbortSignal): Promise<void> {
  const path = join(root, 'format.json')
  if (!await fs.exists(path, signalOptions(signal))) {
    await fs.writeFile(path, writeRecord(FORMAT), writeOptions(signal))
    return
  }
  try {
    parseFormat(await fs.readText(path, signalOptions(signal)))
  } catch (cause) {
    throw new StoreError('format', 'Persistent store format is incompatible or corrupt.', { cause })
  }
}

/** Finds the newest fully valid committed generation, falling back only to an older valid commit. */
async function recover(
  fs: FileSystemType,
  root: string,
  head: number,
  maxSegmentBytes: number,
  signal?: AbortSignal,
): Promise<Dataset> {
  const commits = new Map<number, CommitType>()
  let generation = head
  while (generation > 0) {
    abort(signal)
    const path = join(root, `commits/${generationName(generation)}.json`)
    const commit = parseCommit(await fs.readText(path, signalOptions(signal)))
    if (commit.generation !== generation) {
      throw new StoreError(
        'corrupt',
        `Commit path generation ${generation} disagrees with record ${commit.generation}.`,
      )
    }
    const stem = generationName(generation)
    const expectedSegment = commit.mode === 'snapshot'
      ? `segments/${stem}.nq`
      : `segments/${stem}.delta.nq`
    if (commit.segment !== expectedSegment) {
      throw new StoreError(
        'corrupt',
        `Commit ${generation} references unexpected segment '${commit.segment}'.`,
      )
    }
    commits.set(generation, commit)
    if (commit.mode === 'snapshot') break
    generation = commit.parent
  }

  const dataset = new Dataset()
  for (const commit of [...commits.values()].reverse()) {
    abort(signal)
    const path = join(root, commit.segment)
    const stat = await fs.stat(path, signalOptions(signal))
    if (stat.kind !== 'file') {
      throw new StoreError('corrupt', `Segment '${commit.segment}' is not a file.`)
    }
    if (stat.size > maxSegmentBytes) {
      throw new StoreError('corrupt', `Segment '${commit.segment}' exceeds maxSegmentBytes.`)
    }
    const text = await fs.readText(path, signalOptions(signal))
    if (await checksum(text) !== commit.checksum) {
      throw new StoreError('corrupt', `Segment checksum mismatch for '${commit.segment}'.`)
    }
    if (commit.mode === 'snapshot') dataset.clear()
    for await (const quad of parseNQuads(text, signalOptions(signal))) {
      if (commit.mode === 'snapshot' || commit.operation === 'add') dataset.add(quad)
      else dataset.delete(quad)
    }
  }

  const current = commits.get(head)
  if (!current) throw new StoreError('corrupt', `Missing head commit ${head}.`)
  if (dataset.size !== current.quadCount) {
    throw new StoreError(
      'corrupt',
      `Recovered ${dataset.size} quads but commit ${head} records ${current.quadCount}.`,
    )
  }
  return dataset
}

/** Returns the one mutation kind encoded by a homogeneous delta generation. */
function operationKind(operations: readonly OperationType[]): OperationType['kind'] {
  const first = operations[0]
  if (!first) throw new TypeError('Delta generation requires at least one operation.')
  for (const operation of operations) {
    if (operation.kind !== first.kind) {
      throw new TypeError('Delta generation cannot mix add and delete operations.')
    }
  }
  return first.kind
}

/** Applies one homogeneous add/delete delta to the recovered in-memory Dataset. */
function apply(dataset: Dataset, operation: OperationType): void {
  if (operation.kind === 'add') dataset.add(operation.quad)
  else dataset.delete(operation.quad)
}

/** Computes the SHA-256 checksum recorded in immutable commit metadata. */
async function checksum(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }`
}

/** Returns the encoded UTF-8 byte length used for persistent record limits. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** Normalizes the caller store path without allowing an empty root record path. */
function normalizePath(value: string): string {
  if (!value.startsWith('/')) throw new TypeError('Store path must be absolute.')
  const parts = value.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new TypeError('Store path cannot contain dot segments.')
  }
  return `/${parts.join('/')}`
}

/** Joins normalized store-relative path components without introducing duplicate separators. */
function join(root: string, child: string): string {
  return root === '/' ? `/${child}` : `${root}/${child}`
}

/** Validates a positive safe-integer storage option before it influences persistence limits. */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`)
  }
  return value
}

/** Throws the caller supplied abort reason when cancellation has been requested. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Adds the operation AbortSignal only when one was supplied. */
function signalOptions(signal?: AbortSignal): {
  /** Abort signal checked before and during triplestore work. */
  readonly signal?: AbortSignal
} {
  return signal === undefined ? {} : { signal }
}

/** Write options deterministically to the caller-owned output. */
function writeOptions(signal?: AbortSignal): {
  /** Abort signal checked before and during triplestore work. */
  readonly signal?: AbortSignal
  /** Whether missing parent directories are created before the write. */
  readonly parents: true
} {
  return signal === undefined ? { parents: true } : { parents: true, signal }
}

/** Converts an unknown failure into bounded diagnostic text for recovery records. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
