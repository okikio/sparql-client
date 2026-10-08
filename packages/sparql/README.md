# `@okikio/sparql`

SPARQL construction, syntax inspection, and engine-neutral query contracts.

```ts
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?name'])
  .prefix('schema', 'https://schema.org/')
  .where(sparql.triple('?thing', 'schema:name', '?name'))
```

See the repository [standards matrix](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/conformance.md#standards-and-capability-boundaries) for construction, inspection, result-format and HTTP subsets. This package does not evaluate queries or certify the full SPARQL grammar. Draft-sensitive RDF/SPARQL 1.2 features also require support in the selected endpoint or engine.

## Syntax roles

The API keeps complete documents separate from embeddable syntax:

```text
SparqlTermType     one RDF/SPARQL term
SparqlPathType     predicate-only property path
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
  queryBindings(...): Promise<ResultType<BindingType>>
  queryQuads(...): Promise<ResultType<rdf.Quad>>
  queryBoolean(...): Promise<boolean>
  update(...): Promise<void>
}
```

`update()` is the public update operation. A concrete upstream engine can use a different internal method name; for example, Comunica currently exposes `queryVoid()`, which its adapter translates to `update()`.

See [SPARQL mapping](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/sparql-mapping.md).

SELECT result blank-node labels are scoped to one response. `decodeBindings` and the HTTP client reuse each label within that response and allocate disjoint node identities for later responses, including nested triple terms. A returned blank-node label cannot identify a resource in another endpoint response. The lower-level `decodeTerm` preserves one explicit label when the caller owns its surrounding identity context.

## HTTP and result formats

`@okikio/sparql/http` sends queries through GET, form POST or direct POST and updates through form or direct POST. Query/update dataset parameters, caller headers, cancellation, deadlines and response limits are explicit controls. Failed mutations are not automatically retried; authentication exchanges and federation planning belong to the caller or engine.

SELECT and ASK responses use SPARQL Results JSON. Bindings preserve RDF terms and are materialized before iteration. CSV, TSV and XML results decoding are absent. Graph responses accept N-Triples, N-Quads or Turtle; their parser streams carry cancellation and size limits. RDF 1.2 nested triple/directional JSON terms are supported by the decoder, but no complete official SPARQL results corpus profile is claimed.

`@okikio/sparql/graph-store` implements GET/PUT/POST/DELETE on explicitly selected default/named graphs using N-Triples transfer. It does not implement HEAD/PATCH, direct graph-resource addressing or unnamed POST graph creation. Its protocol subset is tested independently from the official RDF reader profiles.

## Checked construction and ordered groups

```ts
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?person', '?newAge'])
  .where(sparql.triple('?person', 'https://schema.org/age', '?oldAge'))
  .bind(sparql.v('oldAge').add(1), 'newAge')
  .where(sparql.triple('?person', 'https://schema.org/targetAge', '?newAge'))
  .build()
```

Clauses keep their admission order. FILTER applies to the containing group;
using a variable before its binding in a filter is not automatically invalid.
BIND cannot rebind an already introduced variable in that checked group. Repeated
VALUES remain separate joins. An empty `select().build()` produces `SELECT * WHERE {}`.
Only SELECT without dataset clauses converts to a SubSelect; compatible prefixes
move to the outer document.

Arithmetic and compound paths retain child grouping. A path is allowed only as a
query predicate, not an object, expression or data template. The SPARQL 1.1 API
has no `%` or `mod()` operator. Engine extensions require explicit `rawExpr()`.
`integer()` accepts bigint or safe integer numbers; `decimal()` accepts an exact
non-exponent decimal string or a finite JS number; `double()` retains xsd:double,
including `INF`, `-INF` and `NaN`. A JS number cannot recover precision already lost
before construction. Arbitrary RDF datatype literal lexical values stay unchanged.

Prefix/local/variable/blank/language tokens follow their full SPARQL lexical
productions. This validates spelling, not prefix declaration, language registry
membership or a complete externally supplied query. `rawTerm`, `rawExpr` and
`rawPattern` are explicit trusted-syntax escape hatches. Checked strings in object
positions become literals; use `uri()`/`prefixed()` or an RDF NamedNode for an IRI.

## Result ownership

Returned results retain ordinary `for await` use and also own release before any
pull. `cancel()` or `await close()` promptly ends observation, including a pending
read. `cleanup` observes actual cooperative release independently; it can remain
pending if a producer ignores cancellation. `await using` and
`close({ waitForCleanup: true })` intentionally wait for cleanup. A result has one
consumer and one pending pull. Closing it never disposes the borrowed engine.
Custom `Queryable` adapters wrap their acquired sources with exported `result()`.

HTTP Turtle graphs resolve relative IRIs against the actual final response URL,
falling back to the prepared request URL for injected fetch implementations.
Graph bodies are owned before iteration; late responses after abort are retired.
`onCleanup` observes late acquisition cleanup without delaying terminal failure.
