import { consume, pending } from '@okikio/rdf/stream'
/** Crash-recoverable persistent RDF dataset store. @module */

import {
  Dataset,
  type GraphTermType,
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
  type FormatType,
  generationName,
  type MigrationType,
  parseCommit,
  parseFormat,
  parseReady,
  type ReadyType,
  VersionError,
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
  /** Legacy roots are read-only until explicitly migrated. */
  readonly mode?: 'read' | 'write'
  /** Maximum discovered files and replay ancestry records. */
  readonly maxRecords?: number
  /** Maximum cumulative admitted UTF-8 replay bytes. */
  readonly maxReplayBytes?: number
  /** Maximum parsed quads and applied replay steps across all recovery candidates. */
  readonly maxReplayQuads?: number
  /** Maximum materialized unique quads. */
  readonly maxQuads?: number
  /** Maximum immutable segment bytes accepted during recovery. */
  readonly maxSegmentBytes?: number
  /** Cooperative cancellation for open and recovery. */
  readonly signal?: AbortSignal
}

/** Recovery budgets apply to actual consumption, not only advisory stat metadata. */
interface BudgetType {
  readonly segment: number
  readonly records: number
  readonly replay: number
  readonly quads: number
  readonly parsed: number
}

/** Discovered namespace is separate from the latest trustworthy dataset. */
interface NamespaceType {
  readonly highWater: number
  readonly candidates: readonly number[]
  readonly identity: string
}

/** Mutation options shared by published writes. */
export interface WriteOptionsType {
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/** Streaming import options. */
export interface ImportOptionsType extends WriteOptionsType {
  /** Maximum quads committed in one immutable delta segment. */
  readonly batchSize?: number
  /** Observes actual cooperative source cleanup separately from terminal cancellation. */
  readonly onCleanup?: (cleanup: Promise<void>) => void
}

/** One recovery problem that did not prevent opening an earlier valid generation. */
export interface RecoveryProblemType {
  /** Whether the artifact was an incomplete publication or a corrupt committed generation. */
  readonly kind: 'incomplete-commit' | 'corrupt-generation'
  /** Published commit or segment path ignored because recovery could not trust that artifact. */
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
  /** Borrowed filesystem used for published I/O. Closing the store never disposes it. */
  readonly #fs: FileSystemType
  /** Store root containing format, commit, and immutable segment records. */
  readonly #path: string
  /** Recovery admission limit for one immutable segment, which caps materialized segment memory. */
  readonly #maxSegmentBytes: number
  readonly #budget: BudgetType
  readonly #readonly: boolean
  #highWater: number
  #namespace: string
  #uncertain = false
  /** Pending borrowed writes remain observable after terminal cancellation. */
  #writes = new Set<Promise<unknown>>()
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
    namespace: NamespaceType,
    budget: BudgetType,
    readonly: boolean,
  ) {
    this.#fs = fs
    this.#path = path
    this.#maxSegmentBytes = maxSegmentBytes
    this.#dataset = dataset
    this.#generation = generation
    this.#recovery = recovery
    this.#highWater = namespace.highWater
    this.#namespace = namespace.identity
    this.#budget = budget
    this.#readonly = readonly
  }

  /** Number of unique quads in the latest committed generation. */
  get size(): number {
    this.#assertOpen()
    return this.#dataset.size
  }

  /** Whether mutations are admitted; legacy and explicitly read-only roots reject writes. */
  get writable(): boolean {
    return !this.#readonly && !this.#uncertain && !this.#closing && !this.#closed
  }

