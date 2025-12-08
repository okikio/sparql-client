/**
 * Type-safe SPARQL query builder with fluent API
 * 
 * Writing SPARQL queries by hand means string concatenation, manual escaping, and hunting through
 * parentheses when something breaks. You lose autocomplete, type checking, and the ability to compose
 * queries from reusable pieces. This library gives you a modern query builder with type safety and a
 * fluent interface that reads naturally. Write `v('age').gte(18)` instead of `FILTER(?age >= 18)`, chain
 * operations like `v('price').mul(1.2).round()`, and let TypeScript catch errors at compile time.
 * 
 * The library works in three layers. Core types handle value conversion - strings become escaped
 * literals, numbers stay as numbers, dates format correctly. Pattern builders let you describe graphs
 * using triples, nested object notation, or ASCII art syntax. The query builder provides the
 * chainable interface for complete queries with full SPARQL 1.1 support. You can write basic triple
 * patterns like `triple('?person', 'foaf:name', '?name')`, build complex nested structures with
 * `node('product', Product).prop('publisher', node('pub', Organization))`, or use ASCII art paths
 * with `cypher`${product}-[schema:publisher]->${publisher}``. These patterns compose - use triples
 * for simple cases, nested nodes for complex graphs, ASCII art for visual clarity, and mix them in
 * the same query. Every pattern compiles to standard SPARQL triples.
 * 
 * The fluent API makes expressions readable. Instead of `filter(and(gte(v('age'), 18), lt(v('age'), 65)))`,
 * you write `filter(v('age').gte(18).and(v('age').lt(65)))`. For computed values, chain operations
 * left to right: `v('price').mul(0.9).round().add(5).as('discount')`. Conditional logic stays clear with
 * `ifElse(v('inStock').eq(true), v('price').mul(0.9), v('price').add(10))`. String operations chain
 * naturally: `coalesce(v('nickname'), v('name')).ucase().substr(0, 10).concat('...')`. Twenty-one
 * functions return FluentValue for seamless chaining - arithmetic (add, sub, mul, div, mod), math
 * (abs, round, ceil, floor), string operations (concat, strlen, ucase, lcase, substr, replaceStr),
 * conditionals (ifElse, coalesce), and type conversions (str, getlang, datatype).
 * 
 * @example Quick start with triple patterns
 * ```ts
 * const adults = select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .filter(v('age').gte(18))
 *   .orderBy('?name')
 * 
 * const sparql = adults.build()
 * const results = await adults.execute({ endpoint: 'http://localhost:3030/dataset/sparql' })
 * ```
 * 
 * @example Nested object patterns
 * ```ts
 * const products = select(['?title', '?publisherName', '?city'])
 *   .where(
 *     node('product', 'schema:Product', {
 *       'schema:name': v('title'),
 *       'schema:publisher': node('publisher', 'schema:Organization', {
 *         'schema:name': v('publisherName'),
 *         'schema:location': node('location', 'schema:Place', {
 *           'schema:city': v('city')
 *         })
 *       })
 *     })
 *   )
 * ```
 * 
 * @example ASCII art patterns with cypher template tag
 * ```ts
 * const product = node('product', 'schema:Product', {
 *   'schema:name': v('title')
 * })
 * 
 * const publisher = node('publisher', 'schema:Organization', {
 *   'schema:name': v('pubName')
 * })
 * 
 * const query = select(['?title', '?pubName'])
 *   .where(cypher`${product}-[schema:publisher]->${publisher}`)
 * ```
 * 
 * @example Combining patterns with match()
 * ```ts
 * const pattern = match(
 *   node('person', 'foaf:Person', { 'foaf:name': v('name') }),
 *   rel('person', 'foaf:knows', 'friend'),
 *   node('friend', 'foaf:Person', { 'foaf:name': v('friendName') })
 * )
 * 
 * select(['?name', '?friendName']).where(pattern)
 * ```
 * 
 * @example Fluent operations with aggregations
 * ```ts
 * const analytics = select([
 *   v('city'),
 *   count().as('users'),
 *   avg(v('age')).as('avgAge')
 * ])
 *   .where(triple('?user', 'schema:city', '?city'))
 *   .where(triple('?user', 'foaf:age', '?age'))
 *   .groupBy('?city')
 *   .having(count().gte(10))
 *   .orderBy('?users', 'DESC')
 * ```
 * 
 * @example Complex computed values
 * ```ts
 * const pricing = select(['?product', '?finalPrice', '?displayName'])
 *   .where(triple('?product', 'schema:name', '?name'))
 *   .where(triple('?product', 'schema:price', '?basePrice'))
 *   .where(triple('?product', 'schema:inStock', '?inStock'))
 *   .bind(
 *     ifElse(
 *       v('inStock').eq(true),
 *       v('basePrice').mul(0.9).round(),
 *       v('basePrice').add(10)
 *     ).as('finalPrice')
 *   )
 *   .bind(
 *     v('name').ucase().substr(0, 15).concat('...').as('displayName')
 *   )
 *   .filter(v('finalPrice').gte(10))
 * ```
 * 
 * @example Nested subqueries
 * ```ts
 * const topSellers = select([v('product'), count().as('sales')])
 *   .where(triple('?order', 'schema:product', '?product'))
 *   .groupBy('?product')
 *   .orderBy('?sales', 'DESC')
 *   .limit(10)
 * 
 * const enriched = select(['?product', '?name', '?sales'])
 *   .where(subquery(topSellers))
 *   .where(triple('?product', 'schema:name', '?name'))
 * ```
 * 
 * @example Property paths for transitive relationships
 * ```ts
 * // Find all contacts through any number of "knows" hops
 * const network = select(['?person', '?contact'])
 *   .where(triple('?person', zeroOrMore('foaf:knows'), '?contact'))
 *   .filter(v('person').neq(v('contact')))
 * 
 * // Navigate nested properties
 * const cities = select(['?person', '?city'])
 *   .where(triple('?person', sequence('schema:address', 'schema:city'), '?city'))
 * 
 * // Alternative predicates
 * const names = select(['?person', '?name'])
 *   .where(triple('?person', alternative('foaf:name', 'schema:name'), '?name'))
 * ```
 * 
 * @example Update operations with fluent API
 * ```ts
 * // Increment ages
 * const incrementAge = modify()
 *   .delete(triple('?person', 'foaf:age', '?oldAge'))
 *   .insert(triple('?person', 'foaf:age', v('oldAge').add(1)))
 *   .where(triple('?person', 'foaf:age', '?oldAge'))
 *   .where(filter(v('oldAge').gte(0)))
 *   .done()
 * 
 * await incrementAge.execute({ endpoint: 'http://localhost:3030/dataset/update' })
 * ```
 * 
 * @example Chain-style node building with nested relationships
 * ```ts
 * const pattern = node('person', 'foaf:Person')
 *   .prop('foaf:name', v('personName'))
 *   .prop('foaf:knows', node('friend', 'foaf:Person', {
 *     'foaf:name': v('friendName'),
 *     'schema:city': v('friendCity')
 *   }))
 * 
 * select(['?personName', '?friendName', '?friendCity']).where(pattern)
 * ```
 * 
 * @example Named graphs and federation
 * ```ts
 * // Query specific graph
 * const graphData = select(['?s', '?p', '?o'])
 *   .fromNamed('http://example.org/graph1')
 *   .where(graph('?g', triple('?s', '?p', '?o')))
 * 
 * // Federated query
 * const federated = select(['?person', '?birthPlace'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(
 *     service(
 *       'http://dbpedia.org/sparql',
 *       triple('?person', 'dbo:birthPlace', '?birthPlace')
 *     )
 *   )
 * ```
 * 
 * @example Complete e-commerce scenario
 * ```ts
 * const productQuery = select([
 *   v('name'),
 *   v('finalPrice'),
 *   v('stockStatus'),
 *   v('categoryName')
 * ])
 *   .where(
 *     node('product', 'schema:Product', {
 *       'schema:name': v('name'),
 *       'schema:price': v('basePrice'),
 *       'schema:inventory': v('stock'),
 *       'schema:category': node('category', 'schema:Category', {
 *         'schema:name': v('categoryName')
 *       })
 *     })
 *   )
 *   .bind(
 *     ifElse(
 *       v('stock').gt(0),
 *       v('basePrice').mul(0.9).round(),
 *       v('basePrice').add(10)
 *     ).as('finalPrice')
 *   )
 *   .bind(
 *     ifElse(
 *       v('stock').gt(10),
 *       'In Stock',
 *       ifElse(v('stock').gt(0), 'Low Stock', 'Out of Stock')
 *     ).as('stockStatus')
 *   )
 *   .filter(v('finalPrice').gte(10))
 *   .orderBy('?finalPrice')
 *   .limit(50)
 * ```
 * 
 * @module
 */

// Core types and utilities
export * from './sparql.ts'
export * from './utils.ts'

// Pattern builders - choose your style
export * from './patterns/triples.ts'
export * from './patterns/objects.ts'
export * from './patterns/cypher.ts'

// Query builder and execution
export * from './builder.ts'
export * from './update.ts'
export * from './executor.ts'