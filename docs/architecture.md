# RDF, SPARQL, vocabulary, engine, and storage architecture

**Status:** implemented current-state architecture with explicit remaining release gates
**Repository:** `okikio/sparql-client`
**Runtime direction:** Deno 2 first, strict TypeScript, ESM, browser/Node/Bun compatible where the capability exists

This document describes the architecture that the current source is intended to implement. Historical design exploration is retained under `docs/research/architecture-design-20260814.md`.

## Goals

The repository provides a complete RDF programming model, SPARQL construction and execution contracts, generated vocabulary tooling, optional query-engine adapters, and persistent RDF storage without turning them into one monolithic runtime.

The design has six primary rules:

1. RDF semantics do not depend on a query engine.
2. SPARQL construction does not own network or engine execution.
3. Generated vocabularies depend on RDF terms and ontology data, not on SPARQL.
4. Engine integrations depend on the generic SPARQL contract, not the reverse.
5. Persistent RDF storage borrows a filesystem capability instead of naming one runtime backend in the package identity.
6. Format parsers and draft standards can evolve behind focused seams without forcing unrelated public APIs to change.

## Package graph

```text
                         @okikio/rdf
                        /      |      \
                       /       |       \
                      v        v        v
          @okikio/sparql  @okikio/vocab  @okikio/triplestore
                 |\
                 | \
                 v  v
   @okikio/oxigraph  @okikio/comunica
```

Allowed direct package dependencies:

| Package | Depends on |
| --- | --- |
| `@okikio/rdf` | no project package |
| `@okikio/sparql` | `@okikio/rdf` |
| `@okikio/vocab` | `@okikio/rdf` |
| `@okikio/triplestore` | `@okikio/rdf` |
| `@okikio/oxigraph` | `@okikio/rdf`, `@okikio/sparql` |
| `@okikio/comunica` | `@okikio/rdf`, `@okikio/sparql` |

`@okikio/sparql` must not depend on a generated vocabulary or a concrete engine. That would make a generic syntax library depend on one ontology/compiler or one execution implementation.

## `@okikio/rdf`

### Responsibility

`@okikio/rdf` owns the semantic RDF programming model:

- named nodes
- blank nodes
- literals
- variables
- default graph
- RDF 1.2 triple terms
- quads
- factories
- equality
- indexed datasets
- namespaces
- RDF/JS conversion
- parser source contracts
- generic ontology interpretation
- loss-preserving shape data

The root module does not import a syntax processor just because the processor exists in the npm package.

### Format subpaths

```text
@okikio/rdf/ntriples
@okikio/rdf/nquads
@okikio/rdf/turtle
@okikio/rdf/trig
@okikio/rdf/jsonld
@okikio/rdf/xml
@okikio/rdf/rdfa
@okikio/rdf/microdata
@okikio/rdf/canon
@okikio/rdf/ontology
@okikio/rdf/shape
```

N-Triples, N-Quads, Turtle, and TriG use project-owned parsers. JSON-LD, RDFC-1.0 canonicalization, RDF/XML, RDFa, and Microdata currently use focused upstream processors behind project-owned contracts.

The npm package has one dependency manifest, so installing `@okikio/rdf` installs those processor dependencies today. The important import guarantee is narrower: importing the root module does not initialize or import those optional processor implementations.

### Parser lifecycle

The native parser shape is:

```text
string / Uint8Array / Iterable / AsyncIterable / ReadableStream
                       |
                       v
               bounded source windows
                       |
                       v
                  scanner state
                       |
                       v
          semantic events / RDF quads
```

Hot RDF parsers do not build a document AST by default.

Early consumer return must stop upstream work. A pending Web Stream read must be cancellable, not merely checked for an already-aborted signal before calling `read()`.

Tolerant parsers must not leak part of a malformed statement as if it were committed RDF. Statement-local quads become visible only after the statement is known to be valid.

### Ontology model

Generic RDFS/OWL interpretation belongs under `@okikio/rdf/ontology`.

The ontology model distinguishes semantic relationships from validation rules. In particular, RDFS domain/range statements do not mean that a JSON property is required.

Unknown or not-yet-normalized ontology assertions are retained so future readers can add semantics without the older reader irreversibly discarding data.

### Shape model

`@okikio/rdf/shape` is version-aware and loss-preserving. It reads known SHACL structure while retaining unsupported, extension, and malformed-known assertions with diagnostics where appropriate.

SHACL 1.2 is evolving as a family of drafts. The IR therefore does not pretend that one current parser is a frozen universal validator.

## `@okikio/sparql`

### Responsibility

`@okikio/sparql` owns:

- typed syntax fragments
- query builders
- update builders
- expression helpers
- property paths
- RDF-aware triple patterns
- source-ranged lexical/syntax inspection
- engine-neutral query/update input contracts
- SPARQL HTTP protocol client under a focused subpath

