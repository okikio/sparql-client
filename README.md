# SPARQL Query Builder

Writing SPARQL queries by hand means string concatenation, manual escaping, and hunting through parentheses when something breaks. This library gives you a type-safe query builder with a fluent API. Write `v('age').gte(18)` instead of `FILTER(?age >= 18)`, chain operations like `v('price').mul(1.2).round()`, and get autocomplete in your editor. TypeScript catches errors at compile time, values are properly escaped automatically, and you can compose queries from reusable pieces.

## Installation

```bash
deno add @okikio/sparql
```

```ts
import { select, triple, node, v, filter } from '@okikio/sparql'
```

## Quick Start

Start with a simple query using triple patterns:

```ts
const adults = select(['?name', '?age'])
  .where(triple('?person', 'foaf:name', '?name'))
  .where(triple('?person', 'foaf:age', '?age'))
  .filter(v('age').gte(18))

const sparql = adults.build()
const results = await adults.execute({
  endpoint: 'http://localhost:3030/dataset/sparql'
})
```

That `v('age').gte(18)` is the fluent API - variables become values with chainable methods. Compare values, do math, transform strings, all with natural dot notation.

## SPARQL Mapping

Every library feature maps directly to standard SPARQL 1.1. The library provides 100% spec coverage with enhanced developer experience through type safety, fluent chaining, and multiple pattern styles.

**Key mappings:**
- `v('age').gte(18)` → `?age >= 18`
- `select([v('price').mul(1.2).as('total')])` → `SELECT (?price * 1.2 AS ?total)`
- `triple('?s', 'rdf:type', 'ex:Person')` → `?s rdf:type ex:Person .`
- `md5(v('email'))` → `MD5(?email)`
- `now()` → `NOW()`

**See [sparql-mapping.md](./docs/sparql-mapping.md) for:**
- Complete function reference (85+ functions)
- Library → SPARQL examples for all features
- SPARQL → Library migration guide
- DX enhancements beyond the spec

Call `.build().value` on any query to see the generated SPARQL string.

## Pattern Styles

The library supports multiple ways to describe graph patterns. Use triples for simple cases, nested objects for complex structures, or ASCII art when you want visual clarity. Every pattern compiles to standard SPARQL, so choose based on readability.

Basic triples work for straightforward queries:

```ts
select(['?name', '?age'])
  .where(triple('?person', 'foaf:name', '?name'))
  .where(triple('?person', 'foaf:age', '?age'))
```

Nested object notation handles complex graphs without repetition. Properties can contain other nodes:

```ts
select(['?title', '?publisherName', '?city'])
  .where(
    node('product', 'schema:Product', {
      'schema:name': v('title'),
      'schema:price': v('price'),
      'schema:publisher': node('publisher', 'schema:Organization', {
        'schema:name': v('publisherName'),
        'schema:location': node('location', 'schema:Place', {
          'schema:city': v('city'),
          'schema:country': v('country')
        })
      })
    })
  )
```

That nesting generates all the triples automatically. Product has a publisher, publisher has a location, location has city and country. You write the structure as you think about it.

ASCII art syntax emphasizes visual clarity. The cypher template tag lets you draw connections:

```ts
const product = node('product', 'schema:Product', {
  'schema:name': v('title')
})

const publisher = node('publisher', 'schema:Organization', {
  'schema:name': v('pubName')
})

const query = select(['?title', '?pubName'])
  .where(cypher`${product}-[schema:publisher]->${publisher}`)
```

The arrow `->` shows the relationship direction visually. This generates the same triples as the object notation, but reads like a diagram.

Combine patterns with `match()` when you want to build complex structures from separate pieces:

```ts
const pattern = match(
  node('person', 'foaf:Person', { 'foaf:name': v('personName') }),
  rel('person', 'foaf:knows', 'friend'),
  node('friend', 'foaf:Person', { 'foaf:name': v('friendName') })
)

select(['?personName', '?friendName']).where(pattern)
```

Mix patterns in the same query. Use triples for simple bindings, objects for nested structures, ASCII art for visual relationships:

```ts
select(['?person', '?skill', '?friendName'])
  .where(triple('?person', 'ex:hasSkill', '?skill'))
  .where(
    node('person')
      .prop('foaf:knows', node('friend', {
        'foaf:name': v('friendName')
      }))
  )
```

## Fluent Operations

Chain operations to build expressions. Arithmetic works left to right:

