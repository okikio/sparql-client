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

String operations chain naturally. Build display names with fallbacks:

```ts
select(['?displayName'])
  .where(triple('?person', 'foaf:firstName', '?first'))
  .where(triple('?person', 'foaf:lastName', '?last'))
  .optional(triple('?person', 'foaf:nickname', '?nick'))
  .bind(
    substr(coalesce(v('nick'), v('first')).ucase(), 1, 10)
      .concat(' ')
      .concat(v('last').ucase().substr(1, 1))
      .concat('.')
      .as('displayName')
  )
```

Read it step by step: "Use nickname if available, otherwise first name. Uppercase it. Take first 10 characters. Add space. Add uppercased first letter of last name. Add period."

Note: `substr()` is a standalone function, not a fluent method. Most string operations like `ucase()`, `lcase()`, `concat()`, `strlen()` are available as fluent methods for chaining.

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

## Query Composition and Reuse

Building complex queries from reusable pieces makes your code cleaner and more maintainable. These patterns show how to compose queries, extract common logic, and build flexible query templates.

### Reusable Pattern Fragments

Extract common triple patterns into functions. This reduces duplication and makes queries easier to understand:

```ts
import { RDF, FOAF, SCHEMA } from '@okikio/sparql'

// Define reusable pattern fragments
function personPattern(personVar = 'person') {
  return node(personVar, FOAF.Person, {
    [FOAF.name]: v('name'),
    [FOAF.age]: v('age')
  })
}

function addressPattern(personVar = 'person') {
  return node(personVar)
    .prop(SCHEMA.address, node('address', SCHEMA.PostalAddress, {
      [SCHEMA.addressLocality]: v('city'),
      [SCHEMA.addressCountry]: v('country')
    }))
}

// Use them in queries
const adults = select(['?name', '?age'])
  .where(personPattern())
  .filter(v('age').gte(18))

const peopleWithAddress = select(['?name', '?city', '?country'])
  .where(personPattern())
  .where(addressPattern())
```

Patterns compose naturally. Mix and match to build exactly the query you need without repeating yourself.

### Filter Builder Functions

Extract filter logic into reusable functions. This makes query intentions clearer:

```ts
// Define filter builders
function olderThan(age: number) {
  return v('age').gte(age)
}

function nameMatches(pattern: string, caseInsensitive = true) {
  return caseInsensitive
    ? v('name').regex(pattern, 'i')
    : v('name').regex(pattern)
}

function inCountry(country: string) {
  return v('country').eq(country)
}

// Use them in queries
const query = select(['?name', '?age'])
  .where(personPattern())
  .where(addressPattern())
  .filter(olderThan(21))
  .filter(nameMatches('^John'))
  .filter(inCountry('USA'))
```

Read the query like English: "Select name and age where person is older than 21, name matches '^John', and in country USA."

### Query Templates with Parameters

Build flexible query templates that adapt based on parameters. This pattern works great for search interfaces:

```ts
interface SearchFilters {
  minAge?: number
  maxAge?: number
  namePattern?: string
  city?: string
  country?: string
}

function searchPeople(filters: SearchFilters) {
  let query = select(['?name', '?age', '?city', '?country'])
    .prefix('rdf', getNamespaceIRI(RDF))
    .prefix('foaf', getNamespaceIRI(FOAF))
    .prefix('schema', getNamespaceIRI(SCHEMA))
    .where(personPattern())
    .where(addressPattern())

  // Add filters conditionally
  if (filters.minAge !== undefined) {
    query = query.filter(v('age').gte(filters.minAge))
  }

  if (filters.maxAge !== undefined) {
    query = query.filter(v('age').lte(filters.maxAge))
  }

  if (filters.namePattern) {
    query = query.filter(v('name').regex(filters.namePattern, 'i'))
  }

  if (filters.city) {
    query = query.filter(v('city').eq(filters.city))
  }

  if (filters.country) {
    query = query.filter(v('country').eq(filters.country))
  }

  return query
}

// Use it with different filter combinations
const youngAdults = searchPeople({ minAge: 18, maxAge: 25 })
const londonResidents = searchPeople({ city: 'London' })
const ukSeniors = searchPeople({ minAge: 65, country: 'UK' })
```

