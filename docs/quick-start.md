# Quick Start Guide - New Features

## Namespace Constants

**Import what you need:**
```ts
import { RDF, RDFS, FOAF, SCHEMA, XSD, OWL } from '@okikio/sparql'
```

**Use in queries:**
```ts
// Instead of full IRIs:
triple('?person', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', '<http://xmlns.com/foaf/0.1/Person>')

// Use constants:
triple('?person', RDF.type, uri(FOAF.Person))
triple('?person', FOAF.name, '?name')
triple('?person', SCHEMA.email, '?email')
```

**Available namespaces:**
- **XSD** - Datatypes (string, integer, decimal, boolean, date, dateTime, etc.)
- **RDF** - Core (type, Property, Statement, first, rest, nil)
- **RDFS** - Schema (label, comment, Class, subClassOf, domain, range)
- **OWL** - Ontology (Class, sameAs, equivalentClass, TransitiveProperty)
- **FOAF** - People (Person, name, knows, age, mbox, homepage)
- **SCHEMA** - Schema.org (Person, Organization, Product, name, price, email)

---

## Prefix Declarations

**Add prefixes to queries:**
```ts
const query = select(['?name', '?email'])
  .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
  .prefix('schema', 'https://schema.org/')
  .where(triple('?person', 'foaf:name', '?name'))
  .where(triple('?person', 'schema:email', '?email'))
```

**Generated SPARQL:**
```sparql
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <https://schema.org/>

SELECT ?name ?email WHERE {
  ?person foaf:name ?name .
  ?person schema:email ?email .
}
```

**Combine with namespace constants:**
```ts
import { FOAF, SCHEMA, getNamespaceIRI } from '@okikio/sparql'

select(['?name'])
  .prefix('foaf', getNamespaceIRI(FOAF))
  .prefix('schema', getNamespaceIRI(SCHEMA))
  .where(triple('?person', 'foaf:name', '?name'))
```

---

## Enhanced Result Parsing

### Type Coercion

**Transform results with automatic type conversion:**
```ts
import { transformResultsTyped } from '@okikio/sparql'

const result = await select(['?price', '?quantity', '?active'])
  .where(triple('?product', 'schema:price', '?price'))
  .where(triple('?product', 'schema:quantity', '?quantity'))
  .where(triple('?product', 'schema:active', '?active'))
  .execute(config)

if (result.success) {
  const rows = transformResultsTyped(result.data)
  
  for (const row of rows) {
    // price and quantity are numbers, active is boolean
    const total = row.price * row.quantity
    console.log(`Total: $${total.toFixed(2)}`)
    console.log(`Active: ${row.active}`)
  }
}
```

### Extract Specific Variable

**Get array of values for one variable:**
```ts
import { pluck } from '@okikio/sparql'

// Get all names as strings
const names = pluck(result.data, 'name')
// ['Alice', 'Bob', 'Charlie']

// Get ages as numbers with type coercion
const ages = pluck<number>(result.data, 'age', true)
// [25, 30, 42] as numbers

const averageAge = ages.reduce((a, b) => a + b, 0) / ages.length
```

### Get First Result

**Perfect for lookups:**
```ts
import { first } from '@okikio/sparql'

const result = await select(['?name', '?email'])
  .where(triple('?person', 'foaf:accountName', 'alice'))
  .where(triple('?person', 'foaf:name', '?name'))
  .where(triple('?person', 'foaf:mbox', '?email'))
  .limit(1)
  .execute(config)

if (result.success) {
  const person = first(result.data)
  
  if (person) {
    console.log('Found:', person.name)
    console.log('Email:', person.email)
  } else {
    console.log('Not found')
  }
}
```

### ASK Query Results

**Extract boolean from ASK queries:**
```ts
import { askResult, ask } from '@okikio/sparql'

const result = await ask()
  .where(triple('?person', 'foaf:name', 'Alice'))
  .execute(config)

if (result.success) {
  const exists = askResult(result.data)
  console.log('Alice exists:', exists)
}
```

### All Utilities

```ts
import {
  parseBinding,        // Get type metadata
  coerceValue,         // Convert single binding to JS type
  transformResultsTyped, // Transform all results with type coercion
  pluck,               // Extract one variable's values
  first,               // Get first result or undefined
  askResult           // Get boolean from ASK query
} from '@okikio/sparql'
```

---

## Query Composition

### Reusable Patterns

```ts
import { RDF, FOAF, SCHEMA } from '@okikio/sparql'

// Define pattern once
function personPattern(personVar = 'person') {
  return node(personVar, FOAF.Person, {
    [FOAF.name]: v('name'),
    [FOAF.age]: v('age')
  })
}

// Use everywhere
const adults = select(['?name', '?age'])
  .where(personPattern())
  .filter(v('age').gte(18))

const seniors = select(['?name', '?age'])
  .where(personPattern())
  .filter(v('age').gte(65))
```

### Filter Builders

```ts
// Define filters
function olderThan(age: number) {
  return v('age').gte(age)
}

function nameMatches(pattern: string) {
  return v('name').regex(pattern, 'i')
}

// Use them
const query = select(['?name'])
  .where(personPattern())
  .filter(olderThan(21))
  .filter(nameMatches('^John'))
```

### Query Templates

```ts
interface SearchFilters {
  minAge?: number
  maxAge?: number
  city?: string
}

function searchPeople(filters: SearchFilters) {
  let query = select(['?name', '?age', '?city'])
    .where(personPattern())
  
  if (filters.minAge !== undefined) {
    query = query.filter(v('age').gte(filters.minAge))
  }
  
  if (filters.maxAge !== undefined) {
    query = query.filter(v('age').lte(filters.maxAge))
  }
  
  if (filters.city) {
    query = query.filter(v('city').eq(filters.city))
  }
  
  return query
}

// Use with different parameters
const youngAdults = searchPeople({ minAge: 18, maxAge: 25 })
const londonResidents = searchPeople({ city: 'London' })
```

---

## Complete Example

**Putting it all together:**

```ts
import {
  select, triple, node, v, uri,
  RDF, FOAF, SCHEMA,
  getNamespaceIRI,
  transformResultsTyped,
  pluck,
  first
} from '@okikio/sparql'

// Define reusable pattern
function personPattern(personVar = 'person') {
  return node(personVar, FOAF.Person, {
    [FOAF.name]: v('name'),
    [FOAF.age]: v('age'),
    [SCHEMA.email]: v('email')
  })
}

// Build query with prefixes
const query = select(['?name', '?age', '?email'])
  .prefix('rdf', getNamespaceIRI(RDF))
  .prefix('foaf', getNamespaceIRI(FOAF))
  .prefix('schema', getNamespaceIRI(SCHEMA))
  .where(personPattern())
  .filter(v('age').gte(18))
  .orderBy('?age', 'DESC')
  .limit(10)

// Execute and parse
const result = await query.execute({
  endpoint: 'http://localhost:3030/dataset/sparql'
})

if (result.success) {
  // Get typed results
  const rows = transformResultsTyped(result.data)
  console.log('Total people:', rows.length)
  
  // Extract specific data
  const ages = pluck<number>(result.data, 'age', true)
  console.log('Average age:', ages.reduce((a, b) => a + b) / ages.length)
  
  // Get first person
  const oldest = first(result.data)
  if (oldest) {
    console.log('Oldest person:', oldest.name, oldest.age)
  }
  
  // Process all rows
  for (const row of rows) {
    // age is a number, not a string
    if (row.age > 65) {
      console.log('Senior:', row.name)
    }
  }
}
```

---

## Migration Guide

### Before (manual)

```ts
// Full IRIs everywhere
const query = select(['?name'])
  .where(triple(
    '?person',
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    '<http://xmlns.com/foaf/0.1/Person>'
  ))
  .where(triple(
    '?person',
    'http://xmlns.com/foaf/0.1/name',
    '?name'
  ))

// String results
const rows = transformResults(result.data)
for (const row of rows) {
  const age = parseInt(row.age, 10)  // Manual conversion
}
```

### After (with new features)

```ts
// Import constants
import { RDF, FOAF, getNamespaceIRI } from '@okikio/sparql'

// Clean query with prefixes and constants
const query = select(['?name'])
  .prefix('rdf', getNamespaceIRI(RDF))
  .prefix('foaf', getNamespaceIRI(FOAF))
  .where(triple('?person', RDF.type, uri(FOAF.Person)))
  .where(triple('?person', FOAF.name, '?name'))

// Automatic type conversion
const rows = transformResultsTyped(result.data)
for (const row of rows) {
  // age is already a number
  console.log(row.age + 1)
}
```

---

## Next Steps

1. **Add namespace constants to your imports:**
   ```ts
   import { RDF, FOAF, SCHEMA } from '@okikio/sparql'
   ```

2. **Use `.prefix()` in your queries:**
   ```ts
   select([...])
     .prefix('foaf', getNamespaceIRI(FOAF))
     .where(...)
   ```

3. **Switch to enhanced parsing:**
   ```ts
   const rows = transformResultsTyped(result.data)
   const value = first(result.data)
   const list = pluck(result.data, 'variable')
   ```

4. **Extract reusable patterns:**
   ```ts
   function myPattern() { return node(...) }
   
   select([...])
     .where(myPattern())
   ```

Everything is fully typed and documented. Your editor will guide you with autocomplete and inline documentation.