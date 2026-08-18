/**
 * In-memory RDF dataset with exact-term indexes.
 *
 * The public API follows RDF/JS DatasetCore semantics. Four indexes accelerate
 * common exact-term match patterns without changing the semantic object model.
 * The indexes are deliberately private so a future packed representation can
 * replace them without changing callers.
 *
 * @module
 */

import { key } from './term.ts'
import type {
  GraphTermType,
  ObjectTermType,
  PredicateTermType,
  Quad,
  SubjectTermType,
  Term,
} from './term.ts'
import { iterate } from './source.ts'

/** RDF dataset match pattern. `null` and `undefined` mean wildcard. */
export interface MatchOptionsType {
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject?: SubjectTermType | null
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate?: PredicateTermType | null
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object?: ObjectTermType | null
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph?: GraphTermType | null
}

/** Mutable RDF/JS-style DatasetCore implementation. */
export class Dataset implements Iterable<Quad> {
  /** Primary semantic-key map containing the quads currently owned by this dataset. */
  readonly #quads = new Map<string, Quad>()
  /** Secondary dataset index from subject key to matching quad keys. */
  readonly #subject = new Map<string, IndexBucketType>()
  /** Secondary dataset index from predicate key to matching quad keys. */
  readonly #predicate = new Map<string, IndexBucketType>()
  /** Secondary dataset index from object key to matching quad keys. */
  readonly #object = new Map<string, IndexBucketType>()
  /** Secondary dataset index from graph key to matching quad keys. */
  readonly #graph = new Map<string, IndexBucketType>()

  /** Seeds the dataset through `addAll` so initial quads and all exact-term indexes use the normal deduplication path. */
  constructor(quads?: Iterable<Quad>) {
    if (quads) this.addAll(quads)
  }

  /** Number of unique quads currently stored. */
  get size(): number {
    return this.#quads.size
  }

