/** Oxigraph Store integration for the engine-neutral SPARQL query contract. @module */

import { fromQuad, fromTerm, type Quad, type Term } from '@okikio/rdf'
import { getQueryText, getUpdateText, type Queryable, type QueryOptionsType } from '@okikio/sparql'
import type { BindingType } from '@okikio/sparql'

/** Minimal Oxigraph Store surface used by this adapter. */
export interface Store {
  /** Executes the supplied SPARQL query without taking ownership of the adapted store. */
  query(query: string, options?: Readonly<Record<string, unknown>>): unknown
  /** Executes the supplied SPARQL update without taking ownership of the adapted store. */
  update(update: string, options?: Readonly<Record<string, unknown>>): void
}

/** Oxigraph adapter options. */
export interface OxigraphOptionsType {
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
 * Wraps an already-created Oxigraph Store without initializing Wasm or taking ownership.
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
 * const client = oxigraph.create(store)
 * const exists = await client.queryBoolean('ASK { ?s ?p ?o }')
 * ```
 */
export function create(store: Store, options: OxigraphOptionsType = {}): Client {
  return {
    store,
    /** Query bindings through the wrapped engine without transferring engine ownership. */
    async queryBindings(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      if (!isIterable(result)) {
        throw new TypeError('Oxigraph SELECT query did not return an iterable of bindings.')
      }
      return bindings(result)
    },
    /** Query quads through the wrapped engine without transferring engine ownership. */
    async queryQuads(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      if (!isIterable(result)) {
        throw new TypeError('Oxigraph graph query did not return an iterable of quads.')
      }
      return quads(result)
    },
    /** Query boolean through the wrapped engine without transferring engine ownership. */
    async queryBoolean(query, queryOptions = {}) {
      prepare(queryOptions)
      const result = store.query(getQueryText(query), options.query)
      if (typeof result !== 'boolean') {
        throw new TypeError('Oxigraph ASK query did not return a boolean.')
      }
      return result
    },
    /** Submits one complete SPARQL Update document through the wrapped engine. */
    async update(update, queryOptions = {}) {
      prepare(queryOptions)
      store.update(getUpdateText(update), options.update)
    },
  }
}

/** Validates operation controls that the synchronous engine can actually honor. */
function prepare(options: QueryOptionsType): void {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  if (options.timeoutMs !== undefined && options.timeoutMs !== null && options.timeoutMs > 0) {
    throw new TypeError(
      'Oxigraph synchronous Store queries cannot honor timeoutMs. Run the store in an owned Worker when interruptibility is required.',
    )
  }
}

/** Adapts synchronous engine binding rows to the asynchronous query contract. */
async function* bindings(values: Iterable<unknown>): AsyncGenerator<BindingType> {
  for (const value of values) {
    if (!(value instanceof Map)) throw new TypeError('Oxigraph SELECT row is not a Map.')
    const binding = new Map<string, ReturnType<typeof fromTerm>>()
    for (const [name, term] of value) {
      if (typeof name !== 'string') {
        throw new TypeError('Oxigraph binding variable name is not a string.')
      }
      if (!isTerm(term)) throw new TypeError(`Oxigraph binding '${name}' is not an RDF term.`)
      binding.set(name.replace(/^[?$]/, ''), fromTerm(term))
    }
    yield binding
  }
}

/** Adapts synchronous engine graph rows to the asynchronous query contract. */
async function* quads(values: Iterable<unknown>): AsyncGenerator<Quad> {
  for (const value of values) {
    if (!isQuad(value)) throw new TypeError('Oxigraph graph result contains a non-quad value.')
    yield fromQuad(value)
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
