/**
 * SPARQL Query Builder - Type-safe graph database queries.
 * 
 * Building SPARQL queries by hand is tedious and error-prone. This library gives
 * you a fluent, type-safe API inspired by Drizzle ORM and Cypher. Write queries
 * that look natural in code, get proper escaping and validation automatically.
 * 
 * The library has three layers:
 * 
 * 1. **Core types and values** (sparql.ts) - The foundation for representing SPARQL
 *    values. Template literal support for automatic type conversion.
 * 
 * 2. **Pattern builders** (triples.ts, objects.ts, cypher.ts) - Higher-level APIs
 *    for describing graph patterns. Choose between triple-based patterns, object-like
 *    node descriptions, or ASCII art syntax.
 * 
 * 3. **Query builder** (builder.ts) - Fluent chainable interface for constructing
 *    complete queries. Add clauses, filters, sorting, pagination.
 * 
 * Start with the pattern style that feels natural for your use case. Simple queries
 * might use raw triples. Complex graph structures benefit from node patterns. The
 * query builder ties it all together.
 * 
 * @example Quick start
 * ```ts
 * import { select, triple, v, execute } from './mod.ts'
 * 
 * const result = await select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .filter(gte(v('age'), 18))
 *   .orderBy('?name')
 *   .limit(10)
 *   .execute({ endpoint: 'http://localhost:9999/sparql' })
 * 
 * if (result.success) {
 *   console.log(result.data.results.bindings)
 * }
 * ```
 * 
 * @example Using node patterns
 * ```ts
 * import { node, rel, select, v, str } from './mod.ts'
 * 
 * const person = node('person', 'foaf:Person')
 *   .prop('foaf:name', v('name'))
 *   .prop('foaf:age', v('age'))
 * 
 * const friend = node('friend', 'foaf:Person')
 *   .prop('foaf:name', str('Alice'))
 * 
 * const query = select(['?name', '?age'])
 *   .where(person)
 *   .where(rel('person', 'foaf:knows', 'friend'))
 *   .where(friend)
 * ```
 * 
 * @example Complex filtering and aggregation
 * ```ts
 * import { select, triples, v, and, gte, regex, count } from './mod.ts'
 * 
 * const query = select([count(v('product')).as('total')])
 *   .where(triples('?product', [
 *     ['rdf:type', 'schema:Product'],
 *     ['schema:price', '?price'],
 *     ['schema:name', '?name']
 *   ]))
 *   .filter(and(
 *     gte(v('price'), 10),
 *     regex(v('name'), 'Spider', 'i')
 *   ))
 * ```
 * 
 * @module
 */

// Core SPARQL types and template tag
export * from './sparql.ts'

// Expression helpers and query utilities
export * from './utils.ts'

// Pattern construction helpers
export * from './patterns/triples.ts'
export * from './patterns/objects.ts'
export * from './patterns/cypher.ts'

// Query builder
export * from './builder.ts'

// Query execution
export * from './executor.ts'