It does not own a concrete database or query engine.

### Syntax roles

The public model keeps grammar roles distinct:

```text
SparqlTerm       one RDF/SPARQL term or legal predicate path
SparqlExpr       one expression
PatternValue     one graph-pattern fragment
SparqlQuery      one complete query document
SparqlUpdate     one complete Update document
```

Complete documents are not embeddable fragments. A complete SELECT query cannot accidentally be interpolated where a term is legal. A complete update cannot be sent through `queryBindings()` by structural accident.

When a query must become a subquery graph pattern, the conversion is explicit.

### RDF integration

IRI-bearing APIs accept native RDF `NamedNode` values. Triple subjects/predicates/objects preserve RDF terms rather than flattening them to strings.

Generated vocabulary terms therefore compose without a `@okikio/sparql -> @okikio/vocab` dependency:

```ts
import * as rdf from '@okikio/rdf'
import * as sparql from '@okikio/sparql'
import { Product, name } from '@okikio/vocab/schema'

const query = sparql.select(['?product', '?name']).where(
  sparql.triple('?product', rdf.namedNode(rdf.RDF.type), Product),
  sparql.triple('?product', name, '?name'),
)
```

### Execution contract

```ts
interface Queryable {
  queryBindings(...): Promise<AsyncIterable<BindingType>>
  queryQuads(...): Promise<AsyncIterable<Quad>>
  queryBoolean(...): Promise<boolean>
  update(...): Promise<void>
}
```

The result modes correspond to different SPARQL operation classes and remain separate.

The public method is `update()`. Comunica calls its own upstream method `queryVoid()`, so `@okikio/comunica` adapts that private engine name to the generic public contract.

### HTTP

`@okikio/sparql/http` owns SPARQL protocol transport. Builders themselves do not retain an endpoint or execute network requests.

HTTP policy such as content type, result parsing, cancellation, and byte/time limits remains at the protocol-client layer.

### SPARQL 1.2 evolution

SPARQL 1.1 remains the stable Recommendation while SPARQL 1.2 is still evolving. `@okikio/sparql/syntax` therefore exposes a source-ranged event/token seam rather than claiming one draft AST is permanent.

The current lexical layer can report version/feature information and preserve syntax ranges. A future grammar parser and algebra layer can consume that seam without forcing the scanner contract to change.

## `@okikio/vocab`

### Responsibility

`@okikio/vocab` converts RDF ontology data into deterministic developer-facing modules.

```text
RDF quad sources
      |
      v
@okikio/rdf/ontology
      |
      v
vocabulary compiler IR
      |
      +--> naming/collision plan
      +--> TypeScript emitter
      +--> source manifest
```

The compiler does not own a Turtle parser. See [`vocabulary-generation.md`](./vocabulary-generation.md).

### Generated output

A generated class can expose:

```text
Product
ProductPropertiesType
ProductType
ProductSchema
```

A property such as `name` is a native RDF `NamedNode`, so it works directly with RDF datasets and SPARQL builders.

### Standard Schema

Generated `*Schema` values implement Standard Schema validation and Standard JSON Schema conversion through a dependency-free structural contract.

The runtime is open-world and does not convert ontology domain/range metadata into false required-property semantics. See [`standard-schema.md`](./standard-schema.md).

### Generator layering

```text
compile()        reusable library orchestration
read()           RDF ontology -> compiler model
name planning    deterministic symbols/collisions
emit()           compiler model -> TypeScript + manifest
.mise task       files/network/process orchestration only
```

No source parser, network downloader, or filesystem write should become necessary just to call the compiler library.

## `@okikio/triplestore`

### Responsibility

The triplestore owns a persistent indexed RDF dataset, not OPFS itself.

It accepts a small structural filesystem capability. The caller retains ownership of that filesystem unless a future API explicitly transfers it.

### Publication model

The baseline persistence model uses immutable data segments and immutable generation records:

```text
mutation
   |
   v
write immutable segment
   |
   v
verify segment metadata/hash inputs
   |
   v
publish immutable generation record
   |
   v
new generation becomes recoverable
```

Open scans committed generations from newest to oldest and chooses the newest generation whose authoritative data can be read and validated.

An incomplete publication is ignored. A corrupt newest committed generation can fall back only when an older valid committed generation actually exists. A corrupt only-generation must not reopen as an empty database.

This avoids requiring atomic rename semantics from every filesystem adapter.

### Indexes

The in-memory Dataset uses exact-term indexes for subject, predicate, object, and graph. Benchmarking showed exact indexed lookup materially outperforms semantic full scan.

Index representation remains deliberately simpler than a persisted database index. Current cold reopen still rebuilds in-memory indexes from persisted RDF data. Persisted indexes are a future architecture decision that needs its own durability and benchmark comparison.

## Engine adapters

### Oxigraph

`@okikio/oxigraph` wraps a caller-created store.

