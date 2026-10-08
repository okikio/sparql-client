/** Oxigraph Store integration for the engine-neutral SPARQL query contract. @module */

import type { BindingType, Queryable, QueryOptionsType, ResultType } from '@okikio/sparql'
import type { Quad, Term } from '@okikio/rdf'
import { fromQuad, fromTerm } from '@okikio/rdf'
import { getQueryText, getUpdateText, result as stream } from '@okikio/sparql'

/** Minimal Oxigraph Store surface used by this adapter. */
export interface Store {
  /** Executes the supplied SPARQL query without taking ownership of the adapted store. */
  query(query: string, options?: Readonly<Record<string, unknown>>): unknown
  /** Executes the supplied SPARQL update without taking ownership of the adapted store. */
  update(update: string, options?: Readonly<Record<string, unknown>>): void
}

/** Oxigraph adapter options. */
export interface OxigraphOptionsType {
  /**
   * Transfers materialized query-result wrappers to this operation when `owned`.
   * Use this for native Oxigraph Store arrays: all returned terms, quads and
   * getter-created children are retired after conversion or cancellation.
   * The default `borrowed` preserves structural-store inputs and never frees
   * their values. Neither mode transfers ownership of the supplied Store.
   */
  readonly results?: 'borrowed' | 'owned'

  /** Static query options forwarded to `Store.query()`. */
  readonly query?: Readonly<Record<string, unknown>>
  /** Static update options forwarded to `Store.update()`. */
  readonly update?: Readonly<Record<string, unknown>>
}

/** Oxigraph-backed query interface. The supplied store remains caller-owned. */
export interface Client extends Queryable {
  /** Caller-owned Oxigraph store. The adapter borrows it and never creates hidden global store state. */
  readonly store: Store
}

/**
 * Wraps an already-created Oxigraph Store without initializing Wasm or taking Store ownership.
 * Pass `results: 'owned'` for native materialized query arrays so their wrappers
 * are retired independently of the Store. Structural borrowed results remain
 * the default; owned mode does not promise ownership of a lazy iterable.
 *
 * Oxigraph's current JavaScript Store API is synchronous. Abort signals are
 * therefore checked before execution, and timeout requests are rejected rather
 * than pretending a synchronous Wasm call can be interrupted.
 *
 * @example
 * ```ts
 * import * as oxigraph from '@okikio/oxigraph'
 *
 * // `store` is an Oxigraph Store created and owned by the application.
 * const client = oxigraph.create(store, { results: 'owned' })
 * const exists = await client.queryBoolean('ASK { ?s ?p ?o }')
 * ```
 */
export function create(store: Store, options: OxigraphOptionsType = {}): Client {
  if (
    options.results !== undefined && options.results !== 'borrowed' && options.results !== 'owned'
  ) {
    throw new TypeError('results must be borrowed or owned.')
  }
  const owned = options.results === 'owned'

  return {
    store,
    /** Query bindings through the wrapped engine without transferring engine ownership. */
    queryBindings(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      return Promise.resolve(adapt(result, queryOptions, owned, 'bindings', store))
    },
    /** Query quads through the wrapped engine without transferring engine ownership. */
    queryQuads(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      return Promise.resolve(adapt(result, queryOptions, owned, 'quads', store))
    },
    /** Query boolean through the wrapped engine without transferring engine ownership. */
    queryBoolean(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      if (typeof result !== 'boolean') {
        reject(result, owned, new TypeError('Oxigraph ASK query did not return a boolean.'), store)
      }
      return Promise.resolve(result)
    },
    /** Submits one complete SPARQL Update document through the wrapped engine. */
    update(update, queryOptions = {}) {
      prepare(queryOptions)
      return Promise.resolve().then(() => {
        prepare(queryOptions)
        store.update(getUpdateText(update), options.update)
      })
    },
  }
}

/** Validates operation controls that the synchronous engine can actually honor. */
function prepare(options: QueryOptionsType): void {
  if (options.signal?.aborted) {
    throw options.signal.reason
  }
  if (
    options.timeoutMs !== undefined && options.timeoutMs !== null &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  ) {
    throw new RangeError('timeoutMs must be finite and nonnegative, or null.')
  }
  if (options.timeoutMs !== undefined && options.timeoutMs !== null && options.timeoutMs > 0) {
    throw new TypeError(
      'Oxigraph synchronous Store queries cannot honor timeoutMs. Run the store in an owned Worker when interruptibility is required.',
    )
  }
}

