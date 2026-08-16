/**
 * SPARQL construction, query contracts, and protocol-neutral values.
 *
 * Endpoint transport is available from `@okikio/sparql/http`. Query engines
 * implement the result-mode-specific `Queryable` contract instead of being
 * imported by this package.
 *
 * @module
 */

export * from './sparql.ts'
export * from './utils.ts'
export * from './builder.ts'
export * from './update.ts'
export * from './patterns/triples.ts'
export * from './patterns/objects.ts'
export * from './patterns/cypher.ts'
export { getQueryText, getUpdateText } from './client.ts'
export type { Queryable, QueryInputType, QueryOptionsType, UpdateInputType } from './client.ts'
export { mapBindings } from './result/binding.ts'
export type { BindingType } from './result/binding.ts'
