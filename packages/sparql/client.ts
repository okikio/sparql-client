/** Engine-neutral SPARQL query and update contracts. @module */

import type { Quad } from '@okikio/rdf'
import type { SparqlQuery, SparqlUpdate } from './sparql.ts'
import type { BindingType } from './result/binding.ts'

/** Query text accepted by engines and protocol clients. */
export type QueryInputType = string | SparqlQuery | { readonly build: () => SparqlQuery }

/** Update text accepted by engines and protocol clients. */
export type UpdateInputType = string | SparqlUpdate | { readonly build: () => SparqlUpdate }

/** Per-operation cancellation and implementation-defined timing controls. */
export interface QueryOptionsType {
  readonly signal?: AbortSignal
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
  queryBindings(query: QueryInputType, options?: QueryOptionsType): Promise<AsyncIterable<BindingType>>
  queryQuads(query: QueryInputType, options?: QueryOptionsType): Promise<AsyncIterable<Quad>>
  queryBoolean(query: QueryInputType, options?: QueryOptionsType): Promise<boolean>
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
