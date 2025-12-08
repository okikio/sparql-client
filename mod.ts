/**
 * SPARQL Query Builder
 * 
 * A type-safe, fluent query builder for SPARQL inspired by Drizzle ORM and
 * Supabase PostgREST.js. Makes graph database queries readable and maintainable.
 * 
 * @example
 * ```typescript
 * import { node, rel, select, variable, execute } from './mod.ts'
 * 
 * const person = node('person', 'foaf:Person')
 *   .with.prop('foaf:name', variable('name'))
 *   .and.prop('foaf:age', variable('age'))
 * 
 * const result = await select(['?name', '?age'])
 *   .where(person)
 *   .filter(gte(variable('age'), 18))
 *   .orderBy('?name')
 *   .limit(10)
 *   .execute({ endpoint: 'http://localhost:9999/sparql' })
 * ```
 * 
 * @module
 */

// ============================================================================
// Core SPARQL Value Types & Helpers
// ============================================================================

export * from './sparql.ts'
export * from './utils.ts'
export * from './patterns/triples.ts'
export * from './patterns/objects.ts'
export * from './patterns/cypher.ts'
export * from './builder.ts'
export * from './executor.ts'