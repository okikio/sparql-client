# `@okikio/sparql`

SPARQL construction, syntax inspection, and engine-neutral query contracts.

```ts
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?name'])
  .prefix('schema', 'https://schema.org/')
  .where(sparql.triple('?thing', 'schema:name', '?name'))
```

## Syntax roles

The API keeps complete documents separate from embeddable syntax:

```text
SparqlTermType     term or legal property-path position
SparqlExprType     expression
PatternValueType   graph-pattern fragment
SparqlQueryType    complete query document
SparqlUpdateType   complete Update document
```

This prevents a complete query/update from being accepted where the SPARQL grammar requires a term, expression, or WHERE fragment.

## RDF and generated vocabulary terms

IRI-bearing positions accept native RDF named nodes. Generated vocabulary values therefore compose directly without making this package depend on `@okikio/vocab`:

```ts
import * as rdf from '@okikio/rdf'
import * as sparql from '@okikio/sparql'
import { name, offers, price, Product } from '@okikio/vocab/schema'

const query = sparql.select(['?product', '?name']).where(
  sparql.triple('?product', rdf.namedNode(rdf.RDF.type), Product),
  sparql.triple('?product', name, '?name'),
)
```

The same RDF terms work in property paths, graph/update IRIs, datatypes, and prefix declarations:

```ts
const path = sparql.sequence(offers, price)
const text = sparql.typed('42', rdf.namedNode(rdf.XSD.integer))
const update = sparql.update().clear(rdf.namedNode('urn:graph:old')).build()
```

Strict IRI positions reject variable/literal `SparqlTermType` values at runtime instead of trusting any branded term as an IRI.

## Execution

Execution is separate. Use `@okikio/sparql/http`, `@okikio/oxigraph`, `@okikio/comunica`, or another implementation of `Queryable`.

```ts
interface Queryable {
  queryBindings(...): Promise<AsyncIterable<BindingType>>
  queryQuads(...): Promise<AsyncIterable<rdf.Quad>>
  queryBoolean(...): Promise<boolean>
  update(...): Promise<void>
}
```

`update()` is the public update operation. A concrete upstream engine can use a different internal method name; for example, Comunica currently exposes `queryVoid()`, which its adapter translates to `update()`.

See [`../../docs/sparql-mapping.md`](../../docs/sparql-mapping.md).
