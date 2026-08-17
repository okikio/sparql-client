# Migration from `@okikio/sparql` 0.0.2

Version 0.1 reorganizes the repository around RDF, SPARQL, vocabulary generation, persistence, and optional query engines. This is a pre-release clean break. Obsolete APIs are removed instead of being retained through compatibility wrappers.

## Package changes

| 0.0.2 concept | 0.1 target |
| --- | --- |
| RDF namespace constants inside `@okikio/sparql` | generated terms in `@okikio/vocab/*` or `rdf.namespace()` |
| `Executor` / `createExecutor()` | `@okikio/sparql/http.createClient()` or an engine adapter |
| builder `.execute()` | build first, then call `client.query*()` |
| `executeSparql()` | explicit HTTP client result-mode methods |
| `transformResults()` / datatype coercion | binding values remain RDF terms |
| `resolveLabels()` | application query recipe; no core replacement |
| `fetchProperties()` | application query recipe; no core replacement |
| `expand()` | application query recipe; no core replacement |
| `scripts/ttl-to-ts.ts` | `@okikio/vocab` compiler + `.mise/tasks/vocab.ts` |
| N3 dependency inside the generator | RDF parser chosen by the caller; compiler consumes quads |
| old `quotedTriple()` / SPARQL-star wording | RDF/SPARQL 1.2 `tripleTerm()` |

## Query execution

Before:

```ts
const result = await select(['?name'])
  .where(triple('?person', 'foaf:name', '?name'))
  .execute({ endpoint })
```

After:

```ts
import * as sparql from '@okikio/sparql'
import { createClient } from '@okikio/sparql/http'

const query = sparql.select(['?name'])
  .where(sparql.triple('?person', 'foaf:name', '?name'))

const client = createClient({ endpoint })
for await (const row of await client.queryBindings(query)) {
  console.log(row.get('name')?.value)
}
```

This is intentional. Query construction is reusable without HTTP, and endpoint policy no longer leaks into every builder.

## Result values

The old executor converted selected XSD values to JavaScript numbers, booleans, and `Date` instances. The new query contract returns RDF terms.

```ts
const price = row.get('price')
if (price?.termType === 'Literal') {
  console.log(price.value, price.datatype.value)
}
```

Automatic coercion was removed because it loses lexical/datatype information and can misrepresent RDF datatypes that do not map cleanly to JavaScript primitives.

## RDF namespaces and vocabularies

Do not import hand-maintained `RDF`, `RDFS`, `FOAF`, or `SCHEMA` objects from SPARQL.

For dynamic namespaces:

```ts
import * as rdf from '@okikio/rdf'

const schema = rdf.namespace('https://schema.org/')
const name = schema('name')
```

For generated vocabularies, prefer direct imports:

```ts
import { Product, ProductSchema, type ProductType, name } from '@okikio/vocab/schema'
```

This keeps generated types and schemas tree-shakeable and avoids `lowercase.CamelCase` call sites.

## SPARQL 1.2

The old `quotedTriple()` API used older RDF-star/SPARQL-star terminology. Use the current triple-term builder:

```ts
sparql.tripleTerm('?s', 'schema:name', '?name')
```

SPARQL 1.2 remains a Working Draft. Version-sensitive syntax inspection is available under `@okikio/sparql/syntax` rather than being hidden in an unversioned string builder.
