/** Comunica QueryEngine integration for the engine-neutral SPARQL contract. @module */

import { fromQuad, fromTerm, type Quad, type Term } from '@okikio/rdf'
import { getQueryText, getUpdateText, type Queryable, type QueryOptionsType } from '@okikio/sparql'
import type { BindingType } from '@okikio/sparql'

/** Async result stream shape returned by Comunica query methods. */
export interface ResultStream<Value> extends AsyncIterable<Value> {
  /** Node-style streams expose `destroy`; the adapter uses it for early cancellation when available. */
  destroy?(error?: Error): void
}

/** Minimal Comunica QueryEngine surface used by this adapter. */
export interface QueryEngine {
  /** Executes a bindings-producing SPARQL query through the adapted engine. */
  queryBindings(query: string, context?: unknown): Promise<ResultStream<unknown>>
  /** Executes a quad-producing SPARQL query through the adapted engine. */
  queryQuads(query: string, context?: unknown): Promise<ResultStream<unknown>>
  /** Executes a SPARQL ASK query through the adapted engine. */
  queryBoolean(query: string, context?: unknown): Promise<boolean>
  /** Executes a SPARQL Update request and resolves when the adapted engine finishes. */
  queryVoid(query: string, context?: unknown): Promise<void>
}

/** Comunica integration configuration. */
export interface ComunicaOptionsType {
  /** Creates the engine-specific query context for each operation. */
  readonly context?: (options: QueryOptionsType) => unknown
}

/** Comunica-backed query interface. The supplied QueryEngine remains caller-owned. */
export interface Client extends Queryable {
  /** Caller-owned Comunica engine. Creating or closing this client does not transfer engine ownership. */
  readonly engine: QueryEngine
}

/**
 * Wraps an already-created Comunica QueryEngine without taking engine ownership.
 *
 * Stream queries destroy their upstream result stream when the consumer returns
 * early or the supplied signal aborts. Boolean/void cancellation still depends
 * on the query context provided to Comunica because those methods return one
 * promise rather than a cancellable stream.
 *
 * @example
 * ```ts
 * import * as comunica from '@okikio/comunica'
 *
 * // `engine` is a Comunica QueryEngine created and owned by the application.
 * const client = comunica.create(engine)
 * const exists = await client.queryBoolean('ASK { ?s ?p ?o }')
 * ```
 */
export function create(engine: QueryEngine, options: ComunicaOptionsType = {}): Client {
  return {
    engine,
    /** Query bindings through the wrapped engine without transferring engine ownership. */
    async queryBindings(query, queryOptions = {}) {
      abort(queryOptions.signal)
      const stream = await engine.queryBindings(
        getQueryText(query),
        options.context?.(queryOptions),
      )
      return mapStream(stream, queryOptions.signal, decodeBinding)
    },
    /** Query quads through the wrapped engine without transferring engine ownership. */
    async queryQuads(query, queryOptions = {}) {
      abort(queryOptions.signal)
      const stream = await engine.queryQuads(getQueryText(query), options.context?.(queryOptions))
      return mapStream(stream, queryOptions.signal, decodeQuad)
    },
    /** Query boolean through the wrapped engine without transferring engine ownership. */
    async queryBoolean(query, queryOptions = {}) {
      abort(queryOptions.signal)
      const result = await engine.queryBoolean(getQueryText(query), options.context?.(queryOptions))
      abort(queryOptions.signal)
      return result
    },
    /** Submits one complete SPARQL Update document through the wrapped engine. */
    async update(update, queryOptions = {}) {
      abort(queryOptions.signal)
      await engine.queryVoid(getUpdateText(update), options.context?.(queryOptions))
      abort(queryOptions.signal)
    },
  }
}

/** Maps one upstream engine stream and destroys unfinished work when consumption stops early. */
async function* mapStream<Input, Output>(
  stream: ResultStream<Input>,
  signal: AbortSignal | undefined,
  map: (value: Input) => Output,
): AsyncGenerator<Output> {
  let complete = false
  const onAbort = (): void => stream.destroy?.(abortError(signal))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const value of stream) {
      abort(signal)
      yield map(value)
    }
    complete = true
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!complete) stream.destroy?.()
  }
}

/** Converts one engine-specific binding row into the engine-neutral RDF binding map. */
function decodeBinding(value: unknown): BindingType {
  if (
    typeof value !== 'object' || value === null || !('entries' in value) ||
    typeof value.entries !== 'function'
  ) {
    throw new TypeError('Comunica binding row does not expose entries().')
  }
  const result = new Map<string, ReturnType<typeof fromTerm>>()
  for (const entry of value.entries() as Iterable<readonly [unknown, unknown]>) {
    const [variable, term] = entry
    const name = variableName(variable)
    if (!isTerm(term)) throw new TypeError(`Comunica binding '${name}' is not an RDF term.`)
    result.set(name, fromTerm(term))
  }
  return result
}

/** Converts one engine-specific graph result into a native RDF quad. */
function decodeQuad(value: unknown): Quad {
  if (
    !isTerm(value) || value.termType !== 'Quad' || !('subject' in value) ||
    !('predicate' in value) || !('object' in value) || !('graph' in value)
  ) {
    throw new TypeError('Comunica graph result contains a non-quad value.')
  }
  return fromQuad(value as Quad)
}

/** Normalizes an engine binding key to the SPARQL variable name without its sigil. */
function variableName(value: unknown): string {
  if (typeof value === 'string') return value.replace(/^[?$]/, '')
  if (isTerm(value) && value.termType === 'Variable') return value.value
  throw new TypeError('Comunica binding key is not a variable or string.')
}

/** Returns whether the supplied value satisfies the term contract. */
function isTerm(value: unknown): value is Term {
  if (typeof value !== 'object' || value === null) return false
  const term = value as Partial<Term>
  return typeof term.termType === 'string' && typeof term.value === 'string' &&
    typeof term.equals === 'function'
}

/** Throws the caller supplied abort reason when cancellation has been requested. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Converts an abort reason into the Error shape required by upstream stream destruction. */
function abortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError')
}
