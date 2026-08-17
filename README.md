# RDF and SPARQL for TypeScript

This repository is the home of a small RDF and SPARQL package family for Deno, Node.js, Bun, browsers, and Workers.

The packages are library-first. Importing a package describes or creates values. It does not open files, start query engines, initialize WebAssembly, perform network requests, or configure global state.

```text
@okikio/rdf
    │
    ├── @okikio/sparql
    │       ├── @okikio/oxigraph
    │       └── @okikio/comunica
    │
    ├── @okikio/vocab
    └── @okikio/triplestore
```

The repository targets current RDF 1.2 semantics while keeping draft-dependent behavior explicit. SPARQL and SHACL 1.2 features are versioned because those specifications are still evolving.

## Packages

| Package | Responsibility | Runtime dependency posture |
| --- | --- | --- |
| `@okikio/rdf` | RDF terms, datasets, parsers, ontology and shape models | root module imports no third-party processor; processor subpaths are isolated |
| `@okikio/sparql` | SPARQL construction, lexical inspection, result contracts, HTTP protocol client | core depends only on `@okikio/rdf` |
| `@okikio/vocab` | Ontology-to-TypeScript compiler and generated vocabulary runtime | depends on `@okikio/rdf` |
| `@okikio/triplestore` | Crash-recoverable persistent RDF dataset | depends on `@okikio/rdf`; borrows a structural filesystem |
| `@okikio/oxigraph` | Adapter from a caller-owned Oxigraph `Store` to the SPARQL query contract | Oxigraph remains caller-owned |
| `@okikio/comunica` | Adapter from a caller-owned Comunica `QueryEngine` to the SPARQL query contract | Comunica remains caller-owned |

## RDF

Use a namespace import for RDF operations. The namespace gives short operations enough context without forcing long exported names.

```ts
import * as rdf from '@okikio/rdf'

const product = rdf.namedNode('https://example.com/products/1')
const name = rdf.namedNode('https://schema.org/name')

const data = rdf.dataset([
  rdf.quad(product, name, rdf.literal('Widget')),
])

for (const quad of data.match(product)) {
  console.log(quad.object.value)
}
```

The root exports the semantic model only. Syntax-specific code is opt-in:

```ts
import * as nquads from '@okikio/rdf/nquads'
import * as turtle from '@okikio/rdf/turtle'
import * as jsonld from '@okikio/rdf/jsonld'
import * as canon from '@okikio/rdf/canon'
```

Implemented format and semantic subpaths currently include:

```text
@okikio/rdf/ntriples   N-Triples 1.2 parsing and serialization
@okikio/rdf/nquads     N-Quads 1.2 parsing and serialization
@okikio/rdf/turtle     Turtle 1.2 streaming parser and conservative serializer
@okikio/rdf/trig       TriG 1.2 streaming parser and conservative serializer
@okikio/rdf/jsonld     JSON-LD processor adapter with bounded document loading
@okikio/rdf/xml        RDF/XML streaming adapter
@okikio/rdf/rdfa       RDFa 1.1 streaming adapter
@okikio/rdf/microdata  Microdata-to-RDF streaming adapter
@okikio/rdf/canon      RDFC-1.0 canonicalization
@okikio/rdf/ontology   RDFS/OWL ontology interpretation model
@okikio/rdf/shape      loss-preserving SHACL shape model
```

`@okikio/rdf` uses `Iterable`, `AsyncIterable`, `ReadableStream`, `AbortSignal`, and explicit disposal where those shapes match the workload. RDF/JS is an interoperability target, not a required core dependency.

## SPARQL

Build queries independently from the engine that executes them.

```ts
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?product', '?name'])
  .prefix('schema', 'https://schema.org/')
  .where(sparql.triple('?product', 'schema:name', '?name'))
  .orderBy('?name')
  .limit(25)

console.log(query.build().value)
```

Execution is explicit:

```ts
import { createClient } from '@okikio/sparql/http'

const client = createClient({ endpoint: 'https://example.com/sparql' })

for await (const row of await client.queryBindings(query)) {
  console.log(row.get('name')?.value)
}
```

The result modes stay separate:

```ts
client.queryBindings(query) // SELECT
client.queryQuads(query)    // CONSTRUCT / DESCRIBE
client.queryBoolean(query)  // ASK
client.update(update)       // UPDATE
```

This prevents graph results from being coerced into binding rows and keeps RDF values as RDF terms instead of silently converting datatypes to JavaScript primitives.

`@okikio/sparql/syntax` exposes a source-ranged token and feature event stream for inspection, diagnostics, editors, formatters, and future grammar/algebra parsing. It is intentionally not advertised as a complete SPARQL AST today.

## Generated vocabularies

Generated vocabulary data uses direct, tree-shakeable imports. Runtime values, schemas, and types use PascalCase when the vocabulary term is PascalCase.

```ts
import {
  Product,
  ProductSchema,
  type ProductType,
  name,
  offers,
} from '@okikio/vocab/schema'
```

This avoids awkward APIs such as `schema.ProductSchema` while still allowing operation-oriented namespaces elsewhere.

A generated class normally provides:

```text
Product             RDF named node
ProductType         TypeScript JSON-LD/value shape
ProductSchema       Standard Schema + Standard JSON Schema validator
ProductPropertiesType
```

