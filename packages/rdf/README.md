# `@okikio/rdf`

RDF programming model for TypeScript runtimes.

```ts
import * as rdf from '@okikio/rdf'

const schema = rdf.namespace('https://schema.org/')
const product = rdf.namedNode('https://example.com/product/1')
const data = rdf.dataset([
  rdf.quad(product, schema('name'), rdf.literal('Widget')),
])
```

## Core model

The root owns RDF 1.2 terms, RDF/JS interoperability, Dataset indexes, namespaces, source contracts, and shared serialization primitives. RDF 1.2 triple terms are represented as default-graph quads when embedded as objects.

The native streaming contracts use JavaScript/Web primitives:

```text
Iterable<Quad>
AsyncIterable<Quad>
ReadableStream<Uint8Array>
AbortSignal
```

## Formats and semantics

Project-owned syntax and semantic capabilities use explicit `@okikio/rdf` subpaths:

```ts
import * as nquads from '@okikio/rdf/nquads'
import * as turtle from '@okikio/rdf/turtle'
import * as ontology from '@okikio/rdf/ontology'
import * as shape from '@okikio/rdf/shape'
```

The package exports:

```text
@okikio/rdf/ntriples
@okikio/rdf/nquads
@okikio/rdf/turtle
@okikio/rdf/trig
@okikio/rdf/ontology
@okikio/rdf/shape
@okikio/rdf/stream
```

`@okikio/rdf` has no third-party runtime implementation dependency. JSON-LD, RDFC-1.0, RDF/XML, RDFa, and Microdata are implemented natively at `@okikio/rdf/jsonld`, `@okikio/rdf/canon`, `@okikio/rdf/xml`, `@okikio/rdf/rdfa`, and `@okikio/rdf/microdata`. Tests, conformance suites, and benchmarks can use external implementations only as independent correctness and performance references.

## Parser lifecycle

Project-owned streaming parsers use bounded source windows and cancel pending Web Stream reads when an operation stops. Tolerant parsing withholds statement-local semantic output until the current statement is known to be valid, so recovery does not leak partial RDF.

## Ontologies and shapes

`@okikio/rdf/ontology` interprets generic named RDFS/OWL relationships while retaining unsupported assertions.

`@okikio/rdf/shape` inspects loss-preserving SHACL shape structure. Ontology domain/range semantics are not treated as closed-world JSON requiredness.

See the repository architecture and testing guides for the current standards/version posture and release gates.
