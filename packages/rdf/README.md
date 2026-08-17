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

Use explicit subpaths:

```ts
import * as nquads from '@okikio/rdf/nquads'
import * as turtle from '@okikio/rdf/turtle'
import * as jsonld from '@okikio/rdf/jsonld'
import * as ontology from '@okikio/rdf/ontology'
import * as shape from '@okikio/rdf/shape'
```

Available public subpaths include:

```text
ntriples
nquads
turtle
trig
jsonld
xml
rdfa
microdata
canon
ontology
shape
```

The root module does not import or initialize the focused third-party processors used by JSON-LD, RDFC-1.0, RDF/XML, RDFa, or Microdata. The npm package manifest is package-scoped, however, so installing `@okikio/rdf` currently installs those dependencies.

## Parser lifecycle

Project-owned streaming parsers use bounded source windows and cancel pending Web Stream reads when an operation stops. Tolerant parsing withholds statement-local semantic output until the current statement is known to be valid, so recovery does not leak partial RDF.

## Ontologies and shapes

`@okikio/rdf/ontology` interprets generic named RDFS/OWL relationships while retaining unsupported assertions.

`@okikio/rdf/shape` reads loss-preserving SHACL shape structure. Ontology domain/range semantics are not treated as closed-world JSON requiredness.

See the repository architecture and testing guides for the current standards/version posture and release gates.