The compiler consumes RDF ontology quads through `@okikio/rdf/ontology`. It does not parse one specific source syntax itself. Schema.org-specific `domainIncludes` and `rangeIncludes` aliases are compiler policy, not RDF core semantics.

The checked-in Schema.org module is currently a bootstrap slice used to validate the public API and compiler. The complete upstream vocabulary must be regenerated from an authoritative Schema.org release before publication.

## Persistent RDF

`@okikio/triplestore` is a persistent RDF dataset, not an OPFS-specific package. It borrows any filesystem satisfying its small structural contract. `@okikio/opfs` is the intended browser/runtime filesystem provider.

```ts
import * as rdf from '@okikio/rdf'
import { open } from '@okikio/triplestore'

await using store = await open(fileSystem, { path: '/knowledge' })

await store.add(rdf.quad(
  rdf.namedNode('https://example.com/1'),
  rdf.namedNode('https://schema.org/name'),
  rdf.literal('Widget'),
))
```

The baseline store uses immutable segments and immutable generation records. Recovery scans for the newest fully valid committed generation and ignores incomplete publications. It deliberately does not depend on filesystem rename being atomic across every adapter.

The current implementation is one-writer-per-path. Cross-process writer coordination and physical garbage collection are not claimed yet.

## Oxigraph and Comunica

The engine integration packages wrap resources that the caller creates and owns.

```ts
import { Store } from 'oxigraph'
import { createClient } from '@okikio/oxigraph'

const store = new Store()
const client = createClient(store)
```

```ts
import { QueryEngine } from '@comunica/query-sparql'
import { createClient } from '@okikio/comunica'

const engine = new QueryEngine()
const client = createClient(engine, {
  context: () => ({ sources: [/* caller-selected sources */] }),
})
```

Importing either adapter does not create an engine or initialize unrelated runtime state.

## Parser model

Hot parsers use a data-oriented streaming model:

```text
source windows
    ↓
mutable scanner state
    ↓
semantic events
    ↓
quads / directives / diagnostics
```

The normal RDF path does not create an AST. Source-ranged event streams exist where callers need tolerant parsing, diagnostics, inspection, or incremental tooling. This follows the same useful principle as `@okikio/wikitext`: the event stream is the factual interchange layer, while materialized structures are optional consumers.

## Validation and benchmarks

Package tests live beside the package code. Runtime benchmarks use Mitata. Compiler/type benchmarks use isolated TypeScript subprocesses because compiler memory and type-instantiation cost are different measurements from hot runtime throughput.

The permanent benchmark questions include:

- RDF term creation and equality
- Dataset scan versus indexed matching
- N-Triples/N-Quads parsing and chunk sizes
- Turtle/TriG parsing
- SPARQL syntax streaming versus materialization
- persistent store read/write/recovery behavior
- vocabulary generation time and emitted bytes
- TypeScript compiler time, memory, symbols, types, and instantiations
- generated schema validation
- optional engine integration where the upstream package is available

Benchmarks must state the semantic oracle. A faster result is not accepted when it performs less work or changes the result.

## Development

The production project is Deno-native:

```sh
deno task fmt
deno task lint
deno task check
deno task test
deno task bench
deno task verify
```

Vocabulary compilation is a library capability. File I/O for the repository task lives under `.mise/tasks/`:

```sh
deno task vocab --input ontology.nq --out packages/vocab/example --name example --namespace https://example.com/ --prefix ex

# Reproduce the pinned complete Schema.org release when network access is available.
deno task vocab:schema
```

`.agents/` is reserved for disposable assistant validation only and is ignored by the repository. Permanent tests, benchmarks, fixtures, and release evidence belong in project-owned package/workspace locations. See [`docs/testing.md`](./docs/testing.md).

## Current implementation status

Implemented and locally validated without optional upstream packages:

- RDF 1.2-native core terms, triple terms, directional literals, Dataset indexes
- streaming N-Triples/N-Quads
- streaming Turtle/TriG semantic parser
- RDF ontology and SHACL shape IRs
- SPARQL builder migration and explicit result-mode contracts
- SPARQL HTTP protocol client
- source-ranged SPARQL syntax inspection
- vocabulary compiler/runtime/bootstrap Schema.org surface
- crash-recoverable triplestore
- caller-owned Oxigraph and Comunica adapters
- lifecycle adapters for JSON-LD, RDF/XML, RDFa, Microdata, and RDFC-1.0

Still requiring canonical upstream validation before release claims:

- Deno formatting, linting, type checks, and package-local tests on a Deno/JSR-capable host
- W3C RDF/Turtle/TriG/SPARQL/SHACL conformance corpora
- real `jsonld`, `rdf-canonize`, RDF/XML, RDFa, and Microdata dependency integration
- real Oxigraph Wasm and Comunica engine integration
- complete generated Schema.org vocabulary
- package builds and JSR/npm publication artifacts

See [`docs/standard-schema.md`](./docs/standard-schema.md) for generated validation, [`docs/vocabulary-generation.md`](./docs/vocabulary-generation.md) for the `ttl-to-ts` replacement, [`docs/testing.md`](./docs/testing.md) for permanent test ownership, [`docs/migration.md`](./docs/migration.md) for intentional 0.0.2 API changes, [`docs/benchmarks.md`](./docs/benchmarks.md) for benchmark-derived decisions, and [`VALIDATION.md`](./VALIDATION.md) for the exact passed and blocked release gates.

## License

MIT