/**
 * Acquisition owns every materialized wrapper before the consumer's first pull.
 * Generic iterables remain borrowed; owned mode never drains an unknown source
 * to discover resources. Detached values do not retain native pointers.
 */
function adapt(
  values: unknown,
  options: QueryOptionsType,
  owned: boolean,
  mode: 'bindings',
  store: Store,
): ResultType<BindingType>
function adapt(
  values: unknown,
  options: QueryOptionsType,
  owned: boolean,
  mode: 'quads',
  store: Store,
): ResultType<Quad>
function adapt(
  values: unknown,
  options: QueryOptionsType,
  owned: boolean,
  mode: 'bindings' | 'quads',
  store: Store,
): ResultType<BindingType> | ResultType<Quad> {
  const lease = owned ? new Lease(store) : undefined
  try {
    lease?.acquire(values)
    if ((owned && !Array.isArray(values)) || !isIterable(values)) {
      throw new TypeError(
        owned
          ? 'Owned Oxigraph results require a materialized array of bindings or quads.'
          : `Oxigraph ${mode} query did not return an iterable.`,
      )
    }
    if (owned) {
      for (const row of values as unknown[]) {
        if (mode === 'bindings' ? !(row instanceof Map) : !isQuad(row)) {
          throw new TypeError(`Owned Oxigraph ${mode} result contains an invalid row.`)
        }
      }
    }
    // Own our array of references without mutating a structural Store's array.
    // Clear it after retirement even when the caller retains the closed result.
    const rows = owned ? (values as unknown[]).slice() : undefined
    const source = mode === 'bindings'
      ? bindings(rows ?? values, lease)
      : quads(rows ?? values, lease)
    const settings = {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(lease
        ? {
          async release(): Promise<void> {
            const failures: unknown[] = []
            try {
              await source.return(undefined)
            } catch (reason) {
              failures.push(reason)
            }
            try {
              lease.release()
            } catch (reason) {
              failures.push(reason)
            }
            if (rows) rows.length = 0
            fail(failures, 'Oxigraph iterator and wrapper cleanup failed.')
          },
        }
        : {}),
    }
    return mode === 'bindings'
      ? stream<BindingType>(source as AsyncGenerator<BindingType>, settings)
      : stream<Quad>(source as AsyncGenerator<Quad>, settings)
  } catch (primary) {
    const failures = [primary]
    try {
      lease?.release()
    } catch (reason) {
      failures.push(reason)
    }
    fail(failures, 'Oxigraph result acquisition and cleanup failed.')
    throw primary
  }
}

/** Rejects an acquired wrong-mode result while retiring explicitly transferred wrappers. */
function reject(values: unknown, owned: boolean, primary: unknown, store: Store): never {
  const lease = owned ? new Lease(store) : undefined
  const failures = [primary]
  try {
    lease?.acquire(values)
  } catch (reason) {
    failures.push(reason)
  }
  try {
    lease?.release()
  } catch (reason) {
    failures.push(reason)
  }
  fail(failures, 'Oxigraph result mode and cleanup failed.')
  throw primary
}

/** Owns one materialized query result independently of the borrowed Store. */
class Lease {
  readonly #borrowed: Store
  readonly #seen = new Set<object>()
  readonly #pending = new Map<object, () => void>()
  readonly #children = new Map<object, Set<object>>()
  #copied = new WeakMap<object, Term>()

  /** Excludes the borrowed Store even when a malformed result returns that same object. */
  constructor(store: Store) {
    this.#borrowed = store
  }

  /** Registers every known parent even when a different parent has invalid disposal metadata. */
  acquire(values: unknown): void {
    const failures: unknown[] = []
    const register = (value: unknown): void => {
      try {
        this.#register(value)
      } catch (reason) {
        failures.push(reason)
      }
    }
    const row = (value: unknown): void => {
      if (value instanceof Map) {
        for (const term of Map.prototype.values.call(value)) register(term)
      } else register(value)
    }
    for (const value of Array.isArray(values) ? values : [values]) {
      try {
        row(value)
      } catch (reason) {
        failures.push(reason)
      }
    }
    fail(failures, 'Oxigraph wrapper acquisition failed.')
  }