The current JavaScript store API is synchronous. The adapter checks abort before work but rejects positive `timeoutMs` rather than pretending it can interrupt a synchronous Wasm call.

### Comunica

`@okikio/comunica` wraps a caller-created QueryEngine. The caller decides sources/context.

Streaming results destroy upstream work when the consumer stops early or the supplied signal aborts. Non-streaming cancellation still depends on context/features provided by the upstream engine.

### Ownership

Neither adapter disposes the caller-created engine/store unless a future public contract explicitly says ownership is transferred.

## Standard evolution seams

The repository uses several explicit seams so changing specifications do not force a monolithic rewrite.

| Evolving area | Stable seam |
| --- | --- |
| RDF serialization | RDF quad/term model |
| JSON-LD processing | project loader/result contract around focused processor |
| RDFS/OWL vocabulary semantics | loss-preserving ontology model |
| SHACL drafts | versioned, loss-preserving shape model |
| SPARQL 1.2 grammar | source-ranged syntax event/token layer |
| query engines | `Queryable` |
| vocabulary source formats | quad-source compiler input |
| schema libraries | Standard Schema structural protocol |
| persistent filesystems | structural filesystem capability |

## Cancellation and ownership flow

```text
caller AbortSignal
      |
      +--> parser source read/cancel
      +--> HTTP request
      +--> Comunica stream destroy
      +--> supported external processors

caller resource
      |
      +--> RDF source/stream: borrowed for operation unless API says otherwise
      +--> filesystem: borrowed by triplestore
      +--> Oxigraph Store: borrowed
      +--> Comunica QueryEngine: borrowed
```

Cancellation is an operation control. Observation APIs must not become hidden owners of terminal state.

## Failure propagation

Failures should preserve the capability that failed.

Examples:

- RDF syntax failure -> parser diagnostic/error
- source size or work limit -> explicit limit failure
- malformed engine result -> adapter `TypeError`
- unsupported engine timeout -> explicit adapter failure
- SPARQL endpoint response failure -> HTTP/protocol error
- corrupt persistent generation -> recovery failure/fallback according to committed state
- unsupported Standard JSON Schema target -> explicit conversion failure

Do not turn these failures into empty datasets, empty rows, or successful no-op updates.

## Testing topology

```text
package implementation
      |
      +--> package-owned *_test.ts
      +--> package-owned *_bench.ts

cross-process compiler behavior
      |
      +--> bench/vocab/types.ts

assistant fallback when Deno is unavailable
      |
      +--> external scratch harness only
          never authoritative project tests
```

See [`testing.md`](./testing.md).

## Documentation invariants

Public symbols require TSDoc, but private symbols can encode the more important invariant. Private scanner state transitions, store publication order, compiler collision resolution, schema inheritance, and engine cleanup behavior must be documented in source.

Generated code must receive its TSDoc from the emitter. Hand-editing one generated module is not a sustainable documentation strategy.

## Performance topology

The current performance model is data-oriented but evidence-led:

- bounded parser windows keep direct and streamed parsing on the same hot path
- scanners use synchronous character work inside a buffered window and await only refill
- Dataset retains exact indexes because lookup benchmarks justify them
- generated schemas compose parents to avoid inherited-source explosion
- triplestore delta segments store one operation kind per generation and ordinary N-Quads data
- representation experiments that do not improve end-to-end behavior are reverted

See [`benchmarks.md`](./benchmarks.md) for measured decisions.

## Public entry points

The intended main entry points are:

```text
@okikio/rdf
@okikio/rdf/{ntriples,nquads,turtle,trig,jsonld,xml,rdfa,microdata,canon,ontology,shape}
@okikio/sparql
@okikio/sparql/http
@okikio/sparql/syntax
@okikio/vocab
@okikio/vocab/compile
@okikio/vocab/runtime
@okikio/vocab/standard
@okikio/vocab/schema
@okikio/triplestore
@okikio/oxigraph
@okikio/comunica
```

Subpaths should remain intentional public APIs. Do not expose every internal file as a package export.

## Repository structure

```text
packages/
  rdf/
  sparql/
  vocab/
  triplestore/
  oxigraph/
  comunica/
bench/
  vocab/types.ts
examples/
fixtures/
docs/
.mise/tasks/
```

There is no permanent root `src/` or centralized `tests/` directory.

## Remaining release gates

The architecture is not a release certification. Before publication, the project still needs canonical Deno/JSR validation and external integration/conformance work documented in `VALIDATION.md`.

Most importantly:

- run Deno formatting, linting, strict checks, permanent tests, and benchmarks
- run real optional RDF processors, Oxigraph, and Comunica
- run applicable standards conformance suites
- generate and check the full pinned Schema.org vocabulary
- validate npm/JSR distribution behavior across the supported runtime matrix
- compare alternatives before adopting persisted triplestore indexes or a native SPARQL execution engine