```ts
const pricing = select(['?product', '?total'])
  .where(triple('?product', 'schema:price', '?basePrice'))
  .bind(
    v('basePrice')
      .mul(1.2)      // Apply markup
      .add(5)        // Add shipping
      .round()       // Clean up decimals
      .as('total')
  )
  .filter(v('total').gte(20))
```

String operations chain the same way. Build display names with fallbacks:

```ts
select(['?displayName'])
  .where(triple('?person', 'foaf:firstName', '?first'))
  .where(triple('?person', 'foaf:lastName', '?last'))
  .optional(triple('?person', 'foaf:nickname', '?nick'))
  .bind(
    coalesce(v('nick'), v('first'))
      .ucase()
      .substr(0, 10)
      .concat(' ')
      .concat(v('last').ucase().substr(0, 1))
      .concat('.')
      .as('displayName')
  )
```

Read it step by step: "Use nickname if available, otherwise first name. Uppercase it. Take first 10 characters. Add space. Add uppercased first letter of last name. Add period."

Conditional logic stays readable with nested fluent operations:

```ts
select(['?item', '?price', '?status'])
  .where(triple('?item', 'schema:basePrice', '?base'))
  .where(triple('?item', 'schema:inStock', '?stock'))
  .bind(
    ifElse(
      v('stock').gt(10),
      v('base').mul(0.85),
      ifElse(
        v('stock').gt(0),
        v('base').mul(0.95),
        v('base').add(20)
      )
    ).round().as('price')
  )
  .bind(
    ifElse(
      v('stock').gt(10),
      'In Stock',
      ifElse(
        v('stock').gt(0),
        'Low Stock',
        'Out of Stock'
      )
    ).as('status')
  )
```

The nested structure mirrors the decision tree. Good stock gets 15% off, low stock gets 5% off, out of stock adds a premium.

## Aggregations and Grouping

Count, average, sum - aggregations work with the fluent API:

```ts
const analytics = select([
  v('country'),
  count().as('users'),
  avg(v('age')).as('avgAge'),
  countDistinct(v('city')).as('cities'),
  sum(v('purchases')).as('revenue')
])
  .where(triple('?user', 'schema:country', '?country'))
  .where(triple('?user', 'foaf:age', '?age'))
  .where(triple('?user', 'schema:city', '?city'))
  .where(triple('?user', 'ex:totalPurchases', '?purchases'))
  .groupBy('?country')
  .having(count().gte(10))
  .orderBy('?revenue', 'DESC')
```

Notice `count().gte(10)` in the having clause - aggregations return fluent values. Everything chains consistently.

## Subqueries and Composition

Break complex logic into pieces:

```ts
// Find top 10 best-selling products
const topSellers = select([v('product'), count().as('sales')])
  .where(triple('?order', 'schema:product', '?product'))
  .where(triple('?order', 'schema:date', '?date'))
  .filter(v('date').gte('2024-01-01'))
  .groupBy('?product')
  .orderBy('?sales', 'DESC')
  .limit(10)

// Enrich with product details
const enriched = select(['?product', '?name', '?price', '?sales'])
  .where(subquery(topSellers))
  .where(
    node('product', {
      'schema:name': v('name'),
      'schema:price': v('price')
    })
  )
  .orderBy('?sales', 'DESC')
```

Each piece is simple. Together they solve the complex problem.

## Property Paths

Navigate graph structures without manual recursion. Find all contacts through any number of "knows" relationships:

```ts
const network = select(['?person', '?contact'])
  .where(triple('?person', zeroOrMore('foaf:knows'), '?contact'))
  .filter(v('person').neq(v('contact')))
```

That `zeroOrMore` expands to any number of hops. The SPARQL engine handles it efficiently.

Navigate nested properties with sequences:

```ts
const cities = select(['?person', '?city'])
  .where(triple('?person', sequence('schema:address', 'schema:city'), '?city'))
```

"Follow address property, then city property" - one pattern instead of two triples.

Use alternatives when property names vary:

```ts
const names = select(['?person', '?name'])
  .where(triple('?person', alternative('foaf:name', 'schema:name'), '?name'))
```

Combine path operators for complex navigation:

```ts
// Manager or manager's manager
const bosses = select(['?employee', '?boss'])
  .where(
    triple(
      '?employee',
      sequence(
        oneOrMore('org:reportsTo'),
        alternative('org:manages', 'org:supervises')
      ),
      '?boss'
    )
  )
```

## Updates and Modifications

Updates use the same fluent patterns. Increment everyone's age:

```ts
const birthday = modify()
  .delete(triple('?person', 'foaf:age', '?oldAge'))
  .insert(triple('?person', 'foaf:age', v('oldAge').add(1)))
  .where(triple('?person', 'foaf:age', '?oldAge'))
  .where(filter(v('oldAge').gte(0)))
  .done()

await birthday.execute({ endpoint: 'http://localhost:3030/dataset/update' })
```

Notice `v('oldAge').add(1)` works in the insert template - fluent operations work everywhere.

Conditional inserts:

```ts
const markSeniors = modify()
  .insert(
    node('person', {
      'ex:seniorCitizen': true,
      'ex:discount': 0.15
    })
  )
  .where(triple('?person', 'foaf:age', '?age'))
  .where(filter(v('age').gte(65)))
  .done()
```

Delete patterns with conditions:

```ts
const cleanup = modify()
  .delete(
    node('account', {
      'ex:status': v('status'),
      'ex:lastLogin': v('lastLogin')
    })
  )
  .where(triple('?account', 'ex:status', 'inactive'))
  .where(triple('?account', 'ex:lastLogin', '?lastLogin'))
  .where(filter(v('lastLogin').lt('2023-01-01')))
  .done()
```

## Complete Example

Real-world e-commerce query combining multiple patterns:

```ts
const productSearch = select([
  v('title'),
  v('displayPrice'),
  v('stockStatus'),
  v('categoryName'),
  v('averageRating')
])
  .where(
    node('product', 'schema:Product', {
      'schema:name': v('title'),
      'schema:price': v('basePrice'),
      'schema:inventory': v('stock'),
      'schema:category': node('category', 'schema:Category', {
        'schema:name': v('categoryName')
      })
    })
  )
  .optional(
    node('product')
      .prop('schema:review', node('review', 'schema:Review', {
        'schema:ratingValue': v('rating')
      }))
  )
  .bind(
    ifElse(
      v('stock').gt(5),
      v('basePrice').mul(0.9),
      ifElse(
        v('stock').gt(0),
        v('basePrice').mul(0.95),
        v('basePrice').mul(1.1)
      )
    ).round().as('displayPrice')
  )
  .bind(
    ifElse(
      v('stock').gt(5),
      'In Stock',
      ifElse(
        v('stock').gt(0),
        v('stock').concat(' left'),
        'Out of Stock'
      )
    ).as('stockStatus')
  )
  .filter(v('displayPrice').gte(10))
  .groupBy('?product', '?title', '?displayPrice', '?stockStatus', '?categoryName')
  .bind(avg(v('rating')).as('averageRating'))
  .having(countDistinct(v('review')).gte(5))
  .orderBy('?averageRating', 'DESC')
  .limit(50)

const results = await productSearch.execute({
  endpoint: 'http://localhost:3030/catalog/sparql'
})
```

That query handles nested relationships (product → category), optional patterns (reviews), computed values (discounted price), conditional logic (stock messages), aggregations (average rating), and filtering.

## Named Graphs and Federation

Query specific graphs:

```ts
const graphData = select(['?s', '?p', '?o'])
  .fromNamed('http://example.org/metadata')
  .where(graph('?g', triple('?s', '?p', '?o')))
```

Combine data from multiple endpoints:

```ts
const federated = select(['?person', '?name', '?birthPlace', '?abstract'])
  .where(triple('?person', 'foaf:name', '?name'))
  .where(
    service(
      'http://dbpedia.org/sparql',
      triple('?person', 'dbo:birthPlace', '?birthPlace'),
      triple('?person', 'dbo:abstract', '?abstract')
    )
  )
  .filter(v('abstract').regex('scientist'))
```

Federation lets you query distributed data sources in a single query. The SERVICE clause transparently handles remote execution.

## Type Safety

Everything is fully typed. TypeScript catches errors at compile time:

```ts
const age = v('age')

age.gte(18)              // ✓ Returns SparqlValue for filters
age.add(5)               // ✓ Returns FluentValue, can chain
age.add(5).mul(2)        // ✓ Chains continue naturally
age.gte('not a number')  // ✗ TypeScript error
```

You get autocomplete in your editor. The library guides you toward correct code. Generated SPARQL is safe from injection attacks because values are properly escaped automatically.

## Further Reading

Check the module documentation for architecture details and progressive examples. The pattern files (triples.ts, objects.ts, cypher.ts) show different syntax styles with comprehensive examples. Implementation docs explain technical decisions and trade-offs.

Start simple with basic queries. Add complexity as you need it. The patterns stay consistent - learning one part teaches you the rest.

## License

MIT