  /** Settles actual acquired writes. After outcome-unknown, await this before reopening the same root. */
  get settlement(): Promise<void> {
    return Promise.allSettled([...this.#writes]).then(() => undefined)
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

  /** Publishes and adds one quad. Equal existing quads do not create a generation. */
  async add(quad: Quad, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (this.#dataset.has(quad)) return
      await this.#commit([{ kind: 'add', quad }], options.signal)
    }, options.signal)
    return this
  }

  /** Publishes and removes one quad. Missing quads do not create a generation. */
  async delete(quad: Quad, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (!this.#dataset.has(quad)) return
      await this.#commit([{ kind: 'delete', quad }], options.signal)
    }, options.signal)
    return this
  }

  /** Publishes and adds one materialized batch as a single generation. */
  async addAll(quads: Iterable<Quad>, options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      const operations: OperationType[] = []
      const pending = new Set<string>()
      for (const quad of quads) {
        abort(options.signal)
        const id = key(quad)
        if (this.#dataset.has(quad) || pending.has(id)) continue
        pending.add(id)
        if (this.#dataset.size + operations.length >= this.#budget.quads) {
          throw new RangeError('Store exceeds maxQuads.')
        }
        operations.push({ kind: 'add', quad })
      }
      if (operations.length > 0) await this.#commit(operations, options.signal)
    }, options.signal)
    return this
  }

  /**
   * Imports a sync/async source in bounded published batches.
   *
   * Earlier completed batches remain committed if a later batch fails or the
   * caller aborts. This is an explicit streaming-import contract, not an atomic
   * transaction over the whole source.
   */
  async import(
    source: Iterable<Quad> | AsyncIterable<Quad>,
    options: ImportOptionsType = {},
  ): Promise<this> {
    // Reject before borrowing the source, including an empty or stalled source.
    // Each published batch still rechecks admission through addAll.
    this.#assertWritable()
    const batchSize = positive(options.batchSize ?? DEFAULT_BATCH_SIZE, 'batchSize')
    let batch: Quad[] = []
    for await (const quad of consume(source, options.signal, options.onCleanup)) {
      abort(options.signal)
      batch.push(quad)
      if (batch.length < batchSize) continue
      await this.addAll(batch, options)
      batch = []
    }
    if (batch.length > 0) await this.addAll(batch, options)
    return this
  }

