# SPARQL construction and execution mapping

This guide maps the current `@okikio/sparql` API to SPARQL syntax and to the package graph around it. Query construction is independent from endpoint or engine execution.

## Syntax roles

The package distinguishes the major grammar roles instead of treating every fragment as one branded string.

| Type | Meaning | Typical producers |
| --- | --- | --- |
| `SparqlTerm` | one term or legal predicate-path syntax | `v()`, `iri()`, `tripleTerm()`, property-path helpers |
| `SparqlExpr` | one expression | comparison/arithmetic/functions, `exists()` |
| `PatternValue` | one graph-pattern fragment | `triple()`, `filter()`, `optional()`, `graph()`, `service()`, `values()` |
| `SparqlQuery` | one complete query document | `QueryBuilder.build()` |
| `SparqlUpdate` | one complete Update document | update builders |

Complete query/update documents are intentionally not embeddable `SparqlValue` fragments. Use `subquery()` when a complete query must become a graph pattern.

## RDF terms

Native `@okikio/rdf` named nodes are accepted in IRI-bearing grammar positions.

```ts
import * as rdf from '@okikio/rdf'
import * as sparql from '@okikio/sparql'
import { Product, name } from '@okikio/vocab/schema'

const query = sparql.select(['?product', '?name']).where(
  sparql.triple('?product', rdf.namedNode(rdf.RDF.type), Product),
  sparql.triple('?product', name, '?name'),
)
```

`@okikio/sparql` does not depend on `@okikio/vocab`. Generated vocabulary terms compose because they are RDF named nodes.

That composition applies across the IRI/predicate surface, not only simple triples:

```ts
import { name, offers, price } from '@okikio/vocab/schema'

sparql.zeroOrMore(name)
sparql.sequence(offers, price)
sparql.typed('42', rdf.namedNode(rdf.XSD.integer))
sparql.update().clear(rdf.namedNode('urn:graph:old'))
```

Strict graph positions validate `SparqlTerm` syntax and reject variables or literals. `GRAPH` and `SERVICE` keep their separate `VarOrIriRef` behavior because variables are legal there.

## SELECT

```ts
sparql.select(['?name', '?age'])
  .where(sparql.triple('?person', 'foaf:name', '?name'))
  .where(sparql.triple('?person', 'foaf:age', '?age'))
  .filter(sparql.v('age').gte(18))
  .orderBy('?age', 'DESC')
  .limit(10)
```

```sparql
SELECT ?name ?age
WHERE {
  ?person foaf:name ?name .
  ?person foaf:age ?age .
  FILTER(?age >= 18)
}
ORDER BY DESC(?age)
LIMIT 10
```

## ASK

```ts
sparql.ask()
  .where(sparql.triple('?person', 'foaf:name', 'Alice'))
```

```sparql
ASK
WHERE {
  ?person foaf:name "Alice" .
}
```

## CONSTRUCT

Template and WHERE pattern are separate inputs:

```ts
sparql.construct(
  sparql.triple('?copy', 'schema:name', '?name'),
).where(
  sparql.triple('?source', 'schema:name', '?name'),
)
```

```sparql
CONSTRUCT {
  ?copy schema:name ?name .
}
WHERE {
  ?source schema:name ?name .
}
```

The shorthand `CONSTRUCT WHERE { ... }` is available when no separate template is supplied.

Use `queryQuads()` for CONSTRUCT results.

## DESCRIBE

```ts
sparql.describe([
  rdf.namedNode('https://example.com/person/1'),
  '?other',
])
```

Use `queryQuads()` for the result.

## Triple patterns

```ts
sparql.triple('?person', 'foaf:name', '?name')
```

```sparql
?person foaf:name ?name .
```

Variables are legal in predicate position:

```ts
sparql.triple('?s', '?p', '?o')
```

```sparql
?s ?p ?o .
```

The builder must preserve `?p` as a variable. It must not normalize it to a prefixed name such as `:?p`.

## Grouped triples

```ts
sparql.triples('?person', [
  ['foaf:name', '?name'],
  ['foaf:age', '?age'],
])
```

The grouped helper emits semicolon syntax and rejects an empty predicate-object list.

## Filters and expressions

```ts
sparql.v('age').gte(18)
sparql.v('price').mul(0.9).round()
sparql.regex(sparql.v('name'), '^A', 'i')
sparql.coalesce(sparql.v('nickname'), sparql.v('name'))
```

`FILTER` is a graph-pattern construct but its argument is an expression:

```ts
sparql.filter(sparql.v('age').gte(18))
```

This distinction is reflected in the TypeScript brands.

## OPTIONAL, MINUS, GRAPH, and SERVICE

