# SPARQL Query Builder

A type-safe, fluent query builder for SPARQL inspired by [Drizzle ORM](https://orm.drizzle.team/) and [Supabase PostgREST](https://postgrest.org/). Makes graph database queries readable, maintainable, and enjoyable to write.

```typescript
// Instead of this verbose SPARQL:
const rawQuery = `
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT ?name ?age WHERE {
    ?person a foaf:Person ;
            foaf:name ?name ;
            foaf:age ?age .
    FILTER(?age >= 18)
  }
  ORDER BY ?name
  LIMIT 10
`

// Write this beautiful, type-safe code:
const person = node('person', 'foaf:Person')
  .with.prop('foaf:name', variable('name'))
  .and.prop('foaf:age', variable('age'))

const result = await select(['?name', '?age'])
  .where(person)
  .filter(gte(variable('age'), 18))
  .orderBy('?name')
  .limit(10)
  .execute(config)
```

---

## Why This Exists

**The Problem:** SPARQL queries are powerful but painful to write. They're verbose, error-prone, and hard to maintain. When building [Pop Modern](https://popmodern.co)—a comic book discovery platform with Neptune graph database and Supabase PostgreSQL—we needed a better way to query our knowledge graph.

**The Solution:** Bring the delightful developer experience of Drizzle and PostgREST to graph databases. Write queries that are:
- **Type-safe** - Catch errors at compile time
- **Readable** - Self-documenting, semantic patterns
- **Composable** - Build complex queries from simple parts
- **Maintainable** - Refactor with confidence

---

## Installation

```bash
# Deno
deno add jsr:@your-org/sparql-builder

# Node/npm (coming soon)
npm install sparql-builder
```

---

## Quick Start

### Basic Query

```typescript
import { node, select, variable, gte } from 'sparql-builder'

const config = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
}

// Find adults
const person = node('person', 'foaf:Person')
  .with.prop('foaf:name', variable('name'))
  .and.prop('foaf:age', variable('age'))

const result = await select(['?name', '?age'])
  .where(person)
  .filter(gte(variable('age'), 18))
  .orderBy('?name')
  .limit(10)
  .execute(config)

if (result.success) {
  console.log(result.data.results.bindings)
} else {
  console.error(result.error.type, result.error.message)
}
```

### Relationships

```typescript
import { node, rel, select } from 'sparql-builder'

// Find friends of friends
const alice = node('alice', 'foaf:Person')
  .with.prop('foaf:name', str('Alice'))

const friend = node('friend', 'foaf:Person')
  .with.prop('foaf:name', variable('friendName'))

const friendOfFriend = node('fof', 'foaf:Person')
  .with.prop('foaf:name', variable('fofName'))

const result = await select(['?friendName', '?fofName'])
  .where(alice)
  .where(friend)
  .where(friendOfFriend)
  .where(rel('alice', 'foaf:knows', 'friend'))
  .where(rel('friend', 'foaf:knows', 'fof'))
  .execute(config)
```

---

## Core Concepts

### The Chai Pattern: Semantic Readability

The `.is.a()` and `.with.prop()` syntax isn't just sugar—it's **semantic markers** that make complex queries parseable at a glance:

```typescript
const issue = node('issue', Types.Product)
  .is.a('narrative:ComicIssue')          // What it IS
  .with.prop('narrative:issueNumber', variable('num'))  // What it HAS
  .and.prop('narrative:variantType', variable('variant'))
  .that.prop('narrative:issueNumber', 1)  // Constraints THAT filter it
```

When queries get complex (5+ nodes, multiple relationships), this visual separation becomes critical:

```typescript
// Instantly readable: types → properties → filters
const character = node('character', Types.Character)
  .is.a('narrative:Character')
  .with.prop(Props.characterName, 'Spider-Man')
  .and.prop('narrative:firstAppearance', variable('firstApp'))
  .that.prop('narrative:status', 'active')
```

### Fluent Patterns

Build patterns that read like natural language:

```typescript
// Nodes (resources)
const person = node('person', 'foaf:Person')
  .with.prop('foaf:name', variable('name'))
  .and.prop('foaf:email', variable('email'))

// Relationships
const knows = rel('person', 'foaf:knows', 'friend')

// Relationships with properties (reification)
const credit = rel('creator', 'narrative:createdWork', 'comic')
  .with.prop('narrative:confidence', variable('confidence'))
  .and.prop('narrative:source', str('marvel-api'))
```

### Type Safety

Leverage TypeScript for compile-time safety:

```typescript
// Discriminated union for error handling
const result = await select(['?name']).where(person).execute(config)

if (result.success) {
  // Type: SparqlSuccess
  const bindings = result.data.results.bindings
} else {
  // Type: SparqlFailure
  switch (result.error.type) {
    case 'syntax':
      console.error('Invalid SPARQL:', result.error.message)
      break
    case 'timeout':
      console.error('Query timeout:', result.error.message)
      break
    case 'unavailable':
      console.error('Endpoint down:', result.error.message)
      break
  }
}
```

---

## API Reference

### Pattern Builders

#### `node(name, type?, options?)`

Create a node pattern representing a resource.

```typescript
// Simple node
const person = node('person', 'foaf:Person')

// Node with properties
const person = node('person', 'foaf:Person', {
  'foaf:name': variable('name'),
  'foaf:age': variable('age'),
})

// Multiple types
const item = node('item')
  .is.a('narrative:Product')
  .and.a('schema:Thing')

// Nested nodes
const comic = node('comic', Types.Product, {
  'narrative:publishedBy': node('publisher', Types.Organization, {
    'rdfs:label': str('Marvel Comics'),
  }),
})
```

**Fluent methods:**
- `.is.a(type)` - Add RDF type
- `.with.prop(predicate, value)` - Add property
- `.and.prop(predicate, value)` - Chain properties
- `.that.prop(predicate, value)` - Add filter constraint

#### `rel(from, predicate, to)`

Create a relationship pattern between two nodes.

```typescript
// Simple relationship
const knows = rel('person', 'foaf:knows', 'friend')

// Relationship with properties (reification)
const credit = rel('creator', 'narrative:createdWork', 'comic')
  .with.prop('narrative:confidence', 0.95)
  .and.prop('narrative:role', variable('role'))
```

### Query Builder

#### `select(variables)`

Start a SELECT query.

```typescript
const query = select(['?name', '?age'])
  .where(person)
  .orderBy('?name')
  .limit(10)

// Or select all
const query = select('*').where(person)
```

**Chainable methods:**
- `.where(pattern)` - Add WHERE pattern
- `.filter(condition)` - Add FILTER condition
- `.optional(pattern)` - Add OPTIONAL pattern
- `.bind(expression, variable)` - Add BIND expression
- `.union(...branches)` - Add UNION branches
- `.orderBy(variable, direction?)` - Add ORDER BY
- `.limit(count)` - Add LIMIT
- `.offset(count)` - Add OFFSET
- `.distinct()` - Use DISTINCT modifier
- `.reduced()` - Use REDUCED modifier

#### `ask()`

Create an ASK query (boolean result).

```typescript
const exists = await ask()
  .where(node('person', 'foaf:Person'))
  .execute(config)

if (exists.success && exists.data.boolean) {
  console.log('At least one person exists')
}
```

### Value Constructors

```typescript
// Variables
variable('name')        // ?name

// Literals
str('Alice')           // "Alice"
num(42)                // 42
bool(true)             // true
date('2024-01-15')     // "2024-01-15"^^xsd:date

// IRIs
uri('http://example.org/person/1')  // <http://example.org/person/1>
prefixed('foaf:Person')             // foaf:Person
```

### Expression Helpers

```typescript
// Comparisons
eq(variable('age'), 30)           // ?age = 30
ne(variable('age'), 30)           // ?age != 30
lt(variable('age'), 30)           // ?age < 30
lte(variable('age'), 30)          // ?age <= 30
gt(variable('age'), 30)           // ?age > 30
gte(variable('age'), 30)          // ?age >= 30

// Logical operators
and(condition1, condition2)       // condition1 && condition2
or(condition1, condition2)        // condition1 || condition2
not(condition)                    // !condition

// String functions
regex(variable('name'), '^Alice', 'i')  // REGEX(?name, "^Alice", "i")
concat(str('Hello '), variable('name')) // CONCAT("Hello ", ?name)
strlen(variable('name'))                 // STRLEN(?name)

// Aggregations
count(variable('person'))         // COUNT(?person)
sum(variable('amount'))           // SUM(?amount)
avg(variable('score'))            // AVG(?score)
min(variable('date'))             // MIN(?date)
max(variable('date'))             // MAX(?date)
```

### Execution

#### `execute(config)`

Execute a query against a SPARQL endpoint.

```typescript
const config = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeout: 30000,  // Optional, default 30000ms
  headers: {       // Optional
    'Authorization': 'Bearer token',
  },
}

const result = await select(['?name'])
  .where(person)
  .execute(config)

// Result is a discriminated union
if (result.success) {
  // Type: SparqlSuccess
  const data: SparqlResponse = result.data
} else {
  // Type: SparqlFailure
  const error: SparqlError = result.error
}
```

#### Error Types

```typescript
type SparqlErrorType =
  | 'syntax'        // 400 - Malformed SPARQL
  | 'timeout'       // AbortError - Query timeout
  | 'unavailable'   // Cannot connect to endpoint
  | 'database'      // 5xx - Database error
  | 'unknown'       // Unexpected error
```

#### Result Transformation

```typescript
import { transformResults, extractUris } from 'sparql-builder'

const result = await select(['?name', '?age']).where(person).execute(config)

if (result.success) {
  // Transform to simple objects
  const rows = transformResults(result.data)
  // [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]

  // Extract all URIs
  const uris = extractUris(result.data)
  // ['http://example.org/person/1', 'http://example.org/person/2']
}
```

---

## Domain-Specific Patterns

For domain-specific applications (like Pop Modern), create helper constants:

```typescript
// types.ts
export const Types = {
  Character: raw('narrative:Character'),
  Series: raw('narrative:Series'),
  Product: raw('narrative:Product'),
  Person: raw('narrative:Person'),
  Organization: raw('narrative:Organization'),
}

export const Relationships = {
  createdBy: raw('narrative:createdBy'),
  publishedBy: raw('narrative:publishedBy'),
  featuresCharacter: raw('narrative:featuresCharacter'),
  partOfSeries: raw('narrative:partOfSeries'),
}

export const Props = {
  name: raw('rdfs:label'),
  characterName: raw('narrative:characterName'),
  seriesName: raw('narrative:seriesName'),
  productTitle: raw('narrative:productTitle'),
  issueNumber: raw('narrative:issueNumber'),
}

// Usage
const comic = node('comic', Types.Product)
  .with.prop(Props.productTitle, variable('title'))
  .and.prop(Props.issueNumber, variable('num'))
```

---

## Real-World Example: Pop Modern

Finding Amazing Spider-Man #1 variants with creator credits:

```typescript
const series = node('series', Types.Series)
  .with.prop(Props.seriesName, 'Amazing Spider-Man')

const issue = node('issue', Types.Product)
  .with.prop(Props.issueNumber, variable('issueNum'))
  .and.prop('narrative:variantType', variable('variantType'))
  .that.prop(Props.issueNumber, 1)

const creator = node('creator', Types.Person)
  .with.prop(Props.name, variable('creatorName'))
  .and.prop('narrative:role', variable('role'))

const publisher = node('publisher', Types.Organization)
  .with.prop(Props.name, variable('publisherName'))

const result = await select([
  '?issueNum',
  '?variantType',
  '?creatorName',
  '?role',
  '?publisherName',
])
  .where(series)
  .where(issue)
  .where(creator)
  .where(publisher)
  .where(rel(issue, Relationships.partOfSeries, series))
  .where(rel(issue, Relationships.publishedBy, publisher))
  .where(
    rel(creator, Relationships.createdBy, issue)
      .with.prop('narrative:confidence', variable('confidence'))
  )
  .filter(gte(variable('confidence'), 0.8))
  .orderBy('?variantType')
  .limit(50)
  .execute(config)
```

Compare to raw SPARQL—the builder version is:
- **50% shorter**
- **Type-safe** at compile time
- **Self-documenting** with semantic markers
- **Refactorable** without string manipulation

---

## Examples

See the [`examples/`](./examples) directory for complete working examples:

- **[basic.ts](./examples/basic.ts)** - Simple queries, filtering, sorting
- **[complex.ts](./examples/complex.ts)** - Relationships, multi-hop, aggregations
- **[pop-modern.ts](./examples/pop-modern.ts)** - Real-world comic book queries

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Query Builder                  │
│  (Drizzle-inspired chainable interface)         │
└─────────────┬───────────────────────────────────┘
              │
              ├─► Builds SparqlValue objects
              │
┌─────────────▼───────────────────────────────────┐
│              Pattern Builders                   │
│  (Chai-inspired semantic markers)               │
│                                                  │
│  • node() - Resource patterns                   │
│  • rel()  - Relationship patterns               │
│  • match() - Pattern composition                │
└─────────────┬───────────────────────────────────┘
              │
              ├─► Generates SPARQL strings
              │
┌─────────────▼───────────────────────────────────┐
│                   Executor                      │
│  (Functional execution with discriminated       │
│   union error handling)                         │
└─────────────┬───────────────────────────────────┘
              │
              ├─► HTTP POST to SPARQL endpoint
              │
┌─────────────▼───────────────────────────────────┐
│              SPARQL Endpoint                    │
│  (Blazegraph, Neptune, Virtuoso, etc.)         │
└─────────────────────────────────────────────────┘
```

---

## Design Philosophy

### 1. Drizzle-Inspired Query Building

Like Drizzle, we prioritize:
- **Type safety** over string templates
- **Method chaining** over configuration objects
- **Composability** over monolithic builders

### 2. PostgREST-Inspired Clarity

Like PostgREST, we believe:
- **URLs should be readable** → Queries should be readable
- **REST verbs map to SQL** → Methods map to SPARQL clauses
- **Composable filters** → Composable patterns

### 3. Chai-Inspired Semantics

Like Chai assertions, we use:
- **Semantic markers** (`.is`, `.with`, `.and`, `.that`) for visual chunking
- **Natural language flow** for cognitive ease
- **Progressive disclosure** of complexity

### 4. Graph-First Thinking

Unlike SQL builders, we embrace:
- **Relationships as first-class** patterns, not foreign keys
- **Multi-hop traversal** as natural operations
- **Reification** for relationship properties

---

## Roadmap

- [x] Core query builder (SELECT, ASK, CONSTRUCT, DESCRIBE)
- [x] Pattern builders (node, rel, match)
- [x] Expression helpers (filters, aggregations)
- [x] Discriminated union error handling
- [x] Result transformation utilities
- [ ] SPARQL 1.1 UPDATE support (INSERT, DELETE)
- [ ] Property path patterns (`foaf:knows+`, `foaf:knows*`)
- [ ] Federated queries (SERVICE)
- [ ] Query optimization hints
- [ ] Streaming results for large datasets
- [ ] Schema validation and inference
- [ ] GraphQL bridge

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Development

```bash
# Run tests
deno test

# Run examples
deno run examples/basic.ts

# Format code
deno fmt

# Lint
deno lint
```

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Acknowledgments

Built for [Pop Modern](https://popmodern.co), a comic book discovery platform

Inspired by:
- [Drizzle ORM](https://orm.drizzle.team/) - Type-safe SQL builder
- [Supabase PostgREST](https://postgrest.org/) - RESTful query interface
- [Chai](https://www.chaijs.com/) - Semantic assertion library
- [Cypher](https://neo4j.com/docs/cypher-manual/) - Graph query language

---

Built with ❤️ for the graph database community.