  /** Publishes and removes every quad matching one pattern in a single generation. */
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
    }, options.signal)
    return this
  }

  /** Publishes and clears the store by publishing an empty snapshot generation. */
  async clear(options: WriteOptionsType = {}): Promise<this> {
    await this.#mutate(async () => {
      if (this.#dataset.size === 0) return
      await this.#snapshot(new Dataset(), options.signal)
    }, options.signal)
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
    }, options.signal)
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
    const generation = this.#highWater + 1
    const stem = generationName(generation)
    const next = new Dataset(this.#dataset)
    for (const operation of operations) apply(next, operation)
    if (next.size > this.#budget.quads) throw new RangeError('Store exceeds maxQuads.')
    const snapshot = this.#highWater > this.#generation
    const kind = operationKind(operations)
    const segment = `segments/${stem}${snapshot ? '' : '.delta'}.nq`
    const segmentText = writeNQuads(snapshot ? next : operations.map((operation) => operation.quad))
    const commit: CommitType = {
      version: 3,
      generation,
      parent: this.#generation,
      mode: snapshot ? 'snapshot' : 'delta',
      ...(snapshot ? {} : { operation: kind }),
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
    if (dataset.size > this.#budget.quads) throw new RangeError('Store exceeds maxQuads.')
    const generation = this.#highWater + 1
    const stem = generationName(generation)
    const segment = `segments/${stem}.nq`
    const segmentText = writeNQuads(dataset)
    const commit: CommitType = {
      version: 3,
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
    const namespace = await discover(this.#fs, this.#path, this.#budget.records, signal)
    if (namespace.identity !== this.#namespace || namespace.highWater >= commit.generation) {
      throw new StoreError('writer-conflict', 'Store namespace changed; reopen before writing.')
    }
    // Plain writes do not provide CAS or a persistence barrier. Caller owns one-writer exclusion.
    try {
      await this.#write(segmentPath, segmentText, signal)
      abort(signal)
      await this.#write(commitPath, writeRecord(commit), signal)
      const published = await read(this.#fs, commitPath, 64 * 1024, signal)
      if (published !== writeRecord(commit)) {
        throw new StoreError('corrupt', 'Commit readback differs from publication.')
      }
      const bytes = await read(this.#fs, segmentPath, this.#maxSegmentBytes, signal)
      if (await checksum(bytes) !== commit.checksum) {
        throw new StoreError('corrupt', 'Segment readback differs from publication.')
      }
      const after = await discover(this.#fs, this.#path, this.#budget.records, signal)
      abort(signal)
      this.#highWater = commit.generation
      this.#namespace = after.identity
    } catch (cause) {
      this.#uncertain = true
      throw new StoreError(
        'outcome-unknown',
        'Publication failed or was cancelled; close and reopen to reconcile before writing again.',
        { cause },
      )
    }
  }

  /** Races caller cancellation without losing observation of a borrowed filesystem write. */
  async #write(path: string, text: string, signal?: AbortSignal): Promise<void> {
    abort(signal)
    const writing = Promise.resolve().then(() =>
      this.#fs.writeFile(path, text, writeOptions(signal))
    )
    this.#writes.add(writing)
    void writing.then(() => this.#writes.delete(writing), () => this.#writes.delete(writing))
    await pending(() => writing, signal)
  }

  /** Mutate as one isolated step of the Store state machine. */
  async #mutate<Result>(operation: () => Promise<Result>, signal?: AbortSignal): Promise<Result> {
    this.#assertWritable()
    abort(signal)
    const invoke = () => {
      this.#assertWritable()
      abort(signal)
      return operation()
    }
    const run = this.#tail.then(invoke, invoke)
    this.#tail = run.then(() => undefined, () => undefined)
    return await run
  }

  /** Assert open as one isolated step of the Store state machine. */
  #assertOpen(): void {
    if (this.#closed) throw new StoreError('closed', 'Triplestore is closed.')
  }

  /** Assert writable as one isolated step of the Store state machine. */
  #assertWritable(): void {
    if (this.#readonly) {
      throw new StoreError(
        'migration-required',
        'Read-only or legacy store; migrate legacy state into a fresh root before writing.',
      )
    }
    if (this.#uncertain) {
      throw new StoreError('outcome-unknown', 'Reopen required after uncertain publication.')
    }
    if (this.#closing || this.#closed) {
      throw new StoreError('closed', 'Triplestore is closing or closed.')
    }
  }

  /** Opens or creates one store and recovers its newest valid generation. */
  static async open(fs: FileSystemType, options: OpenOptionsType = {}): Promise<Store> {
    const path = normalizePath(options.path ?? DEFAULT_PATH)
    const budget = budgets(options)
    abort(options.signal)
    await pending(() => fs.ensureDir(path, signalOptions(options.signal)), options.signal)
    await pending(
      () => fs.ensureDir(join(path, 'segments'), signalOptions(options.signal)),
      options.signal,
    )
    await pending(
      () => fs.ensureDir(join(path, 'commits'), signalOptions(options.signal)),
      options.signal,
    )
    const format = await ensureFormat(fs, path, budget, options.signal)
    if (format.migration) await readiness(fs, path, format.migration, budget, options.signal)
    const namespace = await discover(fs, path, budget.records, options.signal)
    const cache = recoveryCache(format.version)
    const recovery: RecoveryProblemType[] = []
    let failed = false
    let failure: unknown
    for (const generation of namespace.candidates) {
      const commitPath = join(path, `commits/${generationName(generation)}.json`)
      // Filesystem errors are outside the parse catch and remain fatal.
      const text = await read(fs, commitPath, 64 * 1024, options.signal)
      try {
        compatible(parseCommit(text), format.version)
      } catch (cause) {
        abort(options.signal)
        if (cause instanceof VersionError) {
          throw new StoreError('format', 'Unsupported commit protocol.', { cause })
        }
        if (cause instanceof StoreError && cause.kind === 'format') throw cause
        recovery.push({
          kind: 'incomplete-commit',
          path: commitPath,
          message: message(cause).slice(0, 1024),
        })
        continue
      }
      try {
        const dataset = await recover(fs, path, generation, budget, options.signal, cache)
        abort(options.signal)
        return new Store(
          fs,
          path,
          budget.segment,
          dataset,
          generation,
          recovery,
          namespace,
          budget,
          options.mode === 'read' || format.version === 2,
        )
      } catch (cause) {
        abort(options.signal)
        if (!(cause instanceof StoreError) || cause.kind !== 'corrupt') throw cause
        if (!failed) {
          failed = true
          failure = cause
        }
        recovery.push({
          kind: 'corrupt-generation',
          path: commitPath,
          message: message(cause).slice(0, 1024),
        })
      }
    }
    abort(options.signal)
    if (failed) {
      throw new StoreError('corrupt', 'No trustworthy committed generation could be recovered.', {
        cause: failure,
      })
    }
    return new Store(
      fs,
      path,
      budget.segment,
      new Dataset(),
      0,
      recovery,
      namespace,
      budget,
      options.mode === 'read' || format.version === 2,
    )
  }
}

/** Store failure categories stable enough for callers to inspect. */
export type StoreErrorKindType =
  | 'closed'
  | 'format'
  | 'corrupt'
  | 'writer-conflict'
  | 'migration-required'
  | 'migration-incomplete'
  | 'outcome-unknown'

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
async function ensureFormat(
  fs: FileSystemType,
  root: string,
  budget: BudgetType,
  signal?: AbortSignal,
): Promise<FormatType> {
  const path = join(root, 'format.json')
  if (!await pending(() => fs.exists(path, signalOptions(signal)), signal)) {
    const namespace = await discover(fs, root, budget.records, signal)
    if (namespace.identity !== '[]') {
      throw new StoreError('format', 'Nonempty store namespace has no format marker.')
    }
    await pending(() => fs.writeFile(path, writeRecord(FORMAT), writeOptions(signal)), signal)
    abort(signal)
    return FORMAT
  }
  const text = await read(fs, path, 64 * 1024, signal)
  try {
    return parseFormat(text)
  } catch (cause) {
    throw new StoreError('format', 'Persistent store format is incompatible or malformed.', {
      cause,
    })
  }
}

/** Validated artifacts are reused across fallback candidates under one admission budget. */
interface ArtifactType {
  readonly commit: CommitType
  readonly quads: readonly Quad[]
}

/** One open owns the cache and total admitted bytes/quads, including rejected candidates. */
interface CacheType {
  readonly version: 2 | 3
  readonly values: Map<number, Promise<ArtifactType>>
  bytes: number
  quads: number
  work: number
}

/** Creates an operation-local cache; snapshots do not depend on their provenance parent. */
function recoveryCache(version: 2 | 3 = 3): CacheType {
  return { version, values: new Map(), bytes: 0, quads: 0, work: 0 }
}

/** Rejects mixed protocol versions rather than silently downgrading newer semantics. */
function compatible(commit: CommitType, version: 2 | 3): CommitType {
  if (commit.version !== version) {
    throw new StoreError('format', 'Commit and root protocol versions differ.')
  }
  return commit
}

/** Verifies a head before following its delta ancestry; corrupt suffixes do not reread old history. */
async function artifact(
  fs: FileSystemType,
  root: string,
  generation: number,
  budget: BudgetType,
  cache: CacheType,
  signal?: AbortSignal,
): Promise<ArtifactType> {
  const existing = cache.values.get(generation)
  if (existing) return await existing
  if (cache.values.size >= budget.records) throw new RangeError('Recovery exceeds maxRecords.')
  const operation = (async (): Promise<ArtifactType> => {
    const path = join(root, `commits/${generationName(generation)}.json`)
    if (!await pending(() => fs.exists(path, signalOptions(signal)), signal)) {
      throw new StoreError('corrupt', 'Required delta parent is missing.')
    }
    const record = await read(fs, path, 64 * 1024, signal)
    let commit: CommitType
    try {
      commit = compatible(parseCommit(record), cache.version)
    } catch (cause) {
      if (cause instanceof VersionError) {
        throw new StoreError('format', 'Unsupported commit protocol.', { cause })
      }
      if (cause instanceof StoreError && cause.kind === 'format') throw cause
      throw new StoreError('corrupt', 'Invalid ancestry record.', { cause })
    }
    if (commit.generation !== generation) {
      throw new StoreError('corrupt', 'Commit generation differs from filename.')
    }
    const stem = generationName(generation)
    const expected = `segments/${stem}${commit.mode === 'snapshot' ? '' : '.delta'}.nq`
    if (commit.segment !== expected) throw new StoreError('corrupt', 'Unexpected segment identity.')
    const segment = join(root, commit.segment)
    if (!await pending(() => fs.exists(segment, signalOptions(signal)), signal)) {
      throw new StoreError('corrupt', 'Referenced segment is missing.')
    }
    const stat = await pending(() => fs.stat(segment, signalOptions(signal)), signal)
    if (stat.kind !== 'file') throw new StoreError('corrupt', 'Segment is not a file.')
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > budget.segment) {
      throw new RangeError('Segment exceeds maxSegmentBytes or has invalid metadata.')
    }
    const text = await read(fs, segment, budget.segment, signal)
    cache.bytes += byteLength(text)
    if (cache.bytes > budget.replay) {
      throw new RangeError('Recovery exceeds maxReplayBytes across candidates.')
    }
    if (await checksum(text) !== commit.checksum) {
      throw new StoreError('corrupt', 'Segment checksum differs.')
    }
    const quads: Quad[] = []
    try {
      for await (const quad of parseNQuads(text, signalOptions(signal))) {
        if (++cache.quads > budget.parsed) {
          throw new RangeError('Recovery exceeds maxReplayQuads across candidates.')
        }
        quads.push(quad)
      }
    } catch (cause) {
      abort(signal)
      if (cause instanceof SyntaxError) {
        throw new StoreError('corrupt', 'Invalid segment RDF.', { cause })
      }
      throw cause
    }
    return { commit, quads }
  })()
  cache.values.set(generation, operation)
  return await operation
}

/** Replays only a verified chain. Snapshot parent is provenance, not a replay dependency. */
async function recover(
  fs: FileSystemType,
  root: string,
  head: number,
  budget: BudgetType,
  signal?: AbortSignal,
  cache: CacheType = recoveryCache(),
): Promise<Dataset> {
  const chain: ArtifactType[] = []
  let generation = head
  while (generation > 0) {
    abort(signal)
    const value = await artifact(fs, root, generation, budget, cache, signal)
    chain.push(value)
    if (value.commit.mode === 'snapshot') break
    generation = value.commit.parent
  }
  const dataset = new Dataset()
  for (let index = chain.length - 1; index >= 0; index--) {
    const value = chain[index]!
    if (value.commit.mode === 'snapshot') dataset.clear()
    for (const quad of value.quads) {
      abort(signal)
      if (++cache.work > budget.parsed) {
        throw new RangeError('Recovery exceeds maxReplayQuads applied steps across candidates.')
      }
      if (value.commit.mode === 'snapshot' || value.commit.operation === 'add') dataset.add(quad)
      else dataset.delete(quad)
      if (dataset.size > budget.quads) throw new RangeError('Recovery exceeds maxQuads.')
    }
    if (dataset.size !== value.commit.quadCount) {
      throw new StoreError('corrupt', 'Applied generation count differs from commit.')
    }
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
  if (signal?.aborted) throw signal.reason
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

/** Validates recovery controls before acquiring borrowed storage. */
function budgets(options: OpenOptionsType): BudgetType {
  return {
    segment: positive(options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES, 'maxSegmentBytes'),
    records: positive(options.maxRecords ?? 100_000, 'maxRecords'),
    replay: positive(options.maxReplayBytes ?? 512 * 1024 * 1024, 'maxReplayBytes'),
    quads: positive(options.maxQuads ?? 1_000_000, 'maxQuads'),
    parsed: positive(options.maxReplayQuads ?? 2_000_000, 'maxReplayQuads'),
  }
}

/** Scans both commit and segment occupancy; filenames never substitute for trustworthy data. */
async function discover(
  fs: FileSystemType,
  root: string,
  maximum: number,
  signal?: AbortSignal,
): Promise<NamespaceType> {
  const entries: string[] = []
  const candidates: number[] = []
  let highWater = 0
  for (const directory of ['commits', 'segments']) {
    for await (
      const entry of consume(fs.readDir(join(root, directory), signalOptions(signal)), signal)
    ) {
      if (entries.length >= maximum) throw new RangeError('Store namespace exceeds maxRecords.')
      entries.push(`${directory}/${entry.name}`)
      if (entry.kind !== 'file') continue
      const match = /^([0-9]{16})(?:\.json|(?:\.delta)?\.nq)$/.exec(entry.name)
      if (!match) continue
      const generation = Number(match[1])
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new RangeError('Occupied generation is outside the safe namespace.')
      }
      highWater = Math.max(highWater, generation)
      if (directory === 'commits' && entry.name.endsWith('.json')) candidates.push(generation)
    }
  }
  abort(signal)
  return {
    highWater,
    candidates: candidates.sort((a, b) => b - a),
    identity: JSON.stringify(entries.sort()),
  }
}

/** Reads bounded actual UTF-8 bytes; readText-only adapters retain a documented materialization boundary. */
async function read(
  fs: FileSystemType,
  path: string,
  maximum: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!fs.openReadStream) {
    const text = await pending(() => fs.readText(path, signalOptions(signal)), signal)
    abort(signal)
    if (byteLength(text) > maximum) {
      throw new RangeError('Store record exceeds its admitted byte limit.')
    }
    return text
  }
  const opening = Promise.resolve().then(() => fs.openReadStream!(path, signalOptions(signal)))
  let stream: ReadableStream<Uint8Array>
  try {
    stream = await pending(() => opening, signal)
  } catch (cause) {
    void opening.then((value) => value.cancel(cause), () => undefined).catch(() => undefined)
    throw cause
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let complete = false
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const item = await pending(() => reader.read(), signal)
      if (item.done) {
        complete = true
        break
      }
      bytes += item.value.byteLength
      if (bytes > maximum) throw new RangeError('Store record exceeds its admitted byte limit.')
      try {
        text += decoder.decode(item.value, { stream: true })
      } catch (cause) {
        throw new StoreError('corrupt', 'Store record has invalid UTF-8.', { cause })
      }
    }
    try {
      text += decoder.decode()
    } catch (cause) {
      throw new StoreError('corrupt', 'Store record has incomplete UTF-8.', { cause })
    }
    abort(signal)
    return text
  } finally {
    if (!complete) {
      void reader.cancel(signal?.aborted ? signal.reason : 'Store record consumption stopped.')
        .catch(() => undefined)
    }
    reader.releaseLock()
  }
}

/** Validates readiness against the initial snapshot, never against a later mutated head. */
async function readiness(
  fs: FileSystemType,
  root: string,
  intent: MigrationType,
  budget: BudgetType,
  signal?: AbortSignal,
): Promise<ReadyType> {
  if (intent.destination !== root) {
    throw new StoreError('migration-incomplete', 'Migration destination identity differs.')
  }
  const path = join(root, 'ready.json')
  if (!await pending(() => fs.exists(path, signalOptions(signal)), signal)) {
    throw new StoreError('migration-incomplete', 'Migration is not ready.')
  }
  const text = await read(fs, path, 64 * 1024, signal)
  let ready: ReadyType
  try {
    ready = parseReady(text)
  } catch (cause) {
    throw new StoreError('migration-incomplete', 'Migration readiness is malformed.', { cause })
  }
  if (JSON.stringify(ready.migration) !== JSON.stringify(intent)) {
    throw new StoreError('migration-incomplete', 'Migration readiness belongs to another intent.')
  }
  const commitText = await read(
    fs,
    join(root, `commits/${generationName(ready.generation)}.json`),
    64 * 1024,
    signal,
  )
  const commit = parseCommit(commitText)
  if (
    commit.mode !== 'snapshot' || commit.generation !== ready.generation ||
    commit.quadCount !== ready.quadCount || await checksum(commitText) !== ready.commit ||
    commit.checksum !== ready.segment
  ) throw new StoreError('migration-incomplete', 'Initial migration snapshot identity differs.')
  const dataset = await recover(fs, root, ready.generation, budget, signal)
  if (dataset.size !== ready.quadCount) {
    throw new StoreError('migration-incomplete', 'Initial migration snapshot count differs.')
  }
  return ready
}

/** Non-destructive migration controls. The application excludes writers on both roots. */
export interface MigrateOptionsType extends Omit<OpenOptionsType, 'path' | 'mode'> {
  /** Borrowed source root recovered read-only; its acknowledged history is never rewritten. */
  readonly from: string
  /** Distinct destination root owned exclusively by the caller during migration and admission. */
  readonly to: string
}

/** Verified destination selection receipt. No atomic global pointer switch is implied. */
export interface MigrationReceiptType {
  /** Destination root admitted after its persisted intent and initial snapshot receipt agree. */
  readonly path: string
  /** Generation of the self-contained initial migration snapshot, not a live head pointer. */
  readonly generation: number
  /** Exact number of distinct quads verified in that initial snapshot. */
  readonly quadCount: number
  /** Persisted migration operation identity shared by the intent and readiness receipt. */
  readonly operation: string
}

/**
 * Copies recovered legacy/current state into a fresh format3 root. An interrupted
 * destination stays unreadable until its persisted intent and initial snapshot
 * readiness agree. Source bytes are never removed or rewritten. This operation
 * requires caller-owned exclusion; plain filesystems do not provide multiwriter CAS.
 */
export async function migrate(
  fs: FileSystemType,
  options: MigrateOptionsType,
): Promise<MigrationReceiptType> {
  const source = normalizePath(options.from)
  const destination = normalizePath(options.to)
  if (source === destination) {
    throw new TypeError('Migration requires a different destination root.')
  }
  const budget = budgets(options)
  const signal = options.signal
  abort(signal)
  const original = await Store.open(fs, { ...options, path: source, mode: 'read' })
  try {
    const sourceFormat = await read(fs, join(source, 'format.json'), 64 * 1024, signal)
    const sourceNamespace = await discover(fs, source, budget.records, signal)
    const sourceHead = original.generation
      ? await read(
        fs,
        join(source, `commits/${generationName(original.generation)}.json`),
        64 * 1024,
        signal,
      )
      : ''
    const fingerprint = await checksum(sourceFormat + sourceNamespace.identity + sourceHead)
    let intent: MigrationType
    if (await pending(() => fs.exists(destination, signalOptions(signal)), signal)) {
      const marker = parseFormat(
        await read(fs, join(destination, 'format.json'), 64 * 1024, signal),
      )
      if (
        !marker.migration || marker.migration.source !== source ||
        marker.migration.destination !== destination ||
        marker.migration.sourceFingerprint !== fingerprint
      ) {
        throw new StoreError(
          'migration-incomplete',
          'Existing destination does not match this migration intent.',
        )
      }
      intent = marker.migration
      if (
        await pending(
          () => fs.exists(join(destination, 'ready.json'), signalOptions(signal)),
          signal,
        )
      ) {
        const ready = await readiness(fs, destination, intent, budget, signal)
        return {
          path: destination,
          generation: ready.generation,
          quadCount: ready.quadCount,
          operation: intent.operation,
        }
      }
    } else {
      intent = {
        operation: crypto.randomUUID(),
        source,
        destination,
        sourceFingerprint: fingerprint,
      }
      await pending(() => fs.ensureDir(destination, signalOptions(signal)), signal)
      await pending(() => fs.ensureDir(join(destination, 'commits'), signalOptions(signal)), signal)
      await pending(
        () => fs.ensureDir(join(destination, 'segments'), signalOptions(signal)),
        signal,
      )
      await pending(
        () =>
          fs.writeFile(
            join(destination, 'format.json'),
            writeRecord({ ...FORMAT, migration: intent }),
            writeOptions(signal),
          ),
        signal,
      )
    }
    // writeNQuads accepts sync iterables; a store read is consumed explicitly before serialization.
    const values: Quad[] = []
    for await (const value of original.match()) {
      abort(signal)
      values.push(value)
    }
    const segment = writeNQuads(values)
    if (byteLength(segment) > budget.segment) {
      throw new RangeError('Migration snapshot exceeds maxSegmentBytes.')
    }
    const commit: CommitType = {
      version: 3,
      generation: 1,
      parent: 0,
      mode: 'snapshot',
      segment: 'segments/0000000000000001.nq',
      checksum: await checksum(segment),
      quadCount: values.length,
    }
    const commitText = writeRecord(commit)
    const namespace = await discover(fs, destination, budget.records, signal)
    if (namespace.highWater > 1 || namespace.candidates.some((value) => value !== 1)) {
      throw new StoreError('migration-incomplete', 'Destination contains conflicting history.')
    }
    for (
      const [path, expected] of [[commit.segment, segment], [
        'commits/0000000000000001.json',
        commitText,
      ]] as const
    ) {
      const full = join(destination, path)
      if (await pending(() => fs.exists(full, signalOptions(signal)), signal)) {
        const actual = await read(
          fs,
          full,
          path.endsWith('.json') ? 64 * 1024 : budget.segment,
          signal,
        )
        if (actual !== expected) {
          throw new StoreError(
            'migration-incomplete',
            'Destination bytes conflict with migration; choose a fresh root.',
          )
        }
      } else await pending(() => fs.writeFile(full, expected, writeOptions(signal)), signal)
    }
    const verified = await recover(fs, destination, 1, budget, signal)
    if (verified.size !== values.length || values.some((value) => !verified.has(value))) {
      throw new StoreError('corrupt', 'Migration semantic verification differs from source.')
    }
    const currentSourceNamespace = await discover(fs, source, budget.records, signal)
    const currentFormat = await read(fs, join(source, 'format.json'), 64 * 1024, signal)
    const currentHead = original.generation
      ? await read(
        fs,
        join(source, `commits/${generationName(original.generation)}.json`),
        64 * 1024,
        signal,
      )
      : ''
    if (
      await checksum(currentFormat + currentSourceNamespace.identity + currentHead) !== fingerprint
    ) throw new StoreError('writer-conflict', 'Migration source changed.')
    const ready: ReadyType = {
      migration: intent,
      generation: 1,
      commit: await checksum(commitText),
      segment: commit.checksum,
      quadCount: commit.quadCount,
    }
    const readyPath = join(destination, 'ready.json')
    if (await pending(() => fs.exists(readyPath, signalOptions(signal)), signal)) {
      if (await read(fs, readyPath, 64 * 1024, signal) !== writeRecord(ready)) {
        throw new StoreError('migration-incomplete', 'Conflicting readiness receipt.')
      }
    } else {await pending(() =>
        fs.writeFile(readyPath, writeRecord(ready), writeOptions(signal)), signal)}
    await readiness(fs, destination, intent, budget, signal)
    abort(signal)
    return {
      path: destination,
      generation: 1,
      quadCount: verified.size,
      operation: intent.operation,
    }
  } finally {
    await original.close()
  }
}
