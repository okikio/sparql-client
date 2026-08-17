# `@okikio/rdf` + `@okikio/sparql` architecture and implementation handoff

## Complete RDF, SPARQL, vocabulary generation, local query engines, persistent triplestore, and Kaiju Crawl semantic-data integration

**Status:** Canonical design and implementation handoff  
**Date:** 2026-08-14  
**Primary repository:** `okikio/sparql-client` / `@okikio/sparql`  
**Related libraries:** `@okikio/opfs`, Kaiju Platform, Kaiju Crawl, Wikitext parser work  
**Runtime posture:** Deno 2 first, strict TypeScript, ESM, explicit file extensions, same production source across Deno, Node.js, Bun, browsers, and workers where the capability is available  
**Compatibility posture:** Pre-launch architectural cleanup. Do not retain an obsolete public shape only because version `0.0.2` already exposes it.  
**Performance posture:** Correctness first, then evidence-led data-oriented optimization. Benchmarks are a release and architecture tool, not decorative microbenchmarks.

---

# Contents

- [1. Purpose](#1-purpose)
- [2. Source authority](#2-source-authority)
- [3. Executive decisions](#3-executive-decisions)
- [4. The package family](#4-the-package-family)
- [5. Public API and import style](#5-public-api-and-import-style)
- [6. `@okikio/rdf`: complete capability ownership](#6-okikiordf-complete-capability-ownership)
- [7. Parser architecture: event streams plus semantic output](#7-parser-architecture-event-streams-plus-semantic-output)
- [8. Data-oriented design for RDF parsing and datasets](#8-data-oriented-design-for-rdf-parsing-and-datasets)
- [9. `@okikio/sparql`: language, query model, protocol, and execution seams](#9-okikiosparql-language-query-model-protocol-and-execution-seams)
- [10. Query engine integration packages](#10-query-engine-integration-packages)
- [11. `@okikio/triplestore`: persistence and indexing](#11-okikiotriplestore-persistence-and-indexing)
- [12. `@okikio/vocab`: ontology compiler and generated vocabularies](#12-okikiovocab-ontology-compiler-and-generated-vocabularies)
- [13. Code generation dependency decision](#13-code-generation-dependency-decision)
- [14. Generated vocabulary manifest and provenance](#14-generated-vocabulary-manifest-and-provenance)
- [15. Kaiju Crawl integration](#15-kaiju-crawl-integration)
- [16. Security, limits, cancellation, and hostile input](#16-security-limits-cancellation-and-hostile-input)
- [17. Repository structure](#17-repository-structure)
- [18. Naming rules specific to this workspace](#18-naming-rules-specific-to-this-workspace)
- [19. TSDoc and comment standard](#19-tsdoc-and-comment-standard)
- [20. Test strategy](#20-test-strategy)
- [21. Benchmark strategy](#21-benchmark-strategy)
- [22. Stress testing](#22-stress-testing)
- [23. Documentation architecture](#23-documentation-architecture)
- [24. Current file action register](#24-current-file-action-register)
- [25. Implementation phases](#25-implementation-phases)
- [26. Validation and definition of done](#26-validation-and-definition-of-done)
- [27. Risks and open questions](#27-risks-and-open-questions)
- [28. Acceptance scenarios](#28-acceptance-scenarios)
- [29. External libraries and standards to keep studying](#29-external-libraries-and-standards-to-keep-studying)
- [30. Internal project sources reviewed](#30-internal-project-sources-reviewed)
- [31. Current upstream research findings carried into the design](#31-current-upstream-research-findings-carried-into-the-design)
- [32. Final architecture statement](#32-final-architecture-statement)

---

# 1. Purpose

This document turns the RDF/SPARQL design discussions into one implementation plan.

It has twelve jobs:

1. Define what `@okikio/rdf` owns as a complete RDF library.
2. Define what `@okikio/sparql` owns as a complete SPARQL language, protocol, and query abstraction.
3. Define `@okikio/vocab` as the vocabulary and ontology generation capability.
4. Define `@okikio/triplestore` as the persistent RDF dataset store that can use `@okikio/opfs` without being named after one storage backend.
5. Define `@okikio/oxigraph` and `@okikio/comunica` as explicit integration packages.
6. Replace the current endpoint-only executor model with result-mode-specific query contracts.
7. Apply the Wikitext event-stream lessons where they improve parser architecture without forcing an AST into every workload.
8. Apply data-oriented design to parser, dataset, index, and query hot paths while keeping public representations semantic and stable.
9. Replace the current starter Turtle-to-TypeScript script with a general ontology-to-vocabulary compiler that emits terms, TypeScript types, Standard Schema validators, and optional JSON Schema.
10. Define tests, differential conformance suites, stress tests, benchmarks, and benchmark artifacts that can actually decide architecture.
11. Define how Kaiju Crawl consumes the new semantic stack without losing raw evidence or turning every webpage into one global RDF database.
12. Define the documentation, naming, TSDoc, comments, file layout, migration, and release gates required before calling the work complete.

This is an implementation handoff, not a claim that the target architecture already exists.

---

# 2. Source authority

Use this order when sources disagree:

1. The latest explicit requirement in the current RDF/SPARQL discussion.
2. The latest `sparql-client` source and tests.
3. Explicit conventions established for the Okikio libraries in the current project discussions.
4. Kaiju Platform and Crawl programming-model, library-first, naming, formatting, TSDoc, documentation, testing, and benchmark guidance when the concept applies outside Kaiju.
5. Current standards and upstream primary documentation.
6. Current upstream source, issues, and pull requests for the libraries being integrated or studied.
7. Older handoffs, examples, and experimental code.

A source that describes current behavior does not automatically define the target architecture. This document labels important statements as one of:

- **Verified current**: observed in the supplied repository or current upstream source.
- **Target**: the architecture to implement.
- **Benchmark-gated**: a choice that must be decided with measured representative workloads.
- **Exploratory**: useful direction that should not become a compatibility promise yet.

The Kaiju library-first guide treats a reusable library as a programming model rather than a folder, requires import-safe selective capabilities, explicit ownership, bounded concurrency, and data shapes that match the real workload. The naming guide requires concrete concepts, short names when surrounding context preserves meaning, intentional public entry points, and namespace imports only when they improve call sites. Those rules are adopted here because they directly address the problems in the current `sparql-client` shape.

---

# 3. Executive decisions

The target architecture should converge on these decisions.

1. **Create a complete `@okikio/rdf`.** It is not a thin RDFJS compatibility layer. It owns the RDF data model, datasets, terms, parsing/serialization capability family, JSON-LD capability, canonicalization integration, ontology structures, shape infrastructure, and RDFJS interoperability.
2. **Keep the root `@okikio/rdf` import light.** Completeness belongs to the package family and explicit subpaths. Importing the root must not initialize JSON-LD processing, RDF/XML parsing, canonicalization, remote context loading, or query engines.
3. **Keep `@okikio/sparql` focused on SPARQL.** It owns values, expressions, patterns, query/update construction, parsing, serialization, protocol/result handling, and engine-neutral query contracts. It does not become a miscellaneous RDF package.
4. **Create `@okikio/vocab`.** It owns ontology interpretation and generated developer-facing vocabularies such as Schema.org, RDF, RDFS, OWL, XSD, SHACL, SKOS, ActivityStreams, and future custom vocabularies.
5. **Create `@okikio/triplestore`.** This replaces the working `rdf-opfs` naming idea. The package owns a persistent indexed RDF dataset. `@okikio/opfs` is an injected storage resource, not the package identity.
6. **Use explicit engine package names.** Use `@okikio/oxigraph` and `@okikio/comunica`, not `sparql-oxigraph`, `sparql-comunica`, or similar compound names.
7. **Do not force one engine choice.** Oxigraph and Comunica solve different workloads. The same SPARQL query contract should be usable with an HTTP endpoint, Oxigraph, Comunica, the persistent triplestore where supported, and future engines.
8. **Adopt RDFJS-compatible semantic contracts where they are the ecosystem interchange point.** Do not invent incompatible term and quad shapes merely to be different. Native implementations can still be optimized internally.
9. **Fix query result modes first.** SELECT returns bindings, CONSTRUCT/DESCRIBE return quads, ASK returns a boolean, and UPDATE returns no result payload. The current executor contract incorrectly groups SELECT, DESCRIBE, and CONSTRUCT as coerced rows.
10. **HTTP is one query adapter, not the execution architecture.** Endpoint, headers, fetch, media negotiation, timeout, and authentication stay in an HTTP/protocol capability.
11. **Prefer direct imports for types and schemas.** Generated APIs should support `import { Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'`.
12. **Do not build the generated vocabulary API around `lowercase.CamelCase`.** Avoid `schema.ProductSchema`, `rdf.ProductType`, and `vocab.schema.Product` as the primary developer experience.
13. **Use namespace imports for coherent operation families.** `import * as rdf from '@okikio/rdf'; rdf.namedNode(...)` and `import * as sparql from '@okikio/sparql'; sparql.select(...)` are good because the namespace supplies the domain context for short verbs/nouns.
14. **Treat namespace imports as an ergonomic tool, not a universal rule.** Schemas, generated types, vocabulary terms, and individually meaningful constants should normally use direct named imports so bundlers and readers see exactly what is used.
15. **Do not make a JavaScript/TypeScript AST the universal parser interchange.** Borrow Wikitext's event-stream model: tokenize into source-backed ranges, emit structured parser events, and materialize syntax trees only for callers that need random access or rewriting.
16. **Keep RDF semantic output distinct from syntax events.** RDF format parsers should progressively emit canonical quads. Optional syntax events are for diagnostics, tooling, formatting, or recovery. Quads remain the semantic interchange.
17. **Keep SPARQL syntax representation distinct from executable algebra.** Parsing can be event-first; execution still needs a semantic query/algebra representation or an engine-native plan.
18. **Apply data-oriented design to hot paths only after profiling.** Start with stable objects and source ranges. Use interning, packed IDs, struct-of-arrays, typed arrays, or pooled buffers only when representative profiles show allocation, GC, memory locality, serialization, or WASM crossing as material.
19. **Keep packed representations private.** Public terms, quads, bindings, diagnostics, vocabulary types, and query results retain semantic names and stable contracts.
20. **Build the vocabulary generator from RDF quads, not a Turtle-specific parser.** Any supported RDF serialization can therefore feed the same ontology compiler.
21. **Replace the current `scripts/ttl-to-ts.ts`.** The current script is a starter implementation with N3-specific parsing, regex prefix extraction, hand-written ontology interfaces, string-emitted source, a broad class registry, and a root `scripts/` location. None should become the long-term generator architecture.
22. **Use a language-neutral vocabulary IR.** The IR models classes, properties, datatypes, inheritance, domains, ranges, equivalent terms, labels, comments, deprecation, restrictions, lists, unions/intersections, shapes, and unknown assertions without hard-coding Schema.org.
23. **Preserve unknown ontology data.** Unsupported predicates must not cause data loss or make the generator incorrectly claim an ontology is invalid.
24. **Support multiple ontologies and imports deliberately.** Schema.org plus GS1, OWL foundations, custom extensions, or ActivityStreams extensions must be normal inputs rather than a workaround involving concatenated files.
25. **Support multi-typed JSON-LD entities from the beginning.** Do not repeat `schema-dts`' long-running difficulty where concrete multi-type objects need later leaf-type retrofits.
26. **Do not copy `schema-dts`' enormous recursive subtype unions without measurement.** TypeScript compiler time, memory, language-server behavior, declaration size, and consumer import cost are benchmark targets.
27. **Separate ontology typing from validation shapes.** RDFS/OWL is normally open-world vocabulary information. It does not imply that a missing property makes an object invalid. SHACL or an explicit profile can produce stricter validators.
28. **Generate Standard Schema directly.** The default generated runtime validator should satisfy Standard Schema without forcing Zod into every consumer. A Zod adapter/codegen lane can be added only if it has a concrete consumer and acceptable package cost.
29. **Generate JSON Schema only where the semantics can be represented honestly.** A Standard JSON Schema converter can expose input/output schemas for structural/profile validation. It must not imply closed-world RDF semantics where none exist.
30. **Use a small code-emission dependency, not the TypeScript compiler.** UnJS Knitwork is the preferred first dependency to evaluate for safe imports/exports, strings, keys, interfaces, and type objects. Oxc/Oxfmt can format and verify emitted source.
31. **Do not use the Oxc JavaScript AST as the ontology IR.** Oxc is a parser/formatter/validation tool for the emitted source, not the semantic vocabulary model.
32. **Treat persistence as a database problem.** `@okikio/opfs` gives files and storage adapters. It does not automatically provide sorted RDF indexes, joins, query planning, atomic index updates, or crash recovery.
33. **Benchmark triplestore storage strategies before committing to one durable on-disk index design.** Segment logs plus snapshots, a custom binary page/index format, an ordered-KV layer, and an external Level-style baseline should be compared with the same workload.
34. **Borrow injected resources by default.** `@okikio/triplestore` must not dispose an injected `FileSystemType` unless ownership is explicitly transferred.
35. **Expose cancellation through `AbortSignal` and cleanup through `Disposable`/`AsyncDisposable`.** Observables or event streams are not cancellation or ownership mechanisms.
36. **Use official conformance suites and differential oracles.** RDF/SPARQL parser correctness cannot be inferred from a few hand-written examples.
37. **Make benchmark correctness a hard prerequisite.** Every timed parser/query/store benchmark must prove semantic equivalence or a stable output digest before its timing is accepted.
38. **Measure cold and warm separately.** Parser initialization, WASM compilation/instantiation, context cache warm-up, index construction, module import, and steady-state operation are different costs.
39. **Measure memory as allocation, peak, and retained memory.** Repeat open/query/close and parse/cancel lifecycles until memory reaches a plateau or exposes a leak.
40. **Store raw benchmark samples.** Summary tables are not sufficient evidence for architecture decisions.
41. **Integrate Kaiju Crawl through a standards-semantic lane.** JSON-LD, Microdata, and RDFa normalize to RDF quads; semantic extraction can then query one model irrespective of source syntax.
42. **Keep pragmatic web metadata separate.** OpenGraph, Twitter Cards, ordinary HTML metadata, feeds, manifests, visible DOM, and vendor-specific heuristics remain a parallel evidence lane rather than being falsely described as RDF.
43. **Preserve raw evidence.** RDF normalization is an interpretation. Kaiju must retain the original script/DOM/source references and map derived quads/facts back to evidence.
44. **Do not create a global in-memory graph for Kaiju's full corpus.** Per-page or per-domain transient graphs are the default. Persistent/domain graphs need a concrete query or product use case.
45. **Use named graphs for provenance where graph aggregation is useful.** A named graph can identify a capture/page/route while the raw capture remains the evidence authority.
46. **Keep documentation focused by question.** Use several small ASCII architecture, parser, persistence, query, and Kaiju-integration diagrams instead of one master diagram.
47. **Document important internal symbols.** Parser state machines, token-kind tables, range normalizers, index encodings, segment commit rules, query-lowering invariants, and benchmark fixture builders can be more important than exported wrappers.
48. **No completion claim without validation.** Formatting, linting, strict type checks, tests, cross-runtime checks, benchmarks, builds, clean consumer tests, import-safety checks, output validation, and documentation must match the changed surface.

---

# 4. The package family

The target package family is:

```text
@okikio/rdf
@okikio/sparql
@okikio/vocab
@okikio/triplestore
@okikio/oxigraph
@okikio/comunica
```

These names follow one rule: **the package name describes the capability or technology the consumer intentionally selected.**

## 4.1 Why `@okikio/triplestore`

The storage package needs a name that remains true if its bytes live in browser OPFS, Node, Deno, Bun, memory, RxDB-backed files, a SQL-backed OPFS adapter, or another future `@okikio/opfs` backend.

| Candidate | Strength | Problem | Decision |
|---|---|---|---|
| `@okikio/rdf-opfs` | immediately says RDF + OPFS | encodes one backend into the package identity; becomes false on Node/Deno/Bun/DB adapters | reject |
| `@okikio/rdf-store` | recognizable | repeats `rdf`, less consistent with the explicit package family, ambiguous between in-memory dataset and database | reject |
| `@okikio/store` | short | too vague outside local context | reject |
| `@okikio/dataset` | RDF-domain term | sounds like an in-memory collection and does not communicate persistence/indexing | reject |
| `@okikio/triplestore` | standard RDF-domain concept; says persistent/queryable graph store | conventional name says triples even though RDF datasets contain quads | **use** |

The package documentation must state that it stores RDF datasets and therefore supports named graphs/quads. “Triplestore” is the conventional product category, not a restriction to three-term records.

## 4.2 Dependency direction

The intended one-way graph is:

```text
                         @okikio/oxigraph
                        /                \
                       v                  v
              @okikio/sparql -------> @okikio/rdf
                       ^                  ^
                       |                  |
                       |                  +--------- @okikio/vocab
                       |                  |
                       |                  +--------- @okikio/triplestore
                       |                              |
                       |                              v
                       |                       @okikio/opfs
                       |
                         @okikio/comunica
```

More exactly:

- `@okikio/rdf` has no dependency on SPARQL, engines, or persistence.
- `@okikio/sparql` can depend on the stable RDF term contract so query values and results keep RDF semantics.
- `@okikio/vocab` depends on RDF terms/quads and the generic ontology model. It does not need a SPARQL engine to generate source.
- `@okikio/triplestore` depends on RDF data-model contracts and `@okikio/opfs` for durable file semantics.
- `@okikio/oxigraph` depends on the Oxigraph package/WASM plus RDF/SPARQL contracts.
- `@okikio/comunica` depends on the selected Comunica query package(s) plus RDF/SPARQL contracts.
- `@okikio/sparql` never imports either engine package.

This direction makes future engines additive rather than requiring changes to the query-builder package.

---

# 5. Public API and import style

The API needs two different import styles because the use cases are different.

## 5.1 Namespace imports for operation families

Use namespace imports when the module is a coherent family of short operations:

```ts
import * as rdf from '@okikio/rdf';
import * as sparql from '@okikio/sparql';

const product = rdf.namedNode('https://example.com/products/1');
const label = rdf.literal('Widget', 'en');

const query = sparql.select(['?product', '?name'])
  .where(sparql.triple('?product', '?predicate', '?name'));
```

The namespace supplies the missing context. `rdf.literal()` and `sparql.select()` are clearer than long direct names such as `createRdfLiteral()` or `createSparqlSelectQuery()`.

## 5.2 Direct imports for generated terms, schemas, and types

Generated vocabulary values should be directly importable:

```ts
import {
  Product,
  ProductSchema,
  name,
  offers,
  price,
  type ProductType,
} from '@okikio/vocab/schema';
```

This is the preferred vocabulary style.

Avoid making this the normal form:

```ts
import * as schema from '@okikio/vocab/schema';

schema.Product;
schema.ProductSchema;
```

The latter creates the `lowercase.CamelCase` appearance that the project deliberately avoids and makes the imported surface less explicit.

Namespace imports can still be valid for deliberate operation modules, for example:

```ts
import * as vocab from '@okikio/vocab/generate';

const model = await vocab.read(sources);
const output = vocab.emit(model, options);
```

## 5.3 Runtime class terms and generated types

A generated class should normally expose:

```ts
Product        // RDF NamedNode term for https://schema.org/Product
ProductType    // TypeScript JSON-LD / vocabulary data type
ProductSchema  // Standard Schema-compatible runtime validator
```

A generated property should normally expose the source property name as an RDF NamedNode term:

```ts
name
offers
price
priceCurrency
```

This makes RDF construction direct:

```ts
import * as rdf from '@okikio/rdf';
import { Product, name } from '@okikio/vocab/schema';

const quad = rdf.quad(
  rdf.namedNode('https://example.com/product/1'),
  name,
  rdf.literal('Widget'),
);
```

The type/schema form remains equally direct:

```ts
import { ProductSchema, type ProductType } from '@okikio/vocab/schema';

const product: ProductType = {
  '@type': 'Product',
  name: 'Widget',
};

const result = await ProductSchema['~standard'].validate(product);
```

## 5.4 Collision policy

Vocabulary names can collide with:

- JavaScript keywords;
- TypeScript contextual keywords;
- another term with the same local name;
- a class/property with the same local name;
- generated suffix names such as `ProductType` or `ProductSchema`;
- built-in package exports.

The generator must use one deterministic policy and emit a collision manifest.

Target policy:

1. Preserve the vocabulary's preferred compact name when it is a valid unique JavaScript identifier.
2. Preserve case from the canonical vocabulary label/local name unless the vocabulary has an explicit preferred term mapping.
3. Class terms normally remain PascalCase because vocabularies such as Schema.org use PascalCase class names.
4. Property terms normally retain the vocabulary's camelCase property names.
5. Type and schema symbols append `Type` and `Schema` to the resolved class name.
6. If a name is a reserved word or collides, use a deterministic qualified alias derived from the configured prefix or vocabulary name.
7. Record both source IRI and generated identifier in a machine-readable manifest.
8. Never silently choose a different alias based on generation order.

Examples must be generated from real collision fixtures before the policy becomes stable.

## 5.5 Barrel exports and tree shaking

A root vocabulary module can provide the convenient direct imports above, but the generator must also consider compiler and bundler cost.

Two layers should be supported:

```text
@okikio/vocab/schema
  convenient named exports

@okikio/vocab/schema/product
  granular Product + ProductType + ProductSchema entry point
```

The granular form is **benchmark-gated**. It should be generated if root-barrel TypeScript memory or language-server cost becomes material.

Named ESM exports remain tree-shakable at runtime when:

- every module is import-safe;
- generated term constants are pure;
- schema initialization is local and does not register globally;
- the build preserves ESM;
- package metadata describes side effects truthfully;
- the root barrel does not eagerly run generators, load contexts, build indexes, or initialize engines.

---

# 6. `@okikio/rdf`: complete capability ownership

`@okikio/rdf` should become the foundation for all RDF-aware packages in the family.

“Complete” does not mean that one root module eagerly contains every parser and algorithm. It means a caller can stay inside the `@okikio/rdf` package family for the complete RDF programming model while heavy or specialized parts remain on explicit subpaths.

## 6.1 Core RDF model

The core should own or implement RDFJS-compatible forms of:

```text
NamedNode
BlankNode
Literal
Variable
DefaultGraph
Quad
Dataset
DataFactory
Source
Sink
Store
```

The design should account for RDF 1.2 triple terms rather than assuming the RDF 1.1 term set is frozen forever.

Project-owned schema-bearing records use the normal project naming convention:

```ts
TermSchema
TermType
QuadSchema
QuadType
DatasetOptionsSchema
DatasetOptionsType
```

Behavior types do not need the `Type` suffix when the name itself is the behavior abstraction:

```ts
class Dataset {}
interface Source {}
interface Sink {}
```

## 6.2 Core operations

The root namespace should be small enough to read naturally:

```ts
import * as rdf from '@okikio/rdf';

rdf.namedNode(...);
rdf.blankNode(...);
rdf.literal(...);
rdf.variable(...);
rdf.defaultGraph();
rdf.quad(...);
rdf.dataset(...);
rdf.equals(a, b);
```

Do not prefix these with `rdf` inside their own source names. The namespace already supplies the concept.

## 6.3 Dataset operations

The dataset capability needs:

- exact quad membership;
- pattern matching by subject/predicate/object/graph;
- add/delete;
- bulk import;
- clear/replace where justified;
- size/count;
- iteration;
- streaming/async import for large sources;
- set operations only when semantics and memory behavior are clear;
- deterministic equality utilities;
- optional estimate/count interfaces that query engines can use without forcing an expensive second scan.

A simple public dataset can use stable objects and Maps initially. Internal indexes should be selected from measured query patterns.

## 6.4 Terms, literals, and datatypes

Literal handling must preserve:

- lexical form;
- datatype IRI;
- language tag;
- language direction where the active RDF/JSON-LD version supports it.

Do not repeat the current executor behavior where RDF terms are casually flattened to JavaScript strings/numbers/Dates at the query boundary. Ergonomic coercion can be opt-in, but the canonical result must preserve the RDF value.

Useful explicit conversions can live behind operations such as:

```ts
rdf.toValue(literal, options);
rdf.fromValue(value, options);
```

These operations must document precision loss, timezone behavior, numeric range, and unsupported datatypes.

## 6.5 Namespaces and prefixes

The namespace capability should be generated or data-driven instead of maintaining a single 45 KB hand-authored `namespaces.ts` indefinitely.

A namespace operation can be:

```ts
const schema = rdf.namespace('https://schema.org/');
const Product = schema('Product');
```

Generated curated vocabularies belong in `@okikio/vocab`, not in a giant RDF root constants file.

## 6.6 Parsing and serialization capability family

The package should support, directly or through explicit internal strategic dependencies:

```text
N-Triples
N-Quads
Turtle
TriG
RDF/XML
JSON-LD
RDFa
```

Microdata is not an RDF serialization. It can still be exposed as a semantic extraction adapter because the web workload needs Microdata-to-RDF normalization, but the docs must classify it correctly.

A possible subpath map is:

```text
@okikio/rdf/ntriples
@okikio/rdf/nquads
@okikio/rdf/turtle
@okikio/rdf/trig
@okikio/rdf/xml
@okikio/rdf/jsonld
@okikio/rdf/rdfa
@okikio/rdf/microdata
@okikio/rdf/canon
@okikio/rdf/ontology
@okikio/rdf/shape
@okikio/rdf/rdfjs
```

Do not settle the exact public spellings until the source layout and package export map are reviewed together.

## 6.7 JSON-LD

`@okikio/rdf/jsonld` should be a full JSON-LD capability, not only a parser that happens to return quads.

Target operations include:

```text
expand
compact
flatten
frame
toRdf
fromRdf
parse
serialize
resolveContext
```

The implementation can initially use the proven Digital Bazaar and Rubensworks components rather than reimplementing the complete JSON-LD algorithms merely for dependency purity.

The package still owns the public contract, resource limits, context-loader policy, cancellation, cache interface, diagnostics, and tests.

### Context resolution

Remote contexts are a first-class subsystem.

The implementation should provide:

- per-operation context cache;
- optional shared cache supplied by the caller;
- in-flight request deduplication;
- cycle detection;
- maximum context URL count;
- maximum response bytes;
- request timeout;
- redirect limits;
- caller-supplied document loader/fetch;
- SSRF policy suitable for server crawlers;
- known-context preloading where it is useful and versioned;
- raw context provenance for diagnostics.

Kaiju Crawl should supply a crawl-aware document loader rather than letting JSON-LD code fetch arbitrary URLs through ambient global `fetch`.

## 6.8 Canonicalization

`@okikio/rdf/canon` should expose RDFC-1.0 dataset canonicalization through a focused API.

Canonicalization is not a normal ingestion stage. Use it for:

- stable graph hashing;
- semantic deduplication where blank-node identity matters;
- integrity/signature work;
- content-addressed graph artifacts;
- explicit equivalence workflows.

Do not canonicalize every webpage merely because the algorithm exists. The algorithm must expose cancellation/resource budgets because adversarial blank-node graphs can be expensive.

## 6.9 Ontology and shapes

`@okikio/rdf/ontology` owns generic interpretation helpers for RDF Schema and OWL structures.

`@okikio/rdf/shape` owns shape/constraint infrastructure such as SHACL-facing data and validation primitives.

The distinction is semantic:

```text
ontology
  describes vocabulary meaning, inheritance, domain/range, equivalence

shape/profile
  describes validation expectations for one use case
```

Do not make `rdfs:domain` mean “this JSON key is required.”

---

# 7. Parser architecture: event streams plus semantic output

The Wikitext parser work provides the most useful parser architecture lesson for this project:

```text
source
  -> scanner/token stream
  -> structured events
  -> optional materialization
```

The crucial insight is not “all parsers need an event API.” It is:

> Do not allocate a permanent tree when the next consumer only needs a stream of semantic records or diagnostics.

## 7.1 Two different parser families

RDF syntax parsing and SPARQL syntax parsing have different final outputs.

### RDF format parser

```text
bytes / text
     |
     v
source-backed scanner
     |
     v
format parser state
     |
     +---- optional syntax/diagnostic events
     |
     v
RDF semantic term/quad emission
     |
     +---- Dataset consumer
     +---- triplestore import
     +---- serializer/converter
     +---- Kaiju semantic extractor
```

The quad is already the semantic record. A generic RDF AST is not required for normal ingestion.

### SPARQL parser

```text
query text
    |
    v
source-backed tokens
    |
    v
syntax events
    |
    +---- diagnostics / formatter / syntax tooling
    |
    +---- optional syntax model materialization
    |                |
    |                v
    |             serializer
    |
    v
semantic lowering
    |
    v
query algebra / engine input
```

A syntax tree can still exist. It is an optional materialization, not the only way information can leave the parser.

## 7.2 Source ranges first

Parser internals should retain offsets into the original source for as long as practical.

For string input:

```ts
export interface RangeType {
  readonly start: number;
  readonly end: number;
}
```

Document whether offsets are UTF-16 code units, UTF-8 bytes, or both. Do not let different parser paths silently use different units.

For byte-stream RDF formats, use byte offsets at the scanner layer and only create decoded strings when a semantic term requires them. For SPARQL string parsing, UTF-16 offsets align with JavaScript string slicing and editor/LSP integrations.

If both are needed, keep the second mapping opt-in rather than computing it for every token.

## 7.3 Internal token representation

Start with stable small records:

```ts
interface TokenType {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
}
```

The hot loop should not allocate a substring for every punctuation token, keyword, or IRI delimiter.

A token value can be decoded lazily from the source span.

If profiling later shows object allocation is material at million-record scale, benchmark a packed representation such as:

```text
kinds:  Uint16Array
starts: Uint32Array
ends:   Uint32Array
```

Do not expose that representation publicly and do not adopt it only because it looks data-oriented.

## 7.4 Event invariants

If SPARQL syntax events become public or semi-public, enforce these invariants from the beginning:

1. **Well-formed nesting.** Every structural `enter` has a matching `exit`.
2. **Determinism.** Same source + same parser mode produces the same events and diagnostics.
3. **Stable ranges.** Events point at the original input; later materialization does not change source anchors.
4. **No hidden tree requirement.** A caller can validate/inspect/query the stream without materializing all syntax nodes.
5. **Bounded parser state.** Stream input cannot cause unbounded retained chunks merely because a later token may refer backward.
6. **Explicit recovery.** Recovery events/diagnostics say what was observed and what policy was applied.
7. **Early return cleanup.** Stopping an async iterator releases or cancels owned input resources where possible.

## 7.5 `analyze()` and materialization

SPARQL queries are normally small enough that a findings-first lane can be useful:

```ts
export interface ParseFindingsType {
  readonly source: string;
  readonly events: readonly SyntaxEventType[];
  readonly diagnostics: readonly DiagnosticType[];
}

export function analyze(source: string, options?: AnalyzeOptionsType): ParseFindingsType;
export function materialize(findings: ParseFindingsType): QuerySyntaxType;
```

This is **exploratory public API** until real tooling uses it.

Do not copy this exact shape into huge RDF document parsing. Buffering every event/quad for a multi-gigabyte RDF source defeats the streaming architecture. Large RDF formats should expose streaming parse plus separately collected bounded diagnostics.

## 7.6 Strict and tolerant parsing

Standards parsers need a clear policy.

Do not use one vague `lenient: true` switch for unrelated behavior.

Define parser profiles or options for:

- standards-strict syntax;
- explicitly supported web-recovery behavior;
- unknown extension acceptance;
- invalid value handling;
- maximum nesting/depth;
- maximum token/literal length;
- maximum prefix/context count;
- diagnostic collection.

Every non-standard recovery path needs a differential fixture and documentation.

---

# 8. Data-oriented design for RDF parsing and datasets

Performance work begins with the transformation graph, not with typed arrays.

For each parser/store path, record:

```text
input cardinality and bytes
fields read together
allocations
copies
string decoding
term interning
index probes
batch size
queue depth
lifetime
persistence point
cancellation point
```

## 8.1 N-Triples/N-Quads hot path

These formats are ideal first targets for a highly optimized native parser because their syntax is line-oriented and their semantic output is already quads.

Potential hot path:

```text
ReadableStream<Uint8Array>
    |
    v
incremental UTF-8 scanner
    |
    v
subject/predicate/object/graph ranges
    |
    v
term decoder + optional interner
    |
    v
quad batch
    |
    v
consumer
```

Measure separately:

- UTF-8 decode cost;
- escape decoding;
- IRI validation;
- literal datatype/language creation;
- object allocation;
- repeated-term hashing;
- consumer/backpressure cost.

A term interner may reduce repeated allocation for vocab-heavy datasets, but it can also retain the full vocabulary forever. Define its lifetime and maximum size.

## 8.2 Turtle/TriG

Turtle adds prefix/base state, blank-node property lists, collections, and shorthand.

The parser should keep:

- a bounded prefix map;
- base IRI state;
- a small nesting stack;
- blank-node identity state;
- list construction state;
- source ranges for diagnostics.

Do not create syntax-node objects for every `;`, `,`, or `[]` if the consumer only wants quads.

## 8.3 Batch emission

Single-quad callbacks minimize latency but can increase dispatch and engine-crossing overhead.

Support an internal or explicit batch policy:

```ts
export const BatchPolicySchema = z.object({
  maxRecords: z.number().int().positive(),
  maxBytes: z.number().int().positive(),
  maxDelayMs: z.number().nonnegative(),
});

export type BatchPolicyType = z.output<typeof BatchPolicySchema>;
```

For a pure synchronous string parser, `maxDelayMs` may not apply. Do not force one batch policy onto every input model.

Benchmarks must measure:

- time to first quad;
- total throughput;
- p95 batch latency;
- allocation rate;
- peak/retained memory;
- cancellation waste;
- slow-consumer backpressure.

## 8.4 Public objects, internal IDs

Public:

```ts
for await (const quad of parse(source)) {
  console.log(quad.subject.value);
}
```

Possible internal store representation after benchmarks:

```text
term dictionary
  1 -> https://schema.org/Product
  2 -> https://schema.org/name
  3 -> Widget

quad columns
  subject:   Uint32Array
  predicate: Uint32Array
  object:    Uint32Array
  graph:     Uint32Array
```

This can be excellent for index construction, transfer to WASM, or compact persistence. It is not an excuse to make consumers work with integer IDs.

## 8.5 Index ownership

Every index must answer:

- which query patterns justify it;
- build cost;
- memory cost;
- persisted size;
- update cost;
- who owns it;
- whether it is shared;
- how it is invalidated;
- how it is disposed;
- whether its statistics are trustworthy for query planning.

Do not automatically build all subject/predicate/object/graph permutations. Quadstore is a useful baseline because it makes those permutations explicit and exposes the cost/coverage trade-off.


---

# 9. `@okikio/sparql`: language, query model, protocol, and execution seams

The current package already has a substantial query-builder surface. The target should preserve the strongest usability ideas while separating syntax construction from endpoint transport and result parsing.

## 9.1 Verified current state

The supplied `0.0.2` repository currently has a flat root with:

```text
builder.ts
executor.ts
namespaces.ts
sparql.ts
update.ts
utils.ts
patterns/
docs/
examples/
scripts/ttl-to-ts.ts
```

`mod.ts` broadly re-exports the value/expression layer, utilities, all pattern styles, builder, update, executor, and namespace constants.

The current executor is HTTP-endpoint-centric:

```ts
interface ExecutionConfig {
  endpoint: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  timeoutMs?: number;
}
```

The high-level `Executor` currently exposes:

```text
execute
query
ask
update
resolveLabels
fetchProperties
expand
```

The most important correctness defect is that its `query` documentation and implementation treat SELECT, DESCRIBE, and CONSTRUCT as one binding-row path. CONSTRUCT and DESCRIBE are graph results and must preserve quads/RDF media types.

The supplied repository also has a material validation gap:

- no `*_test.ts`, `*.test.ts`, `*_bench.ts`, or `*.bench.ts` files are present;
- `deno.jsonc` still defines `test` and `bench` tasks;
- the `check` task runs `deno check src/**/*.ts`, but the package source is flat and there is no `src/` tree;
- the current `./generate` export points directly at the starter file under root `scripts/`.

These are verified baseline issues. The new workspace must not report test, benchmark, or strict-check coverage until the actual source entry points and suites run.

This is an architectural migration item, not a documentation-only fix.

## 9.2 Target query interface

Use result-mode-specific operations:

```ts
export interface Queryable {
  queryBindings(
    query: QueryInputType,
    options?: QueryOptionsType,
  ): Promise<AsyncIterable<BindingType>>;

  queryQuads(
    query: QueryInputType,
    options?: QueryOptionsType,
  ): Promise<AsyncIterable<QuadType>>;

  queryBoolean(
    query: QueryInputType,
    options?: QueryOptionsType,
  ): Promise<boolean>;

  queryVoid(
    query: QueryInputType,
    options?: QueryOptionsType,
  ): Promise<void>;
}
```

The exact interface should remain close enough to RDFJS Query semantics that adapters are simple. The native cross-runtime surface should prefer async iteration or Web Streams rather than Node-only stream contracts.

If a concrete engine already exposes RDFJS query streams, the adapter should preserve them efficiently rather than eagerly collecting arrays.

## 9.3 Bindings retain RDF terms

A binding is not `Record<string, unknown>` after automatic coercion.

Canonical shape:

```ts
export type BindingType = ReadonlyMap<string, rdf.TermType>;
```

or another measured immutable lookup shape with equivalent semantics.

Ergonomic projection is a separate operation:

```ts
const rows = sparql.mapBindings(bindings, {
  name: rdf.toString,
  price: rdf.toNumber,
});
```

The package must not lose:

- literal datatype;
- language;
- direction;
- blank-node identity;
- graph provenance;
- numeric precision;
- invalid lexical-form information.

## 9.4 HTTP protocol adapter

Move endpoint behavior behind a focused protocol capability.

Possible subpath:

```text
@okikio/sparql/http
```

Target responsibilities:

- SPARQL Query/Update HTTP transport;
- GET/POST policy where supported;
- content negotiation;
- SPARQL Results JSON/XML parsing;
- RDF result media parsing for CONSTRUCT/DESCRIBE;
- authentication/header injection;
- fetch injection;
- timeout/cancellation;
- response-size limits;
- status/error normalization;
- endpoint capability metadata;
- safe bounded query previews for diagnostics.

Do not make the root package read global environment variables or configure credentials.

## 9.5 Builder values should accept RDF terms

SPARQL values should accept `@okikio/rdf` terms directly:

```ts
import * as rdf from '@okikio/rdf';
import * as sparql from '@okikio/sparql';
import { Product, name } from '@okikio/vocab/schema';

const product = sparql.v('product');
const value = rdf.literal('Widget');

const query = sparql.select([product])
  .where(sparql.triple(product, rdf.type, Product))
  .where(sparql.triple(product, name, value));
```

The exact export for the standard RDF `type` term should be decided with the vocabulary naming/collision rules rather than adding a one-off alias to this example.

## 9.6 Build structured query values before strings

The current fluent API can remain, but query clauses should produce a structured query representation until serialization.

Do not concatenate a complete query string after every builder call.

Target:

```text
builder operations
     |
     v
query model
     |
     +---- serializer -> SPARQL text
     |
     +---- engine adapter if it can consume model/algebra directly
     |
     +---- analysis/inspection
```

This representation does not need to be branded as the parser AST. It is the builder's semantic syntax model.

## 9.7 Syntax events, syntax model, and algebra

Keep three layers distinct:

```text
syntax events
  source-oriented parsing facts and ranges

syntax model
  materialized query syntax suitable for round-trip printing/editing

algebra
  executable semantic operations such as BGP, join, filter, project, group
```

A formatter wants syntax ranges/comments.

A query engine wants algebra.

A builder can often construct syntax/model values directly without tokenizing text first.

Do not force every consumer through all three representations.

## 9.8 SPARQL 1.1, 1.2, and extensions

The architecture must assume the language will continue to change.

Every parsed/built query should carry explicit language/version context where it affects semantics.

A capability record can describe engine/parser support:

```ts
export const CapabilitiesSchema = z.object({
  queryVersion: z.string(),
  updateVersion: z.string().optional(),
  federation: z.boolean(),
  rdfStar: z.boolean(),
  update: z.boolean(),
  service: z.boolean(),
  extensions: z.array(z.string()),
});

export type CapabilitiesType = z.output<typeof CapabilitiesSchema>;
```

Do not infer complete support from the package name.

Keep a deliberate trusted escape hatch:

```ts
sparql.raw(...)
```

`raw()` must remain visibly unsafe for untrusted values. It is how callers can use new engine syntax before the fluent builder has first-class support, not a replacement for normal term serialization.

## 9.9 Label/property enrichment does not belong in the core executor

Current `resolveLabels`, `fetchProperties`, and `expand` are useful application helpers but should not define the engine abstraction.

Move them into a focused query/enrichment helper layer after reviewing their callers.

For example:

```text
@okikio/sparql/resource
  get labels/properties/descriptions with caller-selected predicates
```

or keep them as composable examples if they are too application-specific.

Do not make every engine adapter implement label resolution merely to satisfy an oversized `Executor` interface.

---

# 10. Query engine integration packages

## 10.1 `@okikio/oxigraph`

The package should make Oxigraph feel native to the Okikio RDF/SPARQL model without hiding Oxigraph's actual semantics.

Target operations might include:

```ts
import * as oxigraph from '@okikio/oxigraph';

await using store = await oxigraph.open();
await store.load(source, options);

const rows = await store.queryBindings(query);
```

The actual operation names should be chosen after inspecting the final Oxigraph wrapper contract.

Responsibilities:

- WASM/native package initialization;
- RDF term conversion with minimum crossing/allocation cost;
- query/update result adaptation;
- bulk load paths;
- parser/load format mapping;
- cancellation where upstream supports it;
- capability reporting;
- import safety;
- memory/lifecycle documentation;
- browser/Deno/Node/Bun smoke tests where the upstream package supports them.

### Important persistence rule

The current documented JavaScript Oxigraph store is an in-memory store. Do not present it as an OPFS database.

If `@okikio/triplestore` writes N-Quads/snapshots and Oxigraph loads them at startup, document the cost as **rebuild/reload**, not “open persistent Oxigraph.”

Benchmark direct `Store.load(JSON-LD)` against JavaScript JSON-LD parsing followed by thousands of quad crossings. The faster path is not obvious until remote-context semantics, WASM crossing, and allocation are included.

## 10.2 `@okikio/comunica`

Comunica is valuable because it can query RDFJS sources, datasets, remote endpoints, and federated combinations.

Responsibilities:

- construct/configure the selected smaller query engine package where possible;
- adapt `@okikio/rdf` Source/Dataset contracts to RDFJS without copies where possible;
- provide source statistics such as `countQuads()` estimates when available;
- preserve streaming results;
- expose federation and source capabilities;
- keep network source policy caller-owned;
- report actual engine capability/version.

Do not make the wrapper pretend that every source supports update or that every dataset has the same query-planning cost.

## 10.3 Engine-neutral consumer code

A caller should be able to depend on the query contract:

```ts
async function getProducts(queryable: sparql.Queryable) {
  const query = createProductQuery();
  return queryable.queryBindings(query);
}
```

The composition root selects:

```text
HTTP endpoint
Oxigraph
Comunica
future native engine
```

This is where abstraction is useful because the result-mode contract preserves the actual semantics instead of flattening the engine to `execute(string): unknown`.

---

# 11. `@okikio/triplestore`: persistence and indexing

The persistent store is the most benchmark-sensitive package in the design.

## 11.1 Public contract

The public store should feel like a persistent RDF Dataset/Source/Store:

```ts
import * as store from '@okikio/triplestore';

await using db = await store.open(fileSystem, {
  path: '/knowledge',
});

await db.add(quad);
for await (const result of db.match(subject, predicate, null, graph)) {
  // ...
}
```

The caller supplies `FileSystemType` from `@okikio/opfs`.

Borrowed resource rule:

```text
caller owns FileSystemType
         |
         +---- triplestore borrows it
         |        |
         |        +---- store closes
         |        +---- filesystem stays open
         |
         +---- caller disposes filesystem
```

An explicit option can transfer ownership when required.

## 11.2 Storage is not just serialized N-Quads

A production persistent store must address:

- term dictionary;
- quad/index representation;
- ordered range lookup;
- index selection;
- statistics;
- commit protocol;
- crash recovery;
- checksums/versioning;
- compaction;
- deletes/tombstones;
- concurrent readers;
- one or more writer rules;
- cancellation;
- corruption detection;
- migration/format versioning;
- bounded caches;
- cold open time.

`@okikio/opfs` gives the durable file primitives and cross-runtime adapters. It intentionally does not invent database semantics above those primitives.

## 11.3 Storage alternatives to benchmark

### Option A: append-only quad segments + snapshots

```text
/store/
  manifest.json
  segments/
    000001.rqseg
    000002.rqseg
  indexes/
    000001.idx
  snapshots/
    ...
```

Strengths:

- simplest crash-safe write story;
- sequential I/O;
- easy immutable readers;
- good fit for append-heavy Crawl imports;
- can add compaction later.

Costs:

- cold index build if indexes are not persisted;
- delete/tombstone complexity;
- compaction required for long-lived mutable stores;
- format becomes our responsibility.

### Option B: custom binary pages/B-tree or LSM-like indexes over `FileSystemType`

Strengths:

- maximum control over browser worker sync access, pages, caching, compression, and persistent statistics;
- can optimize directly for RDF term/index workloads.

Costs:

- much larger database-engine project;
- difficult crash consistency;
- extensive corruption/recovery testing;
- easy to overengineer before workload evidence exists.

### Option C: ordered KV / AbstractLevel-compatible layer

Strengths:

- can reuse Quadstore-like index architecture and range semantics;
- provides a strong external baseline.

Costs:

- OPFS is not itself an ordered KV store;
- implementing `AbstractLevel` well is a storage-engine project;
- naive one-file-per-key designs are unacceptable for range scans and filesystem metadata overhead.

### Option D: BrowserLevel/IndexedDB + Quadstore baseline

Strengths:

- mature browser persistence path;
- establishes whether a custom OPFS engine is actually necessary;
- existing RDFJS/Comunica integration.

Costs:

- IndexedDB performance/transaction model;
- less direct control over file layout and synchronous OPFS worker APIs;
- dependency stack.

### Decision

Implement enough of Option A to establish a correct persistent baseline **only if** the first benchmark phase shows the package is needed immediately.

Before investing in a custom page/index engine, benchmark Option A, Quadstore/BrowserLevel, and representative in-memory reload strategies against the real product workload.

## 11.4 Index patterns

Baseline query pattern families:

```text
S P O G    exact/subject scan
P O G S    predicate/object lookup
O G S P    reverse object lookup
G S P O    named-graph + subject
G P O S    named-graph + predicate
O S P G    object + subject
```

Do not blindly copy exactly six indexes because Quadstore uses them.

For each candidate index, benchmark:

- build time;
- persistent bytes;
- RAM cache;
- point lookup;
- range scan;
- insert amplification;
- delete amplification;
- compaction cost;
- query-planner benefit.

A Crawl append-mostly domain graph may justify a different set from an interactive mutable knowledge base.

## 11.5 Persistent format version

Every persistent database needs a versioned manifest.

Example concept:

```ts
export const ManifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  dictionary: z.object({ version: z.number().int().positive() }),
  indexes: z.array(z.string()),
  segments: z.array(z.string()),
});

export type ManifestType = z.output<typeof ManifestSchema>;
```

The final fields should be derived from the actual storage design.

A newer library must not silently interpret an incompatible old index format.

## 11.6 Commit protocol

Document and test the exact durability order.

A segment-style commit may be:

```text
1. write new segment to temporary path
2. flush segment
3. write/flush index artifact if part of same commit
4. write new manifest to temporary path
5. flush manifest
6. atomically replace manifest where backend supports it
7. expose new generation to readers
8. remove obsolete artifacts only after new generation is authoritative
```

When the adapter cannot provide atomic rename, the store must document and compensate for the weaker guarantee rather than pretending all backends are POSIX filesystems.

## 11.7 Browser worker optimization

Browser OPFS synchronous access handles are potentially important for database-like random access, but they are capability-gated and worker-oriented.

A future high-performance browser store can run its storage core in a DedicatedWorker while exposing async operations to the page.

Do not make the root API synchronous merely because one browser backend can be synchronous inside a worker.

---

# 12. `@okikio/vocab`: ontology compiler and generated vocabularies

This package is where the `schema-dts` lessons should become a more general system.

## 12.1 What `schema-dts` gets right

Useful patterns to retain:

- generate types from ontology data rather than hand-maintaining Schema.org declarations;
- distinguish classes, properties, enums/datatypes, and helper types;
- retain comments/deprecation metadata;
- generate context-aware names;
- support graphs and IDs;
- recently export concrete leaf types to support multi-typed entities;
- recently separate schema-independent helper types from ontology-specific generated output.

## 12.2 What not to copy

Do not repeat these limitations:

- ontology input restricted to a Schema.org-like N-Triples shape;
- a parser that fails on richer valid RDF/OWL constructs because the generator owns parsing itself;
- one ontology input only;
- assumptions that every useful IRI has a convenient local suffix;
- giant recursive TypeScript unions without compiler-performance budgets;
- runtime/package dependency choices that make a type-only package expensive to install or bundle;
- hidden internal base/leaf types that consumers later need for composition;
- late multi-type support;
- confusing extension-property behavior caused by treating an open vocabulary like a closed JSON object schema;
- no general runtime unmarshal/validation story.

## 12.3 Generator pipeline

Target:

```text
RDF source(s)
    |
    v
@okikio/rdf parsers
    |
    v
AsyncIterable<QuadType>
    |
    v
ontology reader/index
    |
    v
VocabularyModelType
    |
    +---- naming/collision plan
    +---- inheritance closure
    +---- property domain/range model
    +---- datatype model
    +---- shape/profile model
    +---- diagnostics
    |
    v
emitters
    |
    +---- RDF term modules
    +---- TypeScript types
    +---- Standard Schema validators
    +---- JSON Schema/profile artifacts
    +---- manifest/source map
    +---- Markdown/API metadata
```

The generator never needs to know whether the source was Turtle, JSON-LD, RDF/XML, N-Triples, or TriG after quads are produced.

## 12.4 Vocabulary IR

Use project-owned schemas for the generator's stable serializable model.

Conceptual shape:

```ts
export const ClassSchema = z.object({
  iri: z.string(),
  names: z.array(z.string()),
  labels: z.array(LabelSchema),
  comments: z.array(LabelSchema),
  superClasses: z.array(z.string()),
  equivalentClasses: z.array(z.string()),
  deprecated: z.boolean(),
});

export type ClassType = z.output<typeof ClassSchema>;
```

The full model should include:

```text
Vocabulary
Source
Prefix/context
Class
Property
Datatype
Enumeration/value
Domain
Range
SubClassOf
SubPropertyOf
EquivalentClass
EquivalentProperty
InverseOf
FunctionalProperty
Restriction
Union
Intersection
RDF list
Deprecation
Label/comment by language
Shape/profile
Unknown assertion
Diagnostics
```

Do not flatten an OWL expression to a string merely because TypeScript emission does not support it yet. Preserve the assertion and emit a diagnostic about what the current emitter could not model.

## 12.5 Multiple sources and imports

Input API should support:

```ts
const model = await readOntology([
  schemaOrgSource,
  gs1Source,
  owlSource,
], options);
```

The reader must define:

- IRI identity across sources;
- duplicate assertion behavior;
- conflicting labels/ranges;
- source provenance;
- import resolution policy;
- cycle handling;
- remote load limits;
- override/profile semantics.

Never concatenate files as the architectural solution to multiple ontologies.

## 12.6 Generated module granularity

Initial candidate:

```text
packages/vocab/schema/
  mod.ts
  terms/
    product.ts
    offer.ts
    properties.ts
  values/
    product.ts
    offer.ts
  schemas/
    product.ts
    offer.ts
  manifest.json
```

However, three separate physical files per class may create excessive generated-file counts.

Benchmark at least:

1. one giant generated module;
2. per-category chunks;
3. per-class modules re-exported by a root barrel;
4. generated subpath entrypoints without one giant root declaration file.

Evaluate runtime bundle size **and TypeScript compiler/language-server cost**.

The desired consumer API remains:

```ts
import { Product, ProductSchema, type ProductType } from '@okikio/vocab/schema';
```

Internal file layout exists to make that API cheap, not to force consumers into generated directory knowledge.

## 12.7 Type design

Avoid an unconditional definition such as:

```ts
export type ThingType = ThingLeafType | ProductType | PersonType | /* hundreds more */;
```

until compile benchmarks prove it is acceptable.

A more scalable direction is a property-map/generic-node model:

```ts
export interface ProductPropertiesType extends ThingPropertiesType {
  name?: ValueType<TextType>;
  offers?: ValueType<OfferType | IdReferenceType>;
}

export type ProductType = NodeType<'Product', ProductPropertiesType>;
```

Multi-type entities can use a generic composition:

```ts
export type ProductSoftwareType = MergeType<[
  ProductType,
  SoftwareApplicationType,
]>;
```

or a generated `NodeType<['Product', 'SoftwareApplication'], ...>` form.

The final form is **benchmark-gated**. The acceptance criterion is developer usability plus compiler performance, not clever type-level programming.

## 12.8 JSON-LD form vs RDF form

Generated vocabulary types primarily describe the developer-facing JSON-LD/vocabulary object form.

RDF terms remain runtime constants.

Do not make an RDF `Literal` pretend to be a JavaScript `string` merely because a property range is `schema:Text`.

The converter between generated JSON-LD values and RDF terms belongs to JSON-LD/RDF conversion, not the TypeScript type declaration itself.

## 12.9 Standard Schema output

Every generated class/profile can expose a runtime validator when the generator can state the contract honestly.

Default `ProductSchema` behavior should be **open-world structural validation**:

- known JSON-LD keywords have valid shapes;
- `@type` identifies a compatible class/multi-type set;
- known generated properties validate known ranges where representable;
- extension properties are not automatically rejected unless a closed profile says so;
- absence of an ontology property is not automatically a validation failure.

A SHACL/profile-derived schema can be stricter:

```text
ProductSchema
  vocabulary-aware open structural contract

GoogleProductSchema / ProductProfileSchema
  profile/shape-specific requiredness and cardinality
```

Do not use the name `StrictProductSchema` unless “strict” has one documented stable meaning across vocabularies.

## 12.10 Standard JSON Schema output

Generated schema objects can implement Standard JSON Schema conversion where possible.

The converter should support at least the targets the Standard Schema project strongly recommends if the chosen implementation can do so accurately:

```text
draft-2020-12
draft-07
```

OpenAPI output is optional and must not be claimed until tested.

If a feature cannot be represented in JSON Schema, the converter should fail explicitly or emit a documented approximation flag rather than silently weakening the contract.

---

# 13. Code generation dependency decision

The generator should not depend on the TypeScript compiler just to create TypeScript text.

## 13.1 Options

### Option A: hand-written string emitter only

Strengths:

- no dependency;
- total output control;
- easy deterministic snapshots.

Weaknesses:

- escaping/import syntax/collision handling becomes our code;
- easy to create invalid syntax;
- code formatting logic grows into a second formatter.

### Option B: TypeScript compiler AST/factory

Strengths:

- complete TypeScript syntax model;
- printer exists;
- familiar for code generators.

Weaknesses:

- heavyweight dependency;
- generator output becomes coupled to TypeScript compiler internals/versions;
- unnecessary AST allocation for mostly declarative emitted source;
- conflicts with the goal of keeping the generator focused and portable.

### Option C: vocabulary IR + Knitwork + Oxfmt/Oxc verification

Strengths:

- small code-emission primitives;
- safe import/export/string/key generation;
- supports type imports, interfaces, object types, and namespace exports;
- Oxfmt can normalize final TypeScript formatting;
- Oxc parser can syntax-check generated source quickly;
- ontology IR remains language-neutral.

Weaknesses:

- Knitwork does not model every possible complex TypeScript declaration;
- some generated type text still needs a small local writer;
- Oxfmt/Oxc adds tooling dependencies.

### Decision

**Use Option C as the first implementation.**

Treat Knitwork as an allowed focused dependency for safe code fragments, not as the ontology architecture.

Use a small project-owned writer for declarations Knitwork does not express clearly.

Use Oxfmt for generated-source formatting when its runtime/API fits the generator environment, and Oxc parsing as a generated-code validation gate.

If the combined dependency cost is worse than a deterministic local writer, benchmark and simplify. The dependency is allowed, not mandatory forever.

## 13.2 Generated source validation

For every generator fixture:

```text
ontology quads
    -> model
    -> emitted source
    -> Oxfmt
    -> Oxc parse
    -> TypeScript strict consumer compile
    -> runtime import of term/schema exports
```

Snapshots are useful, but a text snapshot that happens to look correct is not enough.

## 13.3 Generator determinism

Same ontology assertions + same configuration + same generator version must produce byte-identical generated source and manifest, except for explicitly configured timestamp metadata.

Prefer excluding wall-clock timestamps from generated files so rebuilds remain reproducible.

Sort by stable semantic keys, not source iteration order.

---

# 14. Generated vocabulary manifest and provenance

Every generated vocabulary needs a machine-readable manifest.

Conceptual fields:

```ts
export const VocabularyManifestSchema = z.object({
  version: z.literal(1),
  generatorVersion: z.string(),
  vocabulary: z.string(),
  sources: z.array(SourceManifestSchema),
  contexts: z.array(z.string()),
  classes: z.number().int().nonnegative(),
  properties: z.number().int().nonnegative(),
  datatypes: z.number().int().nonnegative(),
  diagnostics: z.number().int().nonnegative(),
});

export type VocabularyManifestType = z.output<typeof VocabularyManifestSchema>;
```

Each source should retain:

- source IRI/path;
- content hash;
- media type;
- ontology version IRI if present;
- retrieval date only when source retrieval actually occurred;
- relevant context/prefix information.

The generated API should be traceable to the ontology data that produced it.

---

# 15. Kaiju Crawl integration

The new RDF stack should solve a real Kaiju correctness problem rather than becoming an isolated semantic-web experiment.

## 15.1 Verified current JSON-LD limitation

The current Crawl structured-data path is pragmatic JSON processing:

```text
script[type=application/ld+json]
    -> JSON.parse
    -> recurse arrays/objects/@graph
    -> trim @type local name
    -> inspect raw object keys
```

That misses core JSON-LD semantics such as:

- term aliases;
- prefix expansion;
- `@vocab`;
- base IRI;
- nested/type-scoped contexts;
- language maps;
- list semantics;
- remote contexts;
- equivalent expanded IRIs.

A page can therefore contain valid JSON-LD that Kaiju does not recognize because its compact keys are not literally `name`, `offers`, `Product`, and similar strings.

## 15.2 Target semantic lane

```text
page source
    |
    +---- JSON-LD
    +---- Microdata
    +---- RDFa
    |
    v
standards-aware format adapters
    |
    v
RDF quad stream
    |
    +---- transient page Dataset/Source
    |
    +---- optional named graph provenance
    |
    v
semantic extractors / SPARQL queries
    |
    v
Kaiju fact candidates
    |
    v
existing evidence + confidence + fact resolution
```

The query can stay the same when the source syntax changes.

Example product extraction:

```sparql
SELECT ?product ?name ?price ?currency
WHERE {
  ?product a schema:Product ;
           schema:name ?name ;
           schema:offers ?offer .
  ?offer schema:price ?price .
  OPTIONAL { ?offer schema:priceCurrency ?currency . }
}
```

The extractor must map every result back to source/capture evidence.

## 15.3 Pragmatic metadata lane stays separate

```text
OpenGraph
Twitter Cards
canonical/meta/link
feeds
manifest
visible DOM
vendor metadata
page intelligence
```

These produce Kaiju candidates directly.

Do not force them through RDF simply to have one pipeline.

The final resolver can combine both evidence families.

## 15.4 Named graphs for provenance

When a page/domain graph is materialized, use graph identity to retain where assertions came from.

Concept:

```text
<urn:kaiju:capture:...>
  contains normalized assertions from one captured route
```

The graph IRI is not a substitute for the raw artifact reference.

A fact should still retain:

```text
capture ID
route
source block/script/selector
raw value or hash
extractor/query version
confidence
```

## 15.5 Graph lifetime

Default:

```text
one page
  parse -> query -> facts -> release graph
```

Use a domain-wide graph when:

- cross-page entity joining materially improves extraction;
- duplicate `@id` relationships need resolution;
- product/organization/offer references cross routes;
- a product feature explicitly queries the domain graph.

Do not keep every domain graph in one process until the crawl ends if facts can be emitted progressively.

## 15.6 Kaiju differential migration

Do not delete the current procedural extractors on day one.

Run both paths on a gold corpus:

```text
current raw structured-data extractor
vs
standards semantic RDF extractor
```

Classify differences:

- new correct finding;
- old correct finding missing in new path;
- old false positive removed;
- new false positive;
- context/network failure;
- unsupported source syntax;
- evidence/provenance regression;
- performance regression.

Only replace a production extractor after the new path meets the accuracy/evidence and performance gates.

---

# 16. Security, limits, cancellation, and hostile input

RDF/JSON-LD/SPARQL is untrusted input in Kaiju and many library consumers.

## 16.1 Parser resource limits

Every parser should have documented configurable limits where the format can trigger large state:

```text
maximum input bytes
maximum token/literal bytes
maximum nesting depth
maximum prefixes
maximum blank-node nesting
maximum RDF collection length
maximum diagnostics retained
maximum JSON-LD remote contexts
maximum remote document bytes
maximum redirects
```

Defaults must be selected from representative workloads and conformance tests, not arbitrary tiny limits that reject valid data.

## 16.2 Remote context/document policy

A server crawler must not let a JSON-LD document turn the context loader into an unrestricted SSRF client.

The caller owns:

- allowed schemes;
- DNS/private-network policy;
- redirect policy;
- credentials;
- proxy;
- cache;
- timeout;
- response size.

`@okikio/rdf/jsonld` owns the hook and safe default behavior, not Kaiju-specific network policy.

## 16.3 SPARQL SERVICE

`SERVICE` is a language feature with network consequences.

Never let an untrusted request provide arbitrary service endpoints merely because the builder supports `service()`.

Engine composition should allow:

- federation disabled;
- endpoint allowlist;
- per-service timeout;
- result/byte limits;
- credential policy;
- diagnostics.

## 16.4 Updates

SPARQL UPDATE needs explicit graph/database authority.

A builder makes syntax safer. It does not provide authorization, idempotency, audit, transaction semantics, or graph ownership.

## 16.5 Cancellation

All long asynchronous operations receive `AbortSignal`:

```text
stream parsing
JSON-LD remote load
canonicalization
large import
index build
compaction
query
federated query
vocabulary source load
code generation when I/O is involved
```

Check cancellation:

- before expensive work;
- between batches/chunks;
- while waiting on backpressure;
- before committing a new persistent generation.

Early iterator return must propagate cleanup to owned source readers/producers where possible.

## 16.6 Ownership

Use Explicit Resource Management for live resources:

```ts
await using store = await triplestore.open(fileSystem, options);
await using engine = await oxigraph.open(options);
```

A parser that only consumes a caller-owned stream does not suddenly own the stream unless the API explicitly says so.

---

# 17. Repository structure

The target repository should become a workspace rather than one flat package.

This is a proposed structure. File names can move during implementation if a better one-word ownership concept appears.

```text
packages/
  rdf/
    mod.ts
    term.ts
    factory.ts
    dataset.ts
    source.ts
    sink.ts
    stream.ts

    ntriples/
      mod.ts
      parse.ts
      write.ts
      parse_test.ts

    nquads/
      mod.ts
      parse.ts
      write.ts
      parse_test.ts

    turtle/
      mod.ts
      scan.ts
      parse.ts
      write.ts
      events.ts
      parse_test.ts

    trig/
      mod.ts
      parse.ts
      write.ts

    xml/
      mod.ts
      parse.ts
      write.ts

    jsonld/
      mod.ts
      context.ts
      loader.ts
      parse.ts
      write.ts
      convert.ts

    rdfa/
      mod.ts
      parse.ts

    microdata/
      mod.ts
      parse.ts

    canon/
      mod.ts
      canon.ts

    ontology/
      mod.ts
      read.ts
      model.ts
      index.ts

    shape/
      mod.ts
      model.ts
      validate.ts

    rdfjs/
      mod.ts
      adapt.ts

  sparql/
    mod.ts
    value.ts
    expression.ts
    pattern.ts
    path.ts
    query.ts
    update.ts
    serialize.ts

    parse/
      mod.ts
      scan.ts
      events.ts
      parse.ts
      analyze.ts
      materialize.ts

    algebra/
      mod.ts
      lower.ts
      model.ts

    result/
      mod.ts
      binding.ts
      json.ts
      xml.ts

    http/
      mod.ts
      query.ts
      update.ts
      response.ts
      error.ts

  vocab/
    mod.ts
    read.ts
    model.ts
    name.ts
    emit.ts
    manifest.ts

    schema/
      mod.ts
      ... generated/runtime output ...

    rdf/
    rdfs/
    owl/
    xsd/
    shacl/
    skos/
    activitystreams/

  triplestore/
    mod.ts
    open.ts
    store.ts
    dictionary.ts
    index.ts
    segment.ts
    manifest.ts
    compact.ts
    recover.ts
    stats.ts

  oxigraph/
    mod.ts
    open.ts
    adapt.ts
    query.ts

  comunica/
    mod.ts
    open.ts
    source.ts
    query.ts

bench/
  rdf/
    parse.ts
    dataset.ts
    canon.ts

  sparql/
    build.ts
    parse.ts
    query.ts

  vocab/
    emit.ts
    types.ts

  triplestore/
    import.ts
    query.ts
    reopen.ts
    compact.ts

  engines/
    oxigraph.ts
    comunica.ts

  crawl/
    structured-data.ts

fixtures/
  rdf/
  jsonld/
  sparql/
  vocab/
  store/
  crawl/

examples/
  rdf/
  sparql/
  vocab/
  store/

infra/
  qlever/
  blazegraph/

.mise/
  tasks/

docs/
  architecture/
  guides/
  reference/
  research/
```

## 17.1 No root `scripts/`

Repository-maintainer operations belong under `.mise/tasks/` or a real package/CLI.

The current `scripts/ttl-to-ts.ts` should move into the `@okikio/vocab` library and, if a command is wanted, a focused executable wrapper.

The programmatic generator must be the authority. The CLI does not own ontology parsing or emission.

## 17.2 Tests beside implementation

Unit/contract tests stay beside the capability:

```text
parse.ts
parse_test.ts
```

Cross-package benchmark suites stay under `bench/` because they compare implementations/baselines and need shared fixtures/reporting.

Conformance fixture data stays under `fixtures/` with source/license/provenance notes.

## 17.3 `mod.ts`

Every package/subpath `mod.ts` is an intentional public entry point.

Avoid broad `export *` unless the whole underlying module is deliberately public and collision-safe.

Prefer explicit export review:

```ts
export { dataset, literal, namedNode, quad } from './factory.ts';
export type { Dataset, QuadType, TermType } from './types.ts';
```

The exact `types.ts` example should not create a permanent broad root `types` dumping ground. Keep related types with their owning modules or use a focused file only when the concept is genuinely cohesive.

---

# 18. Naming rules specific to this workspace

Apply the shared Okikio/Kaiju conventions with these RDF-specific clarifications.

## 18.1 Suffixes

```text
*Schema      runtime schema/validator
*Type        project-owned serializable/data type
*Options     caller configuration
*Result      completed operation result
*Failure     terminal failed result
*Problem     structured non-terminal/validation issue
*Record      persisted/transport record
*Manifest    authoritative artifact manifest
*Policy      selection/constraint rules
*Source      readable semantic/source contract
*Sink        writable semantic/sink contract
```

Do not add `Type` to ecosystem behavior interfaces merely to satisfy a rule mechanically.

## 18.2 Verbs

Prefer:

```text
create
open
get
read
parse
write
serialize
inspect
select
match
add
delete
compact
recover
lower
emit
close
cancel
```

`emit` is appropriate in the code generator because source text/files are being emitted from an already-created model.

Avoid project-owned catch-all `execute()` where the actual operation is query, update, parse, load, write, or compile.

SPARQL standards or upstream APIs may still require names such as `queryVoid` for compatibility.

## 18.3 Internal parser names

Use names that expose the exact resource/state:

```text
Scanner
ParserState
PrefixTable
TermTable
QuadBatch
SyntaxEventType
RecoveryType
IndexCursor
SegmentReader
SegmentWriter
```

Avoid:

```text
ParserManager
RdfHelper
CommonParser
DataProcessor
Worker
```

## 18.4 Short locals

These are acceptable when local context is strong:

```ts
const quad = ...;
const term = ...;
const row = ...;
const token = ...;
const ctx = ...; // only for a documented execution/parser context
```

A public API should not export `getData()` when it actually gets an ontology class or index page.


---

# 19. TSDoc and comment standard

Documentation quality is part of the implementation contract.

A coverage number that says every export has a comment is not sufficient.

## 19.1 Package README

Every package README must answer:

1. What does this package own?
2. What does it deliberately not own?
3. What are the main public entry points?
4. What resources does it create or borrow?
5. What runtimes does it support?
6. What are the important limits/cancellation semantics?
7. How does it compose with the neighboring packages?
8. What is the smallest useful example?
9. Which behavior is standards-defined and which is package policy?
10. What remains benchmark-gated or experimental?

For example, `@okikio/triplestore` must state plainly that `@okikio/opfs` provides storage primitives while the triplestore owns indexes, commits, recovery, and RDF persistence semantics.

## 19.2 Module TSDoc

A public module should explain its role before enumerating exports.

Good:

```ts
/**
 * Parses N-Quads into RDF quads without materializing the complete document.
 *
 * The parser retains byte ranges while scanning and decodes term text only when
 * a complete RDF term is available. The caller owns the input stream. Returning
 * early from the iterator cancels the parser's reader but does not dispose a
 * caller-owned higher-level resource.
 *
 * @example Parse a large response progressively
 * ```ts
 * for await (const quad of parse(response.body!)) {
 *   await store.add(quad);
 * }
 * ```
 */
```

The exact cleanup wording must match the implementation. Do not promise cancellation propagation until it is tested.

## 19.3 Public symbol TSDoc

Public TSDoc should explain:

- what the symbol represents;
- why the caller needs it;
- ownership/lifetime;
- important semantics;
- failure/cancellation behavior;
- meaningful examples;
- performance characteristics when they affect correct use.

Do not write:

```ts
/** Parses RDF. */
export function parse(...) {}
```

## 19.4 Important internal symbols

Document internal code when it preserves a rule that is not obvious from syntax.

Required examples:

- scanner offset semantics;
- why parser chunks can be released;
- the stack invariant for syntax events;
- term interning lifetime/eviction;
- why one index permutation exists;
- segment commit order;
- manifest recovery order;
- why an engine adapter batches quad conversion;
- query-algebra lowering order;
- collision-resolution determinism;
- benchmark fixture generation/distribution;
- why a TypeScript type design avoids a giant recursive union.

A private helper may contain the most important invariant in a module and therefore deserves more documentation than a trivial exported wrapper.

## 19.5 Performance comments

When optimized code is less obvious, state:

```text
what is optimized
which measured cost it reduces
which workload showed the cost
what complexity the optimization adds
what invariant keeps it correct
where the benchmark proving the choice lives
```

Do not write “optimized for performance” without evidence.

## 19.6 Avoid self-referential filler

Avoid:

```text
This function...
This code...
This class...
This test...
Phase 3...
```

Prefer the domain rule directly:

> Quad IDs remain generation-local. Persisted records store term dictionary IDs only with the dictionary generation that defines them.

## 19.7 Tests and benchmarks need intent

A non-trivial test should explain what regression it protects.

A benchmark should explain the question it decides.

Bad benchmark name:

```text
parser benchmark
```

Good:

```text
Does source-range tokenization reduce allocations enough to improve 100 MB N-Quads ingestion without increasing first-quad latency?
```

---

# 20. Test strategy

The test suite is layered because syntax correctness, semantic correctness, lifecycle correctness, and compatibility failures look different.

Use `node:test` with `describe`/`it` for project tests and `@std/expect` for expectations where the shared project convention applies. Keep the same production TypeScript source across supported runtimes.

## 20.1 Unit tests

Cover:

### RDF terms

- term equality;
- literal datatype/language/direction;
- blank-node identity;
- variable/default graph;
- triple terms when implemented;
- quad equality;
- hash stability;
- invalid construction.

### Dataset

- add/delete/has;
- every match wildcard position;
- named graph isolation;
- duplicate semantics;
- iterator behavior;
- early return;
- bulk import;
- count/statistics.

### SPARQL builder

- values/literals/IRIs;
- Unicode and escaping;
- triple/object/Cypher pattern equivalence;
- expression precedence;
- property paths;
- subqueries;
- graph/service;
- aggregation;
- updates;
- raw-fragment isolation;
- SPARQL 1.1/1.2 mode behavior.

### Generator

- naming;
- collisions;
- inherited properties;
- multi-domain/range;
- equivalent classes/properties;
- deprecation;
- OWL lists/unions/intersections;
- unknown assertions retained;
- multiple source merge;
- multi-type generated types;
- open-world schema behavior;
- SHACL/profile stricter behavior;
- deterministic emission.

## 20.2 Parser conformance suites

Use official/community conformance suites where available.

Required categories:

```text
N-Triples
N-Quads
Turtle
TriG
RDF/XML
JSON-LD 1.1
RDF canonicalization
SPARQL query syntax/evaluation where engine behavior is tested
SPARQL results formats
RDFa
```

The suite loader must retain:

- source suite/version;
- expected outcome;
- license/source URL;
- unsupported/excluded reason;
- parser profile.

Never hide excluded official tests. An unsupported standards feature is a visible capability gap.

## 20.3 Differential tests

Use mature implementations as oracles, not as unquestioned truth.

Examples:

| Capability | Differential baseline |
|---|---|
| N-Triples/N-Quads/Turtle/TriG | N3, Oxigraph |
| JSON-LD to RDF | jsonld.js, `jsonld-streaming-parser`, Oxigraph where applicable |
| RDF canonicalization | `rdf-canonize` |
| RDFJS dataset/source behavior | N3 Store / relevant RDFJS suites |
| SPARQL query evaluation | Oxigraph, Comunica, QLever/Fuseki fixtures where semantic feature matches |
| persistent RDF | Quadstore + BrowserLevel baseline |
| Schema.org generated typing | `schema-dts` consumer fixtures |

Compare normalized semantic output, not implementation-specific ordering unless the standard defines the order.

## 20.4 Chunk-boundary tests

Every streaming parser must be tested with adversarial chunking.

For one fixture, run:

```text
complete input as one chunk
1-byte chunks
2-byte chunks
prime-sized chunks
every token delimiter split
UTF-8 multi-byte character split at every byte
escape sequence split
IRI split
literal split
comment split
EOF immediately after an escape/opener
```

A streaming parser that only passes “normal network chunks” is not proven.

## 20.5 Property-based tests

Use property/fuzz generation for invariants such as:

- serialize -> parse equivalence;
- valid term -> encode -> decode;
- dataset add/delete closure;
- random chunk partition equivalence;
- prefix expansion/compaction round-trips within supported semantics;
- stable naming independent of input assertion order;
- store commit/reopen preserving all accepted quads;
- cancellation not committing partial generation;
- syntax event nesting;
- no duplicate generated export identifiers.

Fuzzing is especially useful for parser state machines and persistent manifest recovery.

## 20.6 Error and cancellation tests

Test cancellation at every externally visible phase:

```text
before input read
mid token
mid large literal
between quad batches
while consumer is slow
remote JSON-LD context fetch
canonicalization
index build
segment flush
manifest commit
query
federated subquery
WASM initialization
vocabulary source fetch
source emission
```

After cancellation verify:

- operation settles promptly;
- no new work is admitted;
- owned readers/resources close;
- borrowed resources remain open;
- no partial store generation becomes authoritative;
- temporary files are removed or recoverable;
- retained memory returns to baseline/plateau.

## 20.7 Store crash/recovery tests

Fault-inject every persistence transition:

```text
write partial segment
flush fails
index write fails
manifest temp write fails
manifest replacement fails
process dies after data commit but before old-file cleanup
process dies during compaction
stale temp files exist on open
manifest references missing file
segment checksum mismatch
index checksum mismatch
```

The open/recovery path must classify:

```text
recoverable stale artifact
recoverable incomplete generation
corrupt authoritative generation
unsupported format version
operator intervention required
```

Do not collapse all cases into “database failed to open.”

## 20.8 Clean consumer tests

Test the actual package surfaces from a clean external project:

- root `@okikio/rdf` import;
- one format subpath;
- `@okikio/sparql` builder only;
- SPARQL HTTP only;
- one generated `ProductType` type-only import;
- one `ProductSchema` runtime import;
- `@okikio/oxigraph` without Comunica;
- `@okikio/comunica` without Oxigraph;
- `@okikio/triplestore` with memory OPFS adapter;
- browser root import with no Node/Deno/Bun imports in graph.

Check both type and runtime imports.

## 20.9 Tree-shaking tests

Build tiny consumers and inspect output.

Examples:

```text
consumer imports rdf.namedNode only
consumer imports ProductType only
consumer imports ProductSchema only
consumer imports Turtle parser only
consumer imports Comunica only
```

Verify unrelated heavy dependencies do not appear:

```text
jsonld.js
Oxigraph WASM
Comunica engine
RDF/XML parser
canonicalization
vocabulary generator
Node filesystem
```

Type-only imports must not create runtime code.

---

# 21. Benchmark strategy

The benchmark suite exists to answer architecture questions.

A result is useful only when:

1. semantic output is proven equivalent;
2. fixture and environment are recorded;
3. cold/warm state is known;
4. samples are retained;
5. memory/lifecycle effects are measured where relevant;
6. the benchmark maps to a real consumer workload.

Mitata is the primary in-process benchmark runner. Process-level, browser, compiler, and memory benchmarks can use dedicated harnesses when Mitata is not the correct measurement surface.

## 21.1 Benchmark questions

Every benchmark file starts with one or more explicit questions.

Examples:

- Does the native N-Quads parser beat N3 on 1 GB inputs while retaining no more than one bounded input window?
- Is a 4K quad batch faster than per-quad WASM insertion into Oxigraph after accounting for time-to-first-result?
- Does a term dictionary reduce persistent store size enough to justify lookup cost on typical Schema.org graphs?
- Does a six-index triplestore materially improve the actual query mix enough to justify write amplification and storage?
- Is `Store.load(JSON-LD)` faster than JS JSON-LD expansion + quad crossing for common webpage JSON-LD?
- Does root-barrel `@okikio/vocab/schema` significantly increase TypeScript memory relative to granular class subpaths?
- Does Standard Schema runtime validation add meaningful cost to Kaiju structured-data extraction compared with type-only/no-validation paths?
- Does a SPARQL-based Kaiju extractor improve correctness enough to justify graph-build/query overhead relative to current procedural extraction?

## 21.2 Baselines

Use real baselines, not “old vs new” only.

### RDF data model/dataset

```text
@okikio/rdf current implementation
N3 DataFactory/Store
relevant RDFJS reference implementations
```

### RDF parsing

```text
@okikio/rdf parser
N3 parser
Oxigraph parser/load where semantically comparable
```

### JSON-LD

```text
jsonld.js toRDF
jsonld-streaming-parser
rdfjs-base/parser-jsonld
Oxigraph load/parse path where remote-context behavior is equivalent
@okikio/rdf/jsonld
```

### Canonicalization

```text
rdf-canonize
@okikio/rdf/canon wrapper/native path
```

### SPARQL builder

```text
current @okikio/sparql 0.0.2
new structured builder
trusted prebuilt raw string baseline
```

The raw-string baseline measures unavoidable serialization lower bound. It is not a safe public API replacement.

### Query engines

```text
Oxigraph
Comunica RDFJS engine
Comunica full/federated engine when relevant
QLever/Fuseki/other external endpoint only for end-to-end HTTP engine cases
```

### Persistent store

```text
@okikio/triplestore candidate
Quadstore + BrowserLevel
in-memory store + persisted N-Quads reload
Oxigraph in-memory reload snapshot where comparable
```

### Vocabulary generator

```text
schema-dts-gen
current ttl-to-ts starter
@okikio/vocab generator
```

### TypeScript consumer

```text
schema-dts
@okikio/vocab/schema root imports
@okikio/vocab/schema granular imports
```

## 21.3 Fixture families

Every benchmark area has named deterministic fixtures.

### RDF size

```text
tiny       ~100 quads
typical    ~10,000 quads
large      ~1,000,000 quads
stress     selected machine-safe multi-million corpus
```

Do not hard-code a stress size that causes every developer laptop to swap. The stress runner can scale from a configured byte/record target while retaining a deterministic seed.

### RDF distribution dimensions

Vary:

- unique subject ratio;
- repeated predicate ratio;
- repeated object ratio;
- named graph count;
- blank-node ratio;
- language literal ratio;
- typed literal ratio;
- large literal sizes;
- long IRIs;
- Unicode;
- star/triple-term ratio when implemented.

### JSON-LD web fixtures

```text
simple Schema.org object
@graph page
aliased terms/types
@vocab/@base
nested context
type-scoped context
language map
list/set
multiple products/offers
remote schema.org context
several remote contexts
context redirect
context cycle
large repeated array
malformed-but-common script
hostile context fanout
```

### SPARQL query fixtures

```text
point lookup
star join
chain join
high-fanout join
FILTER selective/non-selective
OPTIONAL
UNION
VALUES
GROUP BY + aggregate
ORDER BY + LIMIT
property path
named graphs
subquery
SERVICE
CONSTRUCT
DESCRIBE
ASK
INSERT/DELETE
```

### Generator fixtures

```text
tiny custom ontology
Schema.org
RDF/RDFS/OWL/XSD set
Schema.org + extension
GS1 + OWL foundation
multi-typed classes
large inheritance fanout
name collisions
invalid/inconsistent ontology assertions
SHACL profile
```

### Kaiju fixtures

Use captured/curated webpage samples with gold expected facts, not generated JSON only.

Split by domain so one template does not appear in both evaluation and tuning sets.

## 21.4 Cold vs warm

Separate:

```text
module import
WASM compile/instantiate
engine create
store open
index build
context cache cold fetch
context cache warm hit
first parse
steady parse
first query
steady query
cold persistent reopen
warm OS/cache reopen
```

A benchmark called simply “query” is insufficient if one implementation includes index creation and the other starts from a warm store.

## 21.5 Metrics

For each relevant workload record:

```text
wall time
median
p95/p99 where meaningful
throughput records/s
throughput bytes/s
time to first token/event/quad/binding
CPU time / utilization
allocation rate
GC time/count if measurable
peak heap
retained heap
RSS
external/ArrayBuffer/WASM memory
persistent bytes
bytes written
write amplification
open file/resource count
queue depth
batch size
cleanup time
cold open/rebuild time
```

Do not use one composite “performance score.”

## 21.6 Memory plateau tests

Run lifecycle loops such as:

```text
open -> import -> query -> close -> GC observation
repeat 100x

parse -> cancel halfway -> release
repeat 1000x

create Oxigraph engine -> load -> dispose
repeat N times

open triplestore -> scan -> close
repeat N times
```

Report whether retained memory reaches a stable plateau.

Peak memory and retained memory answer different questions.

## 21.7 Concurrency/backpressure matrix

For async parser/store/import pipelines test:

```text
concurrency 1 / 2 / 4 / 8 / 16
fast destination
slow destination
bounded queue 1 / small / typical
consumer pauses
consumer cancels
```

Hold input and destination behavior constant when comparing implementations.

A configuration that reports more throughput while queue depth grows without bound is not sustainable throughput.

## 21.8 Browser/runtime matrix

Where supported:

```text
Deno
Node.js
Bun
Chromium Window
Chromium DedicatedWorker
Firefox
WebKit/Safari
```

Do not benchmark unsupported capabilities by polyfilling them into a different storage model and calling the results browser-native.

For OPFS/sync-access store work, measure the worker architecture that production would actually use.

## 21.9 TypeScript/compiler benchmarks

This is a first-class benchmark family because generated vocabulary types can make otherwise fast runtime libraries unpleasant to use.

Scenarios:

```text
import 1 class type
import 10 class types
import 100 class types
import root Thing/general type
multi-type merge
large nested Product/Offer graph
@graph with heterogeneous nodes
root vocabulary barrel
single granular class subpath
IDE-like repeated incremental check
emit declarations from a consumer library
```

Record:

```text
tsc wall time
peak RSS
TypeScript memory statistics when available
type count
instantiation count
declaration size
language-server stability/manual smoke notes
```

Compare against `schema-dts` using the same TypeScript version and consumer source.

## 21.10 Benchmark correctness oracle

Before entering the timed region:

- parse expected count/digest;
- canonicalize output ordering only for comparison, not inside the timed path unless production also pays it;
- validate query result multiset;
- validate generated source compile/import;
- validate store reopen digest;
- validate Kaiju facts/evidence.

A fast wrong parser receives no performance credit.

## 21.11 Regression policy

Calibrate thresholds from several baseline runs on the same machine.

Suggested starting review triggers, not universal laws:

| Metric | Review trigger |
|---|---:|
| stable warm latency | >10% regression with meaningful absolute cost |
| large parse throughput | >10% regression |
| p95 async query/import | >15% regression |
| peak memory | >15% regression |
| persistent bytes | >15% growth without a documented feature/index reason |
| TypeScript compile memory | >15% regression |
| cold import/start | >10% and meaningful absolute change |

A representation change that adds substantial complexity should normally show a stable end-to-end improvement above measurement noise, not a 2% microbenchmark win.

## 21.12 Benchmark artifact

Store raw results as structured records.

Concept:

```ts
export const BenchmarkRecordSchema = z.object({
  version: z.literal(1),
  commit: z.string().min(7),
  runtime: z.string(),
  platform: z.string(),
  architecture: z.string(),
  fixture: z.string(),
  case: z.string(),
  metric: z.string(),
  unit: z.string(),
  median: z.number(),
  p95: z.number().optional(),
  samples: z.number().int().positive(),
  correctness: z.string(),
  notes: z.array(z.string()),
});

export type BenchmarkRecordType = z.output<typeof BenchmarkRecordSchema>;
```

The exact schema can expand to preserve runner-specific estimates/raw samples.

Each benchmark run should record:

- git commit;
- dirty state;
- runtime/version;
- OS/architecture;
- CPU/memory summary;
- power/thermal notes when relevant;
- lockfile hash;
- fixture hash;
- command;
- raw runner output;
- summarized CSV/JSONL.

## 21.13 Benchmark reports must cause decisions

Every completed benchmark campaign ends with:

```text
Question
Evidence
Correctness status
Measured trade-offs
Decision
Rejected alternatives
What would change the decision
```

Do not keep a benchmark suite that generates numbers nobody uses.

---

# 22. Stress testing

Stress tests target system failure modes, not average throughput.

## 22.1 Parser stress

- maximum legal literal/IRI sizes selected for the supported profile;
- extremely long comments;
- deep Turtle nested collections/property lists;
- huge prefix tables;
- repeated blank nodes;
- Unicode edge cases;
- malformed escape storms;
- one-byte chunks;
- random chunk boundaries;
- early EOF at every scanner state;
- slow producer;
- slow consumer;
- cancellation after every N bytes;
- diagnostic flood capped by policy.

## 22.2 JSON-LD stress

- remote context cycles;
- many redirects;
- repeated same context concurrently to prove request dedup;
- context cache eviction;
- large `@graph`;
- deeply nested nodes;
- massive lists;
- conflicting/scoped contexts;
- hostile remote responses;
- loader cancellation;
- loader timeout;
- private-network SSRF fixture in server integration tests.

## 22.3 Query stress

- high-cardinality joins;
- Cartesian-like patterns;
- long property paths;
- OPTIONAL fanout;
- large VALUES;
- GROUP/ORDER memory pressure;
- result consumer backpressure;
- cancellation during engine work;
- federated endpoint timeout;
- one federated source failing;
- huge CONSTRUCT result.

## 22.4 Store stress

- sustained append;
- mixed read/write;
- repeated deletes;
- compaction while readers exist;
- reopen thousands of generations;
- near-quota browser storage;
- disk-full/failing write simulation;
- checksum corruption;
- stale locks/temp files;
- concurrent process/realm behavior appropriate to backend guarantees;
- cache limit pressure;
- repeated cancellation/retry.

## 22.5 Generator stress

- thousands of classes/properties;
- deep inheritance;
- wide inheritance;
- cyclic/invalid inheritance diagnostics;
- many prefix/name collisions;
- many language labels/comments;
- multi-ontology overlapping IRIs;
- output file count limits;
- repeated generation for determinism;
- `tsc` on the emitted maximum fixture.

---

# 23. Documentation architecture

Do not put the entire system into one architecture page after this handoff is implemented.

Create focused durable documents.

## 23.1 Root docs

```text
README.md
  What the workspace is, package map, quick starts, release maturity.

CONTRIBUTING.md
  local tasks, validation, benchmarks, generated files, source refresh rules.
```

## 23.2 Architecture docs

```text
docs/architecture/ecosystem.md
  package ownership and dependency direction

docs/architecture/rdf-model.md
  term/dataset/source/sink semantics and RDFJS compatibility

docs/architecture/parser-pipeline.md
  source ranges, scanner, events, semantic output, recovery, DOD

docs/architecture/sparql-model.md
  builder model, parser events, syntax materialization, algebra, result modes

docs/architecture/query-engines.md
  HTTP/Oxigraph/Comunica contracts and capability negotiation

docs/architecture/triplestore.md
  filesystem ownership, terms, segments/indexes, commit/recovery, compaction

docs/architecture/vocabulary-generation.md
  ontology IR, types, Standard Schema, JSON Schema, naming, manifests

docs/architecture/kaiju-structured-data.md
  semantic lane, pragmatic lane, provenance, facts, migration

docs/architecture/performance.md
  transformation graphs, benchmark questions, thresholds, profiles
```

## 23.3 Reference docs

```text
docs/reference/rdf-formats.md
  formats, standards versions, streaming, strictness, limits

docs/reference/sparql-capabilities.md
  SPARQL versions/features/extensions

docs/reference/engine-capabilities.md
  exact tested Oxigraph/Comunica/HTTP behavior

docs/reference/vocab-naming.md
  term/type/schema naming and collision rules

docs/reference/store-format.md
  persistent format version and recovery guarantees

docs/reference/benchmarks.md
  current benchmark environment/results and raw artifact locations
```

## 23.4 Guides

```text
docs/guides/jsonld.md
  parse/expand/compact/frame/toRdf/fromRdf

docs/guides/local-query.md
  RDF dataset + local engine

docs/guides/endpoint-query.md
  SPARQL HTTP query/update

docs/guides/vocabulary.md
  generate and consume a vocabulary

docs/guides/persistent-store.md
  open/import/query/reopen a triplestore

docs/guides/kaiju.md
  use the semantic lane in Crawl
```

## 23.5 Research docs

Keep detailed upstream comparisons separate from architecture contracts:

```text
docs/research/schema-dts.md
docs/research/jsonld.md
docs/research/engines.md
docs/research/stores.md
docs/research/parsers.md
```

This lets research evolve without rewriting the stable public programming model every time an upstream library changes.

---

# 24. Current file action register

The exact patch should be planned after a fresh repository checkout, but the current `0.0.2` source implies these actions.

| Current path | Target action | Reason |
|---|---|---|
| `mod.ts` | replace with intentional `packages/sparql/mod.ts` exports | current broad `export *` surface mixes builder, HTTP execution, namespaces, and helpers |
| `sparql.ts` | split by values/expressions/serialization as code demands | 43 KB single file is carrying several concepts |
| `builder.ts` | migrate to structured query model | preserve fluent DX without string-first architecture |
| `update.ts` | migrate beside query model/update syntax | keep SPARQL mutation semantics explicit |
| `executor.ts` | split into query contract + HTTP adapter + optional resource helpers | current endpoint-only model and wrong graph result path |
| `namespaces.ts` | replace curated giant constants with generated vocab/namespace utilities | vocab data belongs in `@okikio/vocab` |
| `patterns/triples.ts` | retain/adapt | useful pattern capability |
| `patterns/objects.ts` | retain/adapt after RDF term/type review | strong ergonomic graph pattern |
| `patterns/cypher.ts` | retain if tests prove syntax remains safe/clear | useful visual DSL but must not accept unsafe relation text |
| `scripts/ttl-to-ts.ts` | delete after `@okikio/vocab` replacement | starter generator violates target parsing/model/codegen structure |
| `docs/*` | migrate and rewrite around package family | current docs describe one monolithic package |
| `examples/*` | split by package/use case | examples should prove public packages independently |
| `infra/qlever` | retain as endpoint integration fixture if maintained | valuable real-engine tests |
| `infra/blazegraph` | retain only if still an actively tested compatibility target | avoid stale infrastructure merely because it exists |
| `.github/workflows/publish.yml` | review against actual release policy | generated multi-package release will change publishing needs; do not preserve blindly |
| `deno.jsonc` | convert to workspace/export map | current exports refer to old flat files and root generator script |
| `mise.toml` | expand repository tasks through `.mise/tasks/` | complex test/bench/gen work should not accumulate shell strings in one TOML |

Do not combine this functional migration with unrelated repository-wide formatting churn.

---

# 25. Implementation phases

Each phase has an acceptance gate. Later phases may research in parallel, but do not make later code depend on an unproven earlier abstraction.

## Phase 0: repository and benchmark baseline

### Work

- capture current public exports;
- run current examples/tests;
- build clean consumers;
- record current `@okikio/sparql` build/serialization performance;
- benchmark current TypeScript compile/import footprint;
- create initial RDF/JSON-LD/SPARQL fixture corpus;
- add raw benchmark result storage/report schema;
- move maintainer tasks toward `.mise/tasks/`;
- create this handoff in repository docs after review.

### Acceptance

- current behavior and failures recorded;
- no target design claim depends on an unmeasured current baseline;
- benchmark harness proves correctness before timing;
- source authority documented.

## Phase 1: `@okikio/rdf` data model

### Work

- implement RDF term/factory contracts;
- RDFJS compatibility tests;
- Dataset/Source/Sink/Store baseline;
- term equality/hash;
- streaming import;
- namespace helper;
- RDF 1.2-ready term model decisions;
- root import-safety/tree-shake tests.

### Acceptance

- official/relevant RDFJS data-model tests pass;
- no query engine dependency;
- root import remains light across Deno/Node/browser;
- dataset semantics differential-tested.

## Phase 2: fast line RDF parsers

### Work

- N-Triples;
- N-Quads;
- source-backed scanning;
- adversarial chunk tests;
- diagnostics/limits;
- differential N3/Oxigraph tests;
- Mitata throughput/allocation benchmarks.

### Acceptance

- conformance green for declared profile;
- bounded memory on large stream;
- early-return cleanup proven;
- benchmark report decides whether any packed/internal representation is justified.

## Phase 3: Turtle/TriG + parser event core

### Work

- Turtle/TriG parser state;
- prefix/base/list/blank-node semantics;
- syntax event core where useful;
- optional diagnostics/materialization experiments;
- round-trip serializer tests.

### Acceptance

- official suite status documented;
- event nesting/range invariants property-tested;
- quad semantic output matches differential baseline;
- no AST required for plain parse-to-quads.

## Phase 4: SPARQL result/execution refactor

### Work

- define `queryBindings`, `queryQuads`, `queryBoolean`, `queryVoid`;
- canonical RDF binding values;
- move HTTP endpoint behavior to adapter/subpath;
- correct content negotiation;
- CONSTRUCT/DESCRIBE RDF parsing;
- migrate builder `.execute()` convenience to delegate through queryable adapter or deprecate before release;
- move label/property helpers out of core contract.

### Acceptance

- SELECT/CONSTRUCT/DESCRIBE/ASK/UPDATE tested against real endpoint fixture;
- abort/timeout/malformed media/HTTP errors tested;
- no graph result flattened to binding rows.

## Phase 5: SPARQL parser/model modernization

### Work

- source-backed scanner;
- syntax events;
- parser diagnostics;
- optional syntax materialization;
- serializer round trip;
- semantic lowering/algebra seam;
- SPARQL 1.1 baseline plus explicit 1.2 capability tracking.

### Acceptance

- syntax/evaluation conformance status documented;
- builder output and parsed output serialize equivalently for supported syntax;
- `raw()` remains isolated and explicit;
- no one engine dependency enters `@okikio/sparql`.

## Phase 6: JSON-LD and web semantic formats

### Work

- `@okikio/rdf/jsonld` façade;
- document loader/context cache contracts;
- streaming parser path;
- jsonld.js expand/compact/flatten/frame path;
- RDFa/Microdata adapters;
- RDF/XML parser/serializer plan;
- RDFC-1.0 canonicalization adapter.

### Acceptance

- JSON-LD conformance suite for declared operations;
- remote loader security/cancellation tests;
- streaming/batch benchmarks;
- no root RDF import pays JSON-LD dependency cost.

## Phase 7: vocabulary compiler

### Work

- ontology IR schemas;
- multiple input sources;
- RDFS/OWL interpretation;
- unknown assertion retention;
- naming/collision plan;
- direct term/type/schema generation;
- Standard Schema;
- SHACL/profile path;
- manifest;
- Knitwork/Oxfmt/Oxc emission/validation;
- Schema.org generator.

### Acceptance

- generated Schema.org API compiles;
- direct import DX works;
- multi-type fixture works;
- external ontology fixture (GS1-like richer RDF) works or gaps are explicitly diagnosed without parser failure;
- deterministic regeneration;
- type/compiler benchmark beats or materially improves on the chosen schema-dts comparison goals.

## Phase 8: Oxigraph and Comunica

### Work

- explicit packages;
- queryable adapters;
- RDF term crossing benchmarks;
- bulk import paths;
- source statistics for Comunica;
- WASM cold/warm measurement;
- cross-runtime smoke tests.

### Acceptance

- same semantic query fixture runs through both engines where features overlap;
- capability differences are documented rather than hidden;
- no Oxigraph persistence claim;
- importing one engine never imports the other.

## Phase 9: triplestore persistent baseline

### Work

- benchmark storage alternatives;
- implement selected minimal persistent design;
- term dictionary;
- required indexes;
- manifest generation;
- commit/recovery;
- reopen;
- corruption checks;
- compaction only when needed;
- OPFS memory/Node/Deno/browser adapters.

### Acceptance

- crash/fault matrix passes;
- persistent digest survives reopen;
- bounded cache/memory;
- raw benchmark data justifies indexes/storage format;
- borrowed filesystem ownership proven;
- browser and server backend guarantees documented separately.

## Phase 10: Kaiju Crawl semantic lane

### Work

- replace raw-only JSON-LD interpretation with standards-aware parallel lane;
- Microdata/RDFa normalization;
- page named-graph/provenance mapping;
- Product/Offer/Job/Event semantic queries;
- current procedural extractor differential mode;
- context loader tied into Crawl HTTP/security/cache policy;
- fact candidate/evidence bridge.

### Acceptance

- gold corpus accuracy report;
- every new fact maps to raw evidence;
- existing correct facts do not regress without documented reason;
- page/domain graph memory remains bounded;
- benchmark shows acceptable Crawl cost at representative route concurrency.

## Phase 11: optimization and native hot paths

Only after profiles:

- term interning;
- SoA quad batches;
- binary encoded indexes;
- worker transfer optimization;
- WASM parsing/storage helpers;
- custom persistent page/index format;
- native query kernels.

Each optimization gets its own before/after benchmark and complexity justification.

---

# 26. Validation and definition of done

For an implementation phase, “done” means all applicable gates pass.

## 26.1 Formatting and lint

- Deno formatter on changed production/test files;
- Deno lint;
- no unrelated repository-wide mechanical churn;
- `git diff --check`.

## 26.2 Strict type checks

Use the repository's strictest supported TypeScript settings, including where practical:

```text
strict
exactOptionalPropertyTypes
noUncheckedIndexedAccess
skipLibCheck = false
```

Check:

- each package entry point;
- tests;
- generated vocab source;
- clean consumers;
- browser/server target separation.

## 26.3 Tests

- unit;
- property;
- conformance;
- differential;
- lifecycle/cancellation;
- corruption/recovery;
- real engine integration;
- cross-runtime contract tests;
- Kaiju differential extractor tests when that phase changes.

## 26.4 Benchmarks

Run the canonical Mitata suites and specialized process/compiler/browser harnesses.

A benchmark regression does not automatically block every change, but any material regression requires:

```text
measured value
absolute impact
relative impact
reason
benefit/trade-off
accept/reject decision
```

## 26.5 Builds and artifacts

- JSR package dry-run/check;
- npm build/dry-run if npm distribution is part of the release;
- generated declaration inspection;
- clean external consumer;
- tree-shaking bundle checks;
- source maps if emitted;
- no `.agents/`, benchmark raw dumps, local databases, or unrelated fixtures in published package.

## 26.6 Runtime smoke tests

Where supported:

```text
Deno
Node.js
Bun
browser Window
DedicatedWorker for OPFS sync paths
```

Engines/formats only claim the runtimes actually tested.

## 26.7 Documentation

- README purpose/ownership/composition updated;
- public API TSDoc updated;
- important internal invariants documented;
- architecture docs match implementation;
- examples run;
- generated docs/source manifests current;
- benchmark report linked to the decision it supports.

---

# 27. Risks and open questions

These questions should remain explicit until evidence resolves them.

## 27.1 How much RDF should be implemented natively?

Complete package ownership does not require immediately reimplementing every mature standards algorithm.

Likely early strategy:

```text
native
  RDF terms/dataset
  N-Triples/N-Quads
  Turtle/TriG if benchmark/correctness work justifies
  parser/event infrastructure

strategic upstream implementation behind our API
  JSON-LD algorithms
  RDFC-1.0 initially
  RDFa/Microdata initially
  RDF/XML if a mature parser is stronger
```

Revisit dependencies only with maintenance, bundle, correctness, or performance evidence.

## 27.2 Does the SPARQL event stream become public?

Keep it internal/semi-public until a formatter, editor, analyzer, or incremental parser proves a stable consumer need.

The event model is still valuable internally even if the stable public API starts with `parse()` and query-model output.

## 27.3 Does `@okikio/triplestore` execute SPARQL itself?

Initial answer: no requirement.

It should expose an efficient RDF Source/Store plus statistics. Comunica can query it. A future native query executor can be added when benchmarks show enough value.

Do not make persistence wait for a native optimizer.

## 27.4 Should generated schemas use Zod?

Default answer: Standard Schema directly, to minimize dependency/runtime cost and keep generated vocabularies ecosystem-neutral.

A Zod emitter is possible later.

Benchmark:

- emitted bytes;
- import cost;
- validation throughput;
- TypeScript cost;
- consumer demand.

## 27.5 How granular should generated Schema.org files be?

Benchmark compiler/runtime import costs before committing to thousands of public physical modules.

The developer API is already decided: direct named imports must remain possible.

## 27.6 Which triplestore indexes are default?

Workload evidence decides. Do not make an external library's six-index choice a universal truth.

## 27.7 Should parser hot paths use WASM?

Only after TypeScript profiles prove CPU/GC dominates and after accounting for:

- crossing cost;
- WASM startup;
- byte/string conversion;
- memory duplication;
- browser/server packaging;
- debugging complexity.

JavaScript can be exceptionally fast when the data path is simple and allocation is controlled.

---

# 28. Acceptance scenarios

The architecture is successful when these user stories are straightforward.

## 28.1 Small RDF use

```ts
import * as rdf from '@okikio/rdf';
import { Product, name } from '@okikio/vocab/schema';

const product = rdf.namedNode('https://example.com/product/1');
const graph = rdf.dataset([
  rdf.quad(product, rdf.type, Product),
  rdf.quad(product, name, rdf.literal('Widget')),
]);
```

No JSON-LD or engine code enters the bundle.

## 28.2 Parse a large RDF stream

```ts
import { parse } from '@okikio/rdf/nquads';

for await (const quad of parse(response.body!)) {
  await sink.add(quad);
}
```

Memory is bounded and returning early stops parser-owned reading.

## 28.3 Direct generated types

```ts
import { ProductSchema, type ProductType } from '@okikio/vocab/schema';

const product: ProductType = input;
const result = await ProductSchema['~standard'].validate(product);
```

No namespace-qualified `schema.ProductType` is required.

## 28.4 Local Oxigraph query

```ts
import * as oxigraph from '@okikio/oxigraph';
import * as sparql from '@okikio/sparql';

await using store = await oxigraph.open();
await store.load(source);

for await (const row of await store.queryBindings(query)) {
  // RDF terms preserved
}
```

## 28.5 Comunica over persistent store

```ts
import * as comunica from '@okikio/comunica';
import * as triplestore from '@okikio/triplestore';

await using graph = await triplestore.open(fileSystem, { path: '/graph' });
await using engine = await comunica.open({ sources: [graph] });

const rows = await engine.queryBindings(query);
```

## 28.6 Generate a custom vocabulary

```ts
import * as vocab from '@okikio/vocab/generate';

const model = await vocab.read([ontologySource, extensionSource]);
const output = vocab.emit(model, {
  name: 'example',
  context: 'https://example.com/vocab/',
});

await vocab.write(output, destination);
```

The generated package exposes direct term/type/schema imports.

## 28.7 Kaiju structured data

```text
captured JSON-LD
  -> @okikio/rdf/jsonld
  -> quads tagged to capture graph
  -> @okikio/sparql query
  -> fact candidates + evidence refs
```

A compact JSON-LD alias and a normal `schema:name` document produce equivalent semantic facts.

---

# 29. External libraries and standards to keep studying

The following sources are not all dependencies. They are architecture, conformance, baseline, or compatibility references.

## RDF/JSON-LD

- RDF/JS specifications and test suites: <https://rdf.js.org/>
- RDF 1.2 concepts: <https://www.w3.org/TR/rdf12-concepts/>
- JSON-LD 1.1: <https://www.w3.org/TR/json-ld11/>
- JSON-LD 1.1 API: <https://www.w3.org/TR/json-ld11-api/>
- Digital Bazaar jsonld.js: <https://github.com/digitalbazaar/jsonld.js>
- Digital Bazaar rdf-canonize: <https://github.com/digitalbazaar/rdf-canonize>
- RDFJS JSON-LD parser: <https://github.com/rdfjs-base/parser-jsonld>
- RDFJS JSON-LD serializer: <https://github.com/rdfjs-base/serializer-jsonld>
- RDFJS extended JSON-LD serializer: <https://github.com/rdfjs-base/serializer-jsonld-ext>
- Rubensworks JSON-LD context parser: <https://github.com/rubensworks/jsonld-context-parser.js>
- Rubensworks JSON-LD streaming parser: <https://github.com/rubensworks/jsonld-streaming-parser.js>
- Rubensworks Microdata RDF streaming parser: <https://github.com/rubensworks/microdata-rdf-streaming-parser.js>
- Janpot microdata-node, historical comparison: <https://github.com/Janpot/microdata-node>

## RDF stores and query engines

- Oxigraph: <https://github.com/oxigraph/oxigraph>
- Comunica: <https://github.com/comunica/comunica>
- Quadstore: <https://github.com/quadstorejs/quadstore>
- N3.js: <https://github.com/rdfjs/N3.js>

## Vocabularies and generation

- schema-dts: <https://github.com/google/schema-dts>
- Schema.org: <https://schema.org/>
- Fedify: <https://github.com/fedify-dev/fedify>
- ActivityStreams 2.0: <https://www.w3.org/TR/activitystreams-core/>
- SHACL: <https://www.w3.org/TR/shacl/>

## Web metadata extraction

- Metascraper: <https://github.com/microlinkhq/metascraper>

## SPARQL

- SPARQL 1.1 Query: <https://www.w3.org/TR/sparql11-query/>
- SPARQL 1.1 Update: <https://www.w3.org/TR/sparql11-update/>
- SPARQL 1.1 Protocol: <https://www.w3.org/TR/sparql11-protocol/>
- current SPARQL 1.2 work: <https://www.w3.org/TR/sparql12-query/>

## Standard Schema

- Standard Schema: <https://github.com/standard-schema/standard-schema>

## Code generation/tooling

- UnJS Knitwork: <https://github.com/unjs/knitwork>
- Oxc: <https://github.com/oxc-project/oxc>
- Oxc parser docs: <https://oxc.rs/docs/guide/usage/parser.html>
- Oxfmt: <https://oxc.rs/docs/guide/usage/formatter.html>

---

# 30. Internal project sources reviewed

The following project sources materially shaped this handoff.

## Architecture and programming model

- `library_first_architecture_guidebook(1).md`
- `Kaiju Platform Programming Model.md`
- `kaiju-crawl-architecture-capability-alignment-20260810(3).md`
- `kaiju-crawl-core-capability-set(3).md`
- `kaiju-platform-package-service-architecture-handoff(9).md`
- `kaiju-platform-postgres-packages-services-architecture(4).md`

Key lessons applied:

- library-first capability ownership;
- import-safe definitions/implementations;
- one-way dependency direction;
- correct data shape rather than stage frameworks;
- explicit resource ownership;
- verified current vs proposed target behavior;
- progressive/bounded processing;
- no compatibility wrapper solely because old code exists.

## Naming, formatting, comments, and documentation

- `kaiju-naming-and-folder-structure-guide.md`
- `kaiju-code-formatting-guide.md`
- `kaiju-readable-markdown-plain-technical-english-handbook.md`
- TSDoc/comment guidance from project skill/source material
- `architecture-diagram-guide.md`
- `when-to-not-use-mermaid-charts.md`
- `how-to-justify-decisions-properly.md`

Key lessons applied:

- concrete one-word names where context carries meaning;
- `Schema` and `Type` suffix rules;
- direct schema/type imports;
- namespaces for coherent operation call sites only;
- compact formatting without forced vertical expansion;
- comments explain invariants and reasoning;
- important internal symbols are documented;
- focused ASCII diagrams, not one master diagram;
- compare alternatives before calling a decision necessary.

## Kaiju semantic/web-analysis material

- `Kaiju Page Intelligence and Locale Planning.md`
- `Crawl File Formats Analysis.txt`
- `Resource Analysis Pipeline - Kaiju Crawl.txt`
- current Crawl structured-data research and implementation review from this project discussion

Key lessons applied:

- source-neutral semantic normalization;
- facts retain provenance/evidence;
- provider libraries do not become the architecture;
- use parsers for source truth;
- evaluate by domain-separated real corpora;
- progressive analysis and bounded handoff.

## OPFS material

Current `@okikio/opfs` adapter/design/environment documentation was reviewed through project sources.

Key lessons applied:

- filesystem semantics are separate from persistence/database semantics;
- adapter resources are borrowed unless ownership transfers explicitly;
- runtime-specific adapters stay behind subpaths;
- cross-runtime FileSystemType is the correct injection point for `@okikio/triplestore`;
- local coordination does not imply cross-process atomicity.

## Wikitext parser material

The Wikitext architecture/docs packed source was reviewed for:

- event well-formedness;
- source-backed range semantics;
- event streams as a fundamental parser interchange;
- optional tree materialization;
- findings-first `analyze()` then `materialize()`;
- streaming modes;
- determinism and recovery.

These ideas were adapted rather than copied mechanically. RDF quads remain the semantic output for RDF formats, while the SPARQL parser is the stronger candidate for a public findings/event lane.

## Benchmark and library skill pack

`skills(20260813-165657).zip` was reviewed, especially:

```text
skills/build-clis/references/benchmarking.md
skills/build-libraries/references/resources-performance.md
skills/build-libraries/references/data-oriented-design.md
skills/build-libraries/references/verification.md
skills/use-okikio/references/sparql.md
skills/use-okikio/references/wikitext.md
skills/deno-software/references/12-verification.md
```

Key benchmark rules applied:

- behavior before performance;
- benchmark questions, not random code fragments;
- deterministic named fixtures;
- semantic oracle outside the timed region;
- cold/warm separation;
- distributions rather than fastest sample;
- allocation, peak memory, retained memory, cleanup, and resource counts;
- repeated lifecycle plateau tests;
- bounded queues/backpressure;
- raw sample retention;
- end-to-end workload gates;
- reject data-layout complexity that does not clear a predeclared meaningful threshold.

---

# 31. Current upstream research findings carried into the design

## `schema-dts`

Recent project research reviewed the generator architecture plus active issues and merged pull requests.

Important findings:

- generator work is separated into triple reading, transforms, and TypeScript emission;
- recent work split schema-independent helper types into a smaller library;
- recent work exported concrete leaf types and added multi-type merging support;
- issue history shows real TypeScript compiler/language-server memory pressure from very large generated type graphs;
- external ontology/GS1 discussions expose assumptions around N-Triples, multiple ontologies, IRI shapes, and OWL semantics;
- custom-property discussions expose the tension between typo detection and open vocabulary extension;
- runtime string validation discussions expose the tension between zero-runtime type declarations and stronger validation.

The target design keeps the generator concept but generalizes its input, IR, output, and performance model.

## JSON-LD libraries

`jsonld.js` demonstrates mature expansion/compaction/framing and a first-class remote context subsystem.

`jsonld-context-parser` and `jsonld-streaming-parser` demonstrate that context resolution and progressive RDF quad output can be separated and composed.

The RDFJS JSON-LD parser already wraps the streaming parser behind RDFJS Sink semantics.

The extended RDFJS serializer demonstrates that rich JSON-LD output needs more than a trivial quad-to-expanded-object loop.

## Fedify

Fedify's generated Activity Vocabulary layer demonstrates useful patterns:

- declarative vocabulary metadata;
- typed class/property APIs;
- JSON-LD serialization/deserialization;
- reference vs dereferenced object behavior;
- generated documentation/context behavior.

The Okikio generator should learn from that structure without forcing ActivityPub-specific semantics into generic RDF.

## Metascraper

Metascraper's strongest transferable design is modular prioritized extraction and failure isolation per property.

Kaiju should not copy “first successful value wins” as its final truth model. Kaiju retains evidence, alternatives, confidence, and provenance, then resolves candidates later.

---

# 32. Final architecture statement

The target is not “turn `sparql-client` into a package that imports every RDF library.”

The target is a coherent semantic-data library family:

```text
@okikio/rdf
  complete RDF programming model and format capability family

@okikio/sparql
  complete SPARQL language/query/protocol model

@okikio/vocab
  RDF ontology -> terms + TypeScript types + Standard Schema + manifests

@okikio/triplestore
  persistent indexed RDF dataset using an injected filesystem

@okikio/oxigraph
  explicit Oxigraph/WASM integration

@okikio/comunica
  explicit Comunica/RDFJS/federation integration
```

The packages share stable semantic contracts but keep their heavy dependencies and lifecycle separate.

The public developer experience follows two intentional patterns:

```ts
// coherent operation families
import * as rdf from '@okikio/rdf';
import * as sparql from '@okikio/sparql';

// exact generated terms/types/schemas
import {
  Product,
  ProductSchema,
  name,
  offers,
  type ProductType,
} from '@okikio/vocab/schema';
```

Parsing is designed from the data path:

```text
source ranges
  -> minimal scanner state
  -> structured events where useful
  -> semantic quads or query model
  -> optional materialization/algebra
```

Persistence is designed as a database rather than a filesystem naming trick.

Generation is designed as ontology compilation rather than Turtle-to-string templates.

Performance is designed as a workload contract with correctness oracles, cold/warm separation, memory/lifecycle evidence, stress tests, and raw benchmark artifacts.

Kaiju Crawl is the first major real consumer: normalize JSON-LD, Microdata, and RDFa into one standards-aware semantic representation, then derive facts without discarding the raw public evidence that supports them.

That architecture lets `@okikio/sparql` evolve with RDF 1.2, SPARQL 1.2, new vocabularies, new stores, new engines, and new serialization formats without making any one current parser, endpoint, WASM engine, persistence backend, or generated ontology the center of the system.