  /** Captures each semantic getter once, then delegates RDF validation to the native factory. */
  copy(value: Term): ReturnType<typeof fromTerm> {
    const copied = this.#copied
    const snapshot = (original: unknown, parent?: object, depth = 0): Term => {
      if (typeof original !== 'object' || original === null) {
        throw new TypeError('Oxigraph RDF child is not a term.')
      }
      this.#register(original)
      if (parent) {
        let children = this.#children.get(parent)
        if (!children) this.#children.set(parent, children = new Set())
        children.add(original)
      }
      if (depth > 512) throw new RangeError('Excessively nested Oxigraph RDF term input.')
      const previous = copied.get(original)
      if (previous) return previous
      const termType: unknown = Reflect.get(original, 'termType')
      const record: Record<string, unknown> = {
        termType,
        value: Reflect.get(original, 'value'),
        equals: Reflect.get(original, 'equals'),
      }
      // The RDF factory validates this structural snapshot, including cycles,
      // literal tuples and legal quad roles; it never reads native getters.
      const term = record as unknown as Term
      copied.set(original, term)
      if (termType === 'Literal') {
        record.language = Reflect.get(original, 'language')
        record.direction = Reflect.get(original, 'direction')
        record.datatype = snapshot(Reflect.get(original, 'datatype'), original, depth + 1)
      } else if (termType === 'Quad') {
        for (const name of ['subject', 'predicate', 'object', 'graph']) {
          record[name] = snapshot(Reflect.get(original, name), original, depth + 1)
        }
      }
      return term
    }
    return fromTerm(snapshot(value))
  }

  /** Releases unique child pointers before parents and attempts every independent disposal. */
  release(): void {
    const visited = new Set<object>()
    const failures: unknown[] = []
    const retire = (value: object): void => {
      if (visited.has(value)) return
      visited.add(value)
      for (const child of this.#children.get(value) ?? []) retire(child)
      const free = this.#pending.get(value)
      this.#pending.delete(value)
      if (free) {
        try {
          free()
        } catch (reason) {
          failures.push(reason)
        }
      }
    }
    for (const value of this.#pending.keys()) retire(value)
    this.#children.clear()
    this.#seen.clear()
    this.#copied = new WeakMap()
    fail(failures, 'Oxigraph wrapper cleanup failed.')
  }

  /** A callable free protocol is adopted only after explicit result ownership transfer. */
  #register(value: unknown): void {
    if (
      typeof value !== 'object' || value === null || value === this.#borrowed ||
      this.#seen.has(value)
    ) return
    this.#seen.add(value)
    const free: unknown = Reflect.get(value, 'free')
    if (free === undefined) return
    if (typeof free !== 'function') {
      throw new TypeError('Owned Oxigraph wrapper free is not callable.')
    }
    this.#pending.set(value, () => Reflect.apply(free, value, []))
  }
}

/** Keeps the original error identity when no independent cleanup failure occurred. */
function fail(failures: unknown[], message: string): void {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message, { cause: failures[0] })
}

/** Adapts synchronous engine binding rows to the asynchronous query contract. */
async function* bindings(values: Iterable<unknown>, lease?: Lease): AsyncGenerator<BindingType> {
  for (const value of values) {
    if (!(value instanceof Map)) throw new TypeError('Oxigraph SELECT row is not a Map.')
    const binding = new Map<string, ReturnType<typeof fromTerm>>()
    for (const [name, term] of value) {
      if (typeof name !== 'string') {
        throw new TypeError('Oxigraph binding variable name is not a string.')
      }
      if (!isTerm(term)) throw new TypeError(`Oxigraph binding '${name}' is not an RDF term.`)
      binding.set(name.replace(/^[?$]/, ''), lease ? lease.copy(term) : fromTerm(term))
    }
    yield binding
  }
}

/** Adapts synchronous engine graph rows to the asynchronous query contract. */
async function* quads(values: Iterable<unknown>, lease?: Lease): AsyncGenerator<Quad> {
  for (const value of values) {
    if (!isQuad(value)) throw new TypeError('Oxigraph graph result contains a non-quad value.')
    yield lease ? lease.copy(value) as Quad : fromQuad(value)
  }
}

/** Returns whether the supplied value satisfies the iterable contract. */
function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value
}

/** Returns whether the supplied value satisfies the term contract. */
function isTerm(value: unknown): value is Term {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<Term>
  return typeof record.termType === 'string' && typeof record.value === 'string' &&
    typeof record.equals === 'function'
}

/** Returns whether the supplied value satisfies the quad contract. */
function isQuad(value: unknown): value is Quad {
  return isTerm(value) && value.termType === 'Quad' && 'subject' in value && 'predicate' in value &&
    'object' in value && 'graph' in value
}