  /** Adds one quad and returns this dataset. Existing equal quads are ignored. */
  add(quad: Quad): this {
    const keys = quadKeys(quad)
    if (this.#quads.has(keys.quad)) return this
    this.#quads.set(keys.quad, quad)
    addIndex(this.#subject, keys.subject, keys.quad)
    addIndex(this.#predicate, keys.predicate, keys.quad)
    addIndex(this.#object, keys.object, keys.quad)
    addIndex(this.#graph, keys.graph, keys.quad)
    return this
  }

  /** Adds all quads from a synchronous source. */
  addAll(quads: Iterable<Quad>): this {
    for (const quad of quads) this.add(quad)
    return this
  }

  /** Imports a sync or async source with cooperative cancellation. */
  async import(source: Iterable<Quad> | AsyncIterable<Quad>, options: {
    /** Abort signal checked before and during this operation. */
    readonly signal?: AbortSignal
  } = {}): Promise<this> {
    for await (const quad of iterate(source)) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
      }
      this.add(quad)
    }
    return this
  }

  /** Deletes one equal quad and returns this dataset. */
  delete(quad: Quad): this {
    const keys = quadKeys(quad)
    const stored = this.#quads.get(keys.quad)
    if (!stored) return this
    this.#quads.delete(keys.quad)
    deleteIndex(this.#subject, keys.subject, keys.quad)
    deleteIndex(this.#predicate, keys.predicate, keys.quad)
    deleteIndex(this.#object, keys.object, keys.quad)
    deleteIndex(this.#graph, keys.graph, keys.quad)
    return this
  }

  /** Returns whether this dataset contains an equal quad. */
  has(quad: Quad): boolean {
    return this.#quads.has(key(quad))
  }

  /** Removes every quad. */
  clear(): void {
    this.#quads.clear()
    this.#subject.clear()
    this.#predicate.clear()
    this.#object.clear()
    this.#graph.clear()
  }

  /**
   * Returns a new dataset containing quads that match the RDF/JS pattern.
   *
   * The implementation starts from the smallest available exact-term index and
   * verifies the remaining terms semantically. This avoids a full scan for the
   * dominant selective lookup shapes while retaining correct wildcard behavior.
   */
  match(
    subject: SubjectTermType | null = null,
    predicate: PredicateTermType | null = null,
    object: ObjectTermType | null = null,
    graph: GraphTermType | null = null,
  ): Dataset {
    return new Dataset(this.matchIter({ subject, predicate, object, graph }))
  }

  /** Lazily iterates matching quads without materializing another dataset. */
  *matchIter(options: MatchOptionsType = {}): Generator<Quad> {
    const { subject = null, predicate = null, object = null, graph = null } = options
    const indexed: IndexBucketType[] = []
    if (subject) {
      const value = this.#subject.get(key(subject))
      if (!value) return
      indexed.push(value)
    }
    if (predicate) {
      const value = this.#predicate.get(key(predicate))
      if (!value) return
      indexed.push(value)
    }
    if (object) {
      const value = this.#object.get(key(object))
      if (!value) return
      indexed.push(value)
    }
    if (graph) {
      const value = this.#graph.get(key(graph))
      if (!value) return
      indexed.push(value)
    }

    const candidates = indexed.length === 0 ? this.#quads.keys() : bucketValues(smallest(indexed))

    for (const quadKey of candidates) {
      const quad = this.#quads.get(quadKey)
      if (!quad) continue
      if (subject && !quad.subject.equals(subject)) continue
      if (predicate && !quad.predicate.equals(predicate)) continue
      if (object && !quad.object.equals(object)) continue
      if (graph && !quad.graph.equals(graph)) continue
      yield quad
    }
  }

  /** Deletes all quads matching a pattern and returns this dataset. */
  deleteMatches(
    subject: SubjectTermType | null = null,
    predicate: PredicateTermType | null = null,
    object: ObjectTermType | null = null,
    graph: GraphTermType | null = null,
  ): this {
    for (const quad of [...this.matchIter({ subject, predicate, object, graph })]) this.delete(quad)
    return this
  }

  /** Returns an inexpensive exact-term cardinality estimate when an index exists. */
  estimate(options: MatchOptionsType = {}): number | undefined {
    const counts: number[] = []
    if (options.subject) counts.push(bucketSize(this.#subject.get(key(options.subject))))
    if (options.predicate) counts.push(bucketSize(this.#predicate.get(key(options.predicate))))
    if (options.object) counts.push(bucketSize(this.#object.get(key(options.object))))
    if (options.graph) counts.push(bucketSize(this.#graph.get(key(options.graph))))
    if (counts.length === 0) return this.size
    return Math.min(...counts)
  }

  /** Returns the dataset quads in insertion order. */
  [Symbol.iterator](): Iterator<Quad> {
    return this.#quads.values()
  }
}

/** Exact-term index bucket that stores a singleton quad key directly and promotes to a Set only after a second match. */
type IndexBucketType = string | Set<string>

/** Canonical semantic keys computed once per quad for deduplication plus subject/predicate/object/graph indexing. */
interface QuadKeysType {
  /** Collision-safe semantic key for the indexed quad. */
  readonly quad: string
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: string
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: string
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: string
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph: string
}

/** Computes component keys once so indexed insertion does not repeat RDF term serialization. */
function quadKeys(quad: Quad): QuadKeysType {
  const subject = key(quad.subject)
  const predicate = key(quad.predicate)
  const object = key(quad.object)
  const graph = key(quad.graph)
  return {
    quad: `Q${part(subject)}${part(predicate)}${part(object)}${part(graph)}`,
    subject,
    predicate,
    object,
    graph,
  }
}

/** Length-prefixes one already-serialized term key exactly like the public quad key format. */
function part(value: string): string {
  return `${value.length}:${value}`
}

/** Creates an in-memory dataset. */
export function dataset(quads?: Iterable<Quad>): Dataset {
  return new Dataset(quads)
}

/** Adds one quad key, allocating a Set only after a term has multiple quads. */
function addIndex(index: Map<string, IndexBucketType>, termKey: string, quadKey: string): void {
  const current = index.get(termKey)
  if (current === undefined) {
    index.set(termKey, quadKey)
    return
  }
  if (typeof current === 'string') {
    if (current !== quadKey) index.set(termKey, new Set([current, quadKey]))
    return
  }
  current.add(quadKey)
}

/** Removes one quad key and demotes two-entry Sets back to singleton strings. */
function deleteIndex(index: Map<string, IndexBucketType>, termKey: string, quadKey: string): void {
  const current = index.get(termKey)
  if (current === undefined) return
  if (typeof current === 'string') {
    if (current === quadKey) index.delete(termKey)
    return
  }
  current.delete(quadKey)
  if (current.size === 0) index.delete(termKey)
  else if (current.size === 1) index.set(termKey, current.values().next().value!)
}

/** Returns the cardinality of one optional compact index bucket. */
function bucketSize(value: IndexBucketType | undefined): number {
  if (value === undefined) return 0
  return typeof value === 'string' ? 1 : value.size
}

/** Iterates singleton and multi-quad buckets through one allocation-free lookup shape. */
function* bucketValues(value: IndexBucketType): Generator<string> {
  if (typeof value === 'string') yield value
  else yield* value
}

/** Chooses the narrowest exact-term index before semantic verification. */
function smallest(values: readonly IndexBucketType[]): IndexBucketType {
  let selected = values[0]!
  let selectedSize = bucketSize(selected)
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!
    const size = bucketSize(value)
    if (size < selectedSize) {
      selected = value
      selectedSize = size
    }
  }
  return selected
}

/** Returns whether two datasets contain exactly the same RDF terms. */
export function datasetEquals(left: Iterable<Quad>, right: Iterable<Quad>): boolean {
  const other = right instanceof Dataset ? right : new Dataset(right)
  let count = 0
  for (const quad of left) {
    count++
    if (!other.has(quad)) return false
  }
  return count === other.size
}

/** Returns a stable semantic digest input by sorting term keys. */
export function datasetKey(value: Iterable<Quad>): string {
  return [...value].map((quad) => key(quad)).sort().join('\n')
}

/** Re-exports Term in TSDoc references without adding another public data model. */
export type { Term }
