/** Engine-neutral SPARQL query and update contracts. @module */

import type { Quad } from '@okikio/rdf'
import type { SparqlQueryType, SparqlUpdateType } from './sparql.ts'
import type { BindingType } from './result/binding.ts'

/** Query text accepted by engines and protocol clients. */
export type QueryInputType = string | SparqlQueryType | {
  /** Builds the final SPARQL request text from the deferred input object. */
  readonly build: () => SparqlQueryType
}

/** Update text accepted by engines and protocol clients. */
export type UpdateInputType = string | SparqlUpdateType | {
  /** Builds the final SPARQL request text from the deferred input object. */
  readonly build: () => SparqlUpdateType
}

/** Per-operation cancellation and implementation-defined timing controls. */
export interface QueryOptionsType {
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
  /** Maximum request duration in milliseconds before the operation aborts its internal request. */
  readonly timeoutMs?: number | null
}

/**
 * Result-mode-specific SPARQL engine contract.
 *
 * Query and update document types are intentionally distinct. This prevents a
 * complete update from reaching a SELECT/ASK path and prevents a query builder
 * from being submitted as an update by structural accident.
 */
export interface Queryable {
  /** Executes a SELECT-style query and returns solution bindings. */
  queryBindings(
    query: QueryInputType,
    options?: QueryOptionsType,
  ): Promise<AsyncIterable<BindingType>>
  /** Executes a CONSTRUCT or DESCRIBE query and returns RDF quads. */
  queryQuads(query: QueryInputType, options?: QueryOptionsType): Promise<AsyncIterable<Quad>>
  /** Executes an ASK query and returns its Boolean result. */
  queryBoolean(query: QueryInputType, options?: QueryOptionsType): Promise<boolean>
  /** Executes a SPARQL Update request. */
  update(update: UpdateInputType, options?: QueryOptionsType): Promise<void>
}

/** Resolves a complete query builder/document or raw string to protocol text. */
export function getQueryText(input: QueryInputType): string {
  if (typeof input === 'string') return input
  if ('build' in input) return input.build().value
  return input.value
}

/** Resolves a complete update builder/document or raw string to protocol text. */
export function getUpdateText(input: UpdateInputType): string {
  if (typeof input === 'string') return input
  if ('build' in input) return input.build().value
  return input.value
}
