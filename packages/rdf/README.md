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

See the repository [standards matrix](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/conformance.md#standards-and-capability-boundaries) for the exact tested profiles and partial or absent capabilities. Reader conformance, writer round trips, term interoperability, shape inspection and reasoning are separate contracts.

## Core model

The root owns RDF 1.2 terms, RDF/JS interoperability, Dataset indexes, namespaces, source contracts, and shared serialization primitives. RDF 1.2 triple terms are represented as default-graph quads when embedded as objects.

The factory uses RDF statement positions. RDF/JS variable-bearing query-pattern quads and the full extended Dataset interface are outside this API; `Dataset` implements the DatasetCore-style set operations. Factories preserve values without full IRI/BCP47 or RDF datatype value-space validation. Parsing applies the selected syntax rules; it does not perform entailment.

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

## JSON-LD statements

```ts
import { toRdf } from '@okikio/rdf/jsonld'

const statements = await toRdf({ '@id': 'urn:person', 'urn:name': 'Ada' })
// statements has type Quad[] and can enter ordinary RDF datasets and writers.

const generalized = await toRdf(
  { '@id': '_:relation', '_:relation': { '@id': 'urn:object' } },
  { produceGeneralizedRdf: true },
)
// generalized has type GeneralizedQuadType[]. Its predicate may be a BlankNode.
```

Ordinary RDF requires a named-node predicate. The JSON-LD `produceGeneralizedRdf` option explicitly permits blank predicates and changes the return type of `toRdf` and `parse`. Generalized statements require a consumer that accepts that model; the standard dataset, persistent store, canonicalizer, and N-Quads writer accept ordinary `Quad` statements. Convert generalized predicates deliberately before passing them to those consumers.

JSON-LD expansion, compaction, flattening, framing, and RDF conversion materialize their operation data. They do not provide bounded streaming semantics. Remote loading remains caller controlled and bounded by the loader's document, byte, and redirect limits.

## Parser lifecycle

N-Triples, N-Quads, Turtle and TriG use bounded source windows and can yield statements before source EOF. Pending source reads respond to cancellation. Tolerant parsing withholds statement-local semantic output until the current statement is known to be valid, so recovery does not leak partial RDF.

RDF/XML, RDFa and Microdata first collect the complete markup source, build its bounded element/text tree and materialize result quads. Their async generators yield only after extraction finishes; accepting a stream does not give these formats incremental output or memory proportional to one source chunk. The configured markup caps are `maxBytes` (default 16 MiB of UTF-8 input), `maxNodes` (250,000 element/text nodes), and `maxDepth` (512 open element levels). Each cap must be a positive safe integer, and exceeding it rejects with `RangeError`. Retained memory also includes decoded text, the tree and result terms.

RDFa additionally accepts `maxQuads`, defaulting to 1,000,000. This bounds emitted lists and intermediate pattern-copy expansion as well as ordinary statements, so expansion can exceed the cap before pattern cleanup reduces the final output. An over-limit parse rejects instead of yielding a partial graph. Cancellation checks cover source acquisition, extraction and each yielded result; they do not make synchronous work preemptible inside one JavaScript task.

Turtle, TriG, RDF/XML, and JSON-LD keep blank-node labels local to one document. Repeated references inside that document share one node; parsing independent documents allocates distinct nodes so concatenating their quads does not merge unrelated resources. Microdata and RDFa follow the same operation ownership. Blank-node values are opaque identifiers, so graph round trips compare isomorphism rather than generated label spelling.

The low-level N-Triples and N-Quads decoders retain supplied labels. Persistent store segments depend on that shared label space for replay and deletion. Callers merging independent line-format documents must assign separate label spaces; a label in one external document does not establish identity with the same spelling in another document.

## Canonicalization and writers

`@okikio/rdf/canon` implements RDFC-1.0 over RDF 1.1 datasets. It rejects RDF 1.2 triple terms and directional language literals, for which RDFC-1.0 does not define canonicalization. Canonicalization materializes bounded input and applies N-degree work limits; a valid costly dataset can require a deliberate larger work limit.

N-Triples/N-Quads `write` and Turtle/TriG `serialize` return materialized strings in input iteration order. Their explicit-term layouts preserve RDF semantics without canonicalizing dataset order or blank-node labels. Turtle/N-Triples reject named graphs; TriG/N-Quads retain them. RDF/XML, RDFa and Microdata provide readers only.

## Ontologies and shapes

`@okikio/rdf/ontology` interprets generic named RDFS/OWL relationships while retaining unsupported assertions.

`@okikio/rdf/shape` inspects loss-preserving SHACL shape structure in its `1.0`/`1.2` interpretation modes. These modes normalize implemented Core terms and retain unknown or malformed assertions with diagnostics. They do not validate a data graph, produce SHACL validation reports, or evaluate SHACL-SPARQL, Rules or Node Expressions. Ontology domain/range semantics are not treated as closed-world JSON requiredness. Neither subpath performs RDFS/OWL reasoning.

See the repository architecture and testing guides for the current standards/version posture and release gates.