The query adapts automatically. Only the filters you provide get added.

### Base Query Extension

Start with a base query and extend it for different use cases:

```ts
// Base query everyone shares
const baseProductQuery = select(['?product', '?name', '?price'])
  .prefix('schema', getNamespaceIRI(SCHEMA))
  .where(
    node('product', SCHEMA.Product, {
      [SCHEMA.name]: v('name'),
      [SCHEMA.price]: v('price')
    })
  )

// Extend for specific needs
const affordableProducts = baseProductQuery
  .filter(v('price').lte(50))
  .orderBy('?price')
  .limit(20)

const expensiveProducts = baseProductQuery
  .filter(v('price').gte(100))
  .orderBy('?price', 'DESC')
  .limit(10)

const searchResults = baseProductQuery
  .filter(v('name').regex(userInput, 'i'))
  .limit(50)
```

The base query stays immutable. Each extension creates a new query without affecting the original.

### Combining Subqueries

Break complex logic into subqueries then combine them:

```ts
// Find top sellers
const topSellers = select([v('product'), count().as('sales')])
  .where(triple('?order', SCHEMA.product, '?product'))
  .where(triple('?order', SCHEMA.orderDate, '?date'))
  .filter(v('date').gte('2024-01-01'))
  .groupBy('?product')
  .orderBy('?sales', 'DESC')
  .limit(10)

// Enrich with product details
const enrichedProducts = select([
  '?product',
  '?name',
  '?price',
  '?sales',
  '?category'
])
  .where(subquery(topSellers))
  .where(
    node('product', {
      [SCHEMA.name]: v('name'),
      [SCHEMA.price]: v('price'),
      [SCHEMA.category]: v('category')
    })
  )
  .orderBy('?sales', 'DESC')
```

Each subquery solves one piece of the problem. Combine them to solve the whole thing.

### Pattern Collections

Group related patterns together for complex domains:

```ts
// E-commerce patterns
const ecommerce = {
  product(productVar = 'product') {
    return node(productVar, SCHEMA.Product, {
      [SCHEMA.name]: v('productName'),
      [SCHEMA.price]: v('price'),
      [SCHEMA.sku]: v('sku')
    })
  },

  order(orderVar = 'order') {
    return node(orderVar, SCHEMA.Order, {
      [SCHEMA.orderDate]: v('orderDate'),
      [SCHEMA.orderNumber]: v('orderNumber'),
      [SCHEMA.customer]: v('customer')
    })
  },

  customer(customerVar = 'customer') {
    return node(customerVar, SCHEMA.Person, {
      [SCHEMA.name]: v('customerName'),
      [SCHEMA.email]: v('email')
    })
  },

  // Relationship connectors
  orderContains(orderVar = 'order', productVar = 'product') {
    return triple(`?${orderVar}`, SCHEMA.orderedItem, `?${productVar}`)
  },

  orderBy(orderVar = 'order', customerVar = 'customer') {
    return triple(`?${orderVar}`, SCHEMA.customer, `?${customerVar}`)
  }
}

// Use pattern collection
const orderAnalysis = select([
  '?orderNumber',
  '?customerName',
  '?productName',
  '?price'
])
  .where(ecommerce.order())
  .where(ecommerce.orderBy())
  .where(ecommerce.customer())
  .where(ecommerce.orderContains())
  .where(ecommerce.product())
  .filter(v('orderDate').gte('2024-01-01'))
```

Pattern collections organize domain knowledge. Your queries become high-level descriptions of what you want to find.

### Dynamic Query Construction

Build queries programmatically from user input or configuration:

```ts
interface FieldSelection {
  fields: string[]
  filters: Array<{ field: string, operator: string, value: any }>
  sort?: { field: string, direction: 'ASC' | 'DESC' }
  limit?: number
}

function buildDynamicQuery(config: FieldSelection) {
  // Map user field names to actual predicates
  const fieldMap: Record<string, string> = {
    name: FOAF.name,
    age: FOAF.age,
    email: SCHEMA.email,
    city: SCHEMA.addressLocality
  }

  // Start with base pattern
  let query = select(config.fields.map(f => `?${f}`))
    .where(triple('?person', RDF.type, uri(FOAF.Person)))

  // Add triples for each requested field
  for (const field of config.fields) {
    const predicate = fieldMap[field]
    if (predicate) {
      query = query.where(triple('?person', predicate, `?${field}`))
    }
  }

  // Apply filters
  for (const filter of config.filters) {
    const varRef = v(filter.field)
    switch (filter.operator) {
      case 'eq':
        query = query.filter(varRef.eq(filter.value))
        break
      case 'gt':
        query = query.filter(varRef.gt(filter.value))
        break
      case 'lt':
        query = query.filter(varRef.lt(filter.value))
        break
      case 'contains':
        query = query.filter(varRef.contains(filter.value))
        break
    }
  }

  // Apply sorting
  if (config.sort) {
    query = query.orderBy(`?${config.sort.field}`, config.sort.direction)
  }

  // Apply limit
  if (config.limit) {
    query = query.limit(config.limit)
  }

  return query
}

// Use with different configurations
const query1 = buildDynamicQuery({
  fields: ['name', 'email'],
  filters: [{ field: 'name', operator: 'contains', value: 'John' }],
  limit: 10
})

const query2 = buildDynamicQuery({
  fields: ['name', 'age', 'city'],
  filters: [
    { field: 'age', operator: 'gt', value: 18 },
    { field: 'city', operator: 'eq', value: 'London' }
  ],
  sort: { field: 'age', direction: 'DESC' }
})
```

Dynamic construction turns configuration into queries. Good for building query builders, APIs, or UI-driven search.

### Cached Query Builders

Pre-configure query builders for common operations:

```ts
// Create specialized builders
class PersonQueries {
  private readonly baseQuery: QueryBuilder

  constructor() {
    this.baseQuery = select(['?person', '?name', '?age'])
      .prefix('rdf', getNamespaceIRI(RDF))
      .prefix('foaf', getNamespaceIRI(FOAF))
      .where(triple('?person', RDF.type, uri(FOAF.Person)))
      .where(triple('?person', FOAF.name, '?name'))
      .where(triple('?person', FOAF.age, '?age'))
  }

  all() {
    return this.baseQuery
  }

  adults() {
    return this.baseQuery.filter(v('age').gte(18))
  }

  children() {
    return this.baseQuery.filter(v('age').lt(18))
  }

  byName(name: string) {
    return this.baseQuery.filter(v('name').eq(name))
  }

  olderThan(age: number) {
    return this.baseQuery.filter(v('age').gt(age))
  }

  byAgeRange(min: number, max: number) {
    return this.baseQuery
      .filter(v('age').gte(min))
      .filter(v('age').lte(max))
  }
}

// Use it
const people = new PersonQueries()

const adults = await people.adults().execute(config)
const seniors = await people.olderThan(65).execute(config)
const alice = await people.byName('Alice').execute(config)
const millennials = await people.byAgeRange(25, 40).execute(config)
```

Query builders encapsulate domain logic. Each method returns a ready-to-execute query.

## Further Reading

Check the module documentation for architecture details and progressive examples. The pattern files (triples.ts, objects.ts, cypher.ts) show different syntax styles with comprehensive examples. Implementation docs explain technical decisions and trade-offs.

Start simple with basic queries. Add complexity as you need it. The patterns stay consistent - learning one part teaches you the rest.

## License

MIT