```ts
sparql.optional(
  sparql.triple('?person', 'schema:nickname', '?nickname'),
)

sparql.minus(
  sparql.triple('?person', 'schema:disambiguatingDescription', '?blocked'),
)

sparql.graph(
  rdf.namedNode('urn:graph:people'),
  sparql.triple('?s', '?p', '?o'),
)

sparql.service(
  rdf.namedNode('https://example.com/sparql'),
  sparql.triple('?person', 'dbo:birthPlace', '?birthPlace'),
)
```

Graph/service IRIs preserve native RDF named nodes.

## UNION

```ts
sparql.select('*').union(
  sparql.triple('?s', 'schema:name', '?name'),
  sparql.triple('?s', 'schema:sku', '?sku'),
)
```

The alternatives are serialized as disjunctions, not as one conjunction.

## Property paths

```ts
sparql.zeroOrMore('foaf:knows')
sparql.sequence('schema:address', 'schema:addressLocality')
sparql.alternative('foaf:name', 'schema:name')
```

Property paths return `SparqlTerm` because that syntax is legal in the predicate position of a triple path.

## SPARQL 1.2 triple terms

```ts
sparql.tripleTerm('?s', 'schema:name', '?name')
```

```sparql
<<( ?s schema:name ?name )>>
```

The older public `quotedTriple()` / SPARQL-star terminology is intentionally removed.

## VALUES and `UNDEF`

`UNDEF` is the SPARQL data-block token, not a variable named `UNDEF`:

```ts
sparql.values(['?name'], [
  ['Alice'],
  [sparql.undef()],
])
```

Do not use `?UNDEF` as a stand-in.

## Subqueries

A complete query is not automatically a graph pattern. Convert it explicitly:

```ts
const inner = sparql.select(['?person'])
  .where(sparql.triple('?person', 'a', 'schema:Person'))

const outer = sparql.select('*')
  .where(sparql.subquery(inner))
```

This keeps the public types aligned with the grammar instead of allowing arbitrary complete documents in WHERE.

## Updates

A modify operation keeps DELETE, INSERT, and WHERE patterns separate:

```ts
const update = sparql.modify()
  .delete(sparql.triple('?person', 'foaf:age', '?oldAge'))
  .insert(sparql.triple('?person', 'foaf:age', sparql.v('oldAge').add(1)))
  .where(sparql.triple('?person', 'foaf:age', '?oldAge'))
  .done()
```

`INSERT DATA` and `DELETE DATA` graph positions require graph IRIs, not variables.

`COPY`, `MOVE`, and `ADD` use the SPARQL `GraphOrDefault` grammar. `CLEAR` and `DROP` preserve `DEFAULT`, `NAMED`, and `ALL` rather than forcing a `GRAPH` token onto every form.

## Queryable execution contract

Construction and execution meet at the engine-neutral `Queryable` interface:

```ts
interface Queryable {
  queryBindings(query, options?): Promise<AsyncIterable<BindingType>>
  queryQuads(query, options?): Promise<AsyncIterable<rdf.Quad>>
  queryBoolean(query, options?): Promise<boolean>
  update(update, options?): Promise<void>
}
```

Use the result mode that matches the operation:

```ts
client.queryBindings(selectQuery)
client.queryQuads(constructOrDescribeQuery)
client.queryBoolean(askQuery)
client.update(updateDocument)
```

The public update method is `update()`.

`@okikio/comunica` internally adapts that method to Comunica's upstream `queryVoid()` API. The upstream name does not leak into the generic contract.

## HTTP client

```ts
import { createClient } from '@okikio/sparql/http'

const client = createClient({ endpoint: 'https://example.com/sparql' })
const rows = await client.queryBindings(query)
```

The HTTP client owns endpoint transport, accepted media types, bounded response handling, protocol/result decoding, and request cancellation. Builders do not retain endpoint state.

## Oxigraph and Comunica

```ts
import { createClient as createOxigraphClient } from '@okikio/oxigraph'
import { createClient as createComunicaClient } from '@okikio/comunica'
```

Both adapters implement the same `Queryable` contract.

The caller creates and owns the engine. `@okikio/sparql` itself has no dependency on either engine package.

## Syntax inspection

`@okikio/sparql/syntax` provides source-ranged tokens, version events, feature events, and diagnostics without claiming a complete frozen SPARQL 1.2 AST:

```ts
import * as syntax from '@okikio/sparql/syntax'

for await (const event of syntax.events(source)) {
  console.log(event)
}
```

This lexical/event seam is intended for formatters, diagnostics, editors, and future grammar/algebra consumers while SPARQL 1.2 continues to evolve.
