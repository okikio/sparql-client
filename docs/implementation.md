# Implementation ledger

**Correction/completion pass:** 2026-08-15

This ledger records the implementation state after the monorepo architecture was re-audited for Standard Schema support, vocabulary generation, cross-package SPARQL composition, permanent test/benchmark ownership, and source documentation quality.

It should be read together with:

- [`architecture.md`](./architecture.md) for current package ownership and lifecycle
- [`standard-schema.md`](./standard-schema.md) for generated runtime-validation semantics
- [`vocabulary-generation.md`](./vocabulary-generation.md) for the `ttl-to-ts` replacement
- [`sparql-mapping.md`](./sparql-mapping.md) for SPARQL grammar/API mapping
- [`testing.md`](./testing.md) for permanent test ownership
- [`benchmarks.md`](./benchmarks.md) for measured design decisions
- [`../VALIDATION.md`](../VALIDATION.md) for passed and blocked gates

## Package model

The repository has six independently usable packages:

```text
@okikio/rdf
    +--> @okikio/sparql
    |       +--> @okikio/oxigraph
    |       +--> @okikio/comunica
    +--> @okikio/vocab
    +--> @okikio/triplestore
```

This dependency direction is intentional:

- RDF defines terms, datasets, parsers, ontology/shape models, and interoperability.
- SPARQL depends on RDF terms but not on a vocabulary generator or query engine.
- Vocab compiles RDF ontology models into developer-facing code.
- Engine packages adapt external engines to SPARQL's generic query/update contract.
- Triplestore persists RDF datasets and depends only on RDF semantics plus the injected filesystem contract.

Generated vocabulary constants are RDF `NamedNode` values. They therefore compose with SPARQL directly without adding a `@okikio/vocab` dependency to `@okikio/sparql`.

## Standard Schema

Standard Schema is now a first-class generated vocabulary contract rather than an undocumented implementation detail.

`@okikio/vocab/standard` defines dependency-free structural contracts for:

- Standard Typed v1
- Standard Schema v1
- Standard JSON Schema v1

Generated class schemas implement both runtime validation and JSON Schema conversion through the same `~standard` object.

Example generated surface:

```ts
import {
  Product,
  ProductSchema,
  type ProductPropertiesType,
  type ProductType,
} from '@okikio/vocab/schema'
```

The contracts remain open-world. RDFS/OWL domain/range statements are not converted into JSON requiredness or cardinality. Those stricter data-shape rules belong to SHACL or another explicit validation profile.

The official `@standard-schema/spec` package is a test/type compatibility oracle in the Deno configuration, not a production runtime dependency.

## `ttl-to-ts` replacement

The old `scripts/ttl-to-ts.ts` concept has been decomposed rather than renamed.

The reusable library API is:

```ts
import { compile } from '@okikio/vocab/compile'
```

Its stable input is RDF quad sources, not Turtle text:

```text
RDF serialization / Dataset / store
              |
              v
       RDF parser/source
              |
              v
          RDF quads
              |
              v
   @okikio/rdf/ontology
              |
              v
     @okikio/vocab.read
              |
              v
 deterministic name planning
              |
              v
     @okikio/vocab.emit
              |
              v
 TypeScript source + manifest
```

This means Turtle, TriG, N-Triples, N-Quads, JSON-LD, RDF/XML, an in-memory Dataset, a triplestore, or a future RDF source can feed the same compiler.

Executable wrappers remain thin:

- `.mise/tasks/vocab.ts` owns local file reading, format selection, output writing, and calls `compile()`.
- `.mise/tasks/schema.ts` owns pinned Schema.org download/identity verification, passes parsed N-Quads through `compile()`, and writes the generated module/manifest.

Ontology interpretation and TypeScript emission do not live in task scripts.

## SPARQL re-audit

The original SPARQL implementation was not using the new RDF contracts consistently. The completion pass found and fixed concrete semantic defects rather than adding adapters around them.

### Grammar roles are distinct

SPARQL syntax values are now branded by their actual grammar role:

```text
term
expression
graph pattern
complete query
complete update
```

A complete query no longer masquerades as an embeddable WHERE pattern. A complete update is not a generic SPARQL fragment. Property paths and RDF 1.2 triple terms are represented as terms where the grammar permits them.

### Native RDF terms remain native

IRI-bearing builder surfaces accept RDF `NamedNode`s. Predicate and graph terms are not flattened to strings internally.

This fixes composition such as:

```ts
import * as schema from '@okikio/vocab/schema'
import { select, triple } from '@okikio/sparql'

const query = select('?name')
  .where(triple('?product', schema.name, '?name'))
  .build()
```

The SPARQL package uses RDF/XSD constants from `@okikio/rdf` rather than maintaining duplicate IRI strings.

### Query construction fixes

The audit corrected:

- predicate variables such as `?p` being serialized as prefixed names
- CONSTRUCT template and WHERE pattern being conflated
- UNION serialization
- DESCRIBE RDF named-node support
- graph/prefix/service/property-path RDF term handling
- VALUES `UNDEF`
- expression versus graph-pattern return types
- immutable DISTINCT/REDUCED behavior
- subquery/document typing

### Update fixes

The audit corrected:

- `INSERT DATA` / `DELETE DATA` graph-position validation
- named graph serialization for COPY/MOVE/ADD
- DEFAULT/NAMED/ALL handling for CLEAR/DROP
- build paths that accidentally quoted complete update syntax
- distinct DELETE/INSERT/WHERE template state

### Object-pattern helper fixes

The legacy Node/Relationship/Cypher convenience layer now preserves RDF predicates instead of converting them to strings.

The audit also fixed:

- undeclared `rdf:` prefixes in relationship reification
- reverse relationship direction
- generated vocabulary predicates inside Node/Relationship patterns
- RDF IRI endpoint handling during reification

### Engine contract

`Queryable` now distinguishes query from update input and exposes the public operation:

```ts
update(update, options?)
```

Comunica's upstream `queryVoid()` name exists only in the private adapter shim. It is not part of the generic SPARQL contract.

Oxigraph and Comunica remain separate packages so SPARQL construction has no engine dependency.

## HTTP lifecycle

The SPARQL HTTP reader previously checked cancellation before `ReadableStreamDefaultReader.read()` but could not interrupt a read that was already pending.

The response reader now:

- listens to the operation signal while a read is pending
- cancels the reader on abort
- rejects with the abort reason
- cancels incomplete owned response bodies
- enforces configured response byte limits

Permanent tests cover SELECT/graph media modes, media mismatches, update endpoint/content type, errors, size limits, and stalled pending-read cancellation.

## Vocabulary compiler correctness

The naming pass previously allowed source order to decide which colliding IRI received a canonical TypeScript symbol. Classes, properties, and datatypes are now sorted by IRI before symbol claims, so equivalent ontology inputs produce the same public names regardless of source-file ordering.

The emitter composes parent schemas instead of copying every inherited property descriptor. This preserves inherited runtime validation while avoiding the O(n^2) generated-source growth found by the compiler benchmark.

Generated output includes TSDoc for namespace terms, datatypes, properties, property interfaces, node types, schemas, and multi-type helpers. Regeneration therefore does not erase the documentation quality pass.

## Permanent test ownership

The previous snapshot incorrectly tracked assistant validation assets under `.agents/`. The entire tracked `.agents/` tree has been removed and `.gitignore` now reserves it for disposable assistant-only use.

Permanent behavior tests are co-located with their packages and use `node:test` plus `@std/expect`.

Current owned suite:

```text
42 *_test.ts files
138 tests in the external fallback run
138 passing
```

New or materially expanded permanent coverage includes:

- RDF term/source/write/namespace contracts
- line formats and streaming cancellation
- RDF/XML/RDFa/Microdata lifecycle
- ontology and SHACL loss preservation
- SPARQL grammar roles, query builders, update builders, Cypher/object helpers, results, HTTP, and package composition
- Standard Schema and Standard JSON Schema
- vocabulary compile/read/name/runtime behavior
- triplestore format/recovery contracts
- engine adapter query/update and ownership behavior

The fallback runner is outside the repository. Deno remains canonical.

## Benchmark ownership

There are nine durable benchmark programs:

```text
packages/rdf/dataset_bench.ts
packages/rdf/nquads/parse_bench.ts
packages/rdf/turtle/parse_bench.ts
packages/sparql/builder_bench.ts
packages/sparql/syntax/scan_bench.ts
packages/triplestore/store_bench.ts
packages/vocab/compile_bench.ts
packages/vocab/runtime_bench.ts
bench/vocab/types.ts
```

The first eight are Mitata runtime programs. `.mise/tasks/bench.ts` discovers them and executes each in its own Deno process. `bench/vocab/types.ts` remains a separate compiler/process benchmark.

The canonical task no longer routes Mitata files through `deno bench`.

Previously measured benchmark results that changed architecture are retained as design evidence in `docs/benchmarks.md`; raw assistant output is not part of the repository.

## Documentation quality

The source documentation pass covers exported and non-exported production declarations.

External AST audit result:

```text
1,131 declarations
1,131 documented
0 missing
```

The audit includes implemented methods/accessors/constructors and private top-level helpers. A second quality pass removed generic filler TSDoc and replaced it with comments about actual contracts and invariants, including:

- parser buffering, cursor offsets, recovery, and resource limits
- Web Stream / Node Transform cancellation ownership
- RDF/XML directional literal adaptation
- SHACL discovery, version retention, list/path limits, and invalid assertion preservation
- ontology inference versus validation semantics
- deterministic vocabulary symbol planning
- generated-schema parent traversal and cycle handling
- SPARQL grammar role and immutable builder behavior
- HTTP pending-read cancellation
- triplestore commit publication, checksum verification, recovery, and borrowed filesystem ownership

A numeric coverage gate is not considered proof that prose is useful, which is why both passes are recorded separately.

## Canonical repository tasks

The root npm scripts only delegate to Deno. They do not define a second Node lifecycle.

```text
deno task fmt
deno task lint
deno task check
deno task test
deno task bench
deno task bench:types
deno task bench:all
deno task verify
deno task vocab
deno task vocab:schema
```

`verify` covers formatting, lint, strict checking, and permanent tests. Runtime benchmarks and compiler benchmarks are explicit performance gates rather than being hidden inside correctness verification.

## Validation result

The current external-host result is:

```text
strict TypeScript                         PASS
noUnusedLocals/noUnusedParameters         PASS
package-owned fallback tests              138 / 138 PASS
production declaration TSDoc coverage     1,131 / 1,131
six npm pack content audits               PASS, zero leaks
```

The authoritative detailed record is `VALIDATION.md`.

## Unresolved publication gates

This implementation should not be called fully release-validated yet.

Still required on an appropriate host:

1. canonical Deno format/lint/check/test gates
2. canonical Mitata and compiler benchmark execution under Deno
3. real optional JSON-LD/RDFC/RDF/XML/RDFa/Microdata processor integration
4. real Oxigraph and Comunica integration
5. applicable W3C/upstream conformance suites
6. full pinned Schema.org 30.0 generation and generated-module check
7. npm JavaScript distribution/runtime-matrix decision

SPARQL 1.2 and SHACL 1.2 are draft families as of this implementation date, so their supported feature profiles must remain versioned and testable rather than being baked into an unversioned claim of final conformance.

## Changed-file appendix

The appendix is generated from the final Git diff so review can distinguish the tracked `.agents/` deletion from functional/package/documentation changes.

<!-- CHANGED_FILES_START -->

### Deleted (61)

- `.agents/benchmark.ts`
- `.agents/canon.test.ts`
- `.agents/compact.test.ts`
- `.agents/deno.d.ts`
- `.agents/engines.test.ts`
- `.agents/generate-bootstrap-schema.ts`
- `.agents/generate-real-vocab.ts`
- `.agents/generated-narrative.ts`
- `.agents/generated-tsconfig.json`
- `.agents/html-semantic.test.ts`
- `.agents/jsonld.test.ts`
- `.agents/jsonld.ts`
- `.agents/memory-fs.ts`
- `.agents/microdata-rdf-streaming-parser.ts`
- `.agents/mitata.ts`
- `.agents/node-test.ts`
- `.agents/ontology.test.ts`
- `.agents/packs/comunica.json`
- `.agents/packs/oxigraph.json`
- `.agents/packs/rdf.json`
- `.agents/packs/sparql.json`
- `.agents/packs/triplestore.json`
- `.agents/packs/vocab.json`
- `.agents/public.test.ts`
- `.agents/rdf-canonize.ts`
- `.agents/rdf.test.ts`
- `.agents/rdfa-streaming-parser.ts`
- `.agents/rdfxml-streaming-parser.ts`
- `.agents/recovery-profile.ts`
- `.agents/results/benchmark.json`
- `.agents/results/benchmark.stdout.json`
- `.agents/results/final-benchmark.json`
- `.agents/results/final-benchmark.stdout.json`
- `.agents/results/final-check.txt`
- `.agents/results/final-generate-real.txt`
- `.agents/results/final-generated-check.txt`
- `.agents/results/final-host-tests.tap`
- `.agents/results/final-pack.json`
- `.agents/results/final-package-tests.tap`
- `.agents/results/package-tests.tap`
- `.agents/results/release-check-after-ledger.txt`
- `.agents/results/release-check.txt`
- `.agents/results/release-generate-real.txt`
- `.agents/results/release-generated-check.txt`
- `.agents/results/release-host-tests.tap`
- `.agents/results/release-pack.json`
- `.agents/results/release-package-tests.tap`
- `.agents/results/release-stale-api.txt`
- `.agents/results/types-after.stdout.json`
- `.agents/results/types-before-schema-composition.json`
- `.agents/results/types.json`
- `.agents/results/types.stdout.json`
- `.agents/shape.test.ts`
- `.agents/sparql.test.ts`
- `.agents/std-expect.ts`
- `.agents/triplestore.test.ts`
- `.agents/tsconfig.json`
- `.agents/type-benchmark.ts`
- `.agents/vocab-real.test.ts`
- `.agents/vocab.test.ts`
- `.agents/xml.test.ts`

### Modified (74)

- `.gitignore`
- `.mise/tasks/schema.ts`
- `.mise/tasks/vocab.ts`
- `AGENTS.md`
- `README.md`
- `VALIDATION.md`
- `deno.json`
- `docs/architecture.md`
- `docs/benchmarks.md`
- `docs/implementation.md`
- `docs/quick-start.md`
- `docs/sparql-mapping.md`
- `package.json`
- `packages/comunica/README.md`
- `packages/comunica/mod.ts`
- `packages/comunica/mod_test.ts`
- `packages/oxigraph/README.md`
- `packages/oxigraph/mod.ts`
- `packages/oxigraph/mod_test.ts`
- `packages/rdf/README.md`
- `packages/rdf/canon/mod.ts`
- `packages/rdf/compact.ts`
- `packages/rdf/dataset.ts`
- `packages/rdf/dataset_test.ts`
- `packages/rdf/factory.ts`
- `packages/rdf/jsonld/loader.ts`
- `packages/rdf/jsonld/mod.ts`
- `packages/rdf/line.ts`
- `packages/rdf/microdata/mod.ts`
- `packages/rdf/microdata/mod_test.ts`
- `packages/rdf/ontology/index.ts`
- `packages/rdf/ontology/read.ts`
- `packages/rdf/rdfa/mod.ts`
- `packages/rdf/rdfa/mod_test.ts`
- `packages/rdf/shape/index.ts`
- `packages/rdf/shape/list.ts`
- `packages/rdf/shape/path.ts`
- `packages/rdf/shape/read.ts`
- `packages/rdf/term.ts`
- `packages/rdf/text.ts`
- `packages/rdf/transform.ts`
- `packages/rdf/write.ts`
- `packages/rdf/xml/mod.ts`
- `packages/rdf/xml/mod_test.ts`
- `packages/sparql/README.md`
- `packages/sparql/builder.ts`
- `packages/sparql/client.ts`
- `packages/sparql/http/error.ts`
- `packages/sparql/http/mod.ts`
- `packages/sparql/http/mod_test.ts`
- `packages/sparql/mod.ts`
- `packages/sparql/patterns/cypher.ts`
- `packages/sparql/patterns/objects.ts`
- `packages/sparql/patterns/triples.ts`
- `packages/sparql/result/json.ts`
- `packages/sparql/sparql.ts`
- `packages/sparql/syntax/scan.ts`
- `packages/sparql/syntax/scanner.ts`
- `packages/sparql/syntax/source.ts`
- `packages/sparql/update.ts`
- `packages/sparql/utils.ts`
- `packages/triplestore/README.md`
- `packages/triplestore/format.ts`
- `packages/triplestore/store.ts`
- `packages/triplestore/store_test.ts`
- `packages/vocab/README.md`
- `packages/vocab/deno.json`
- `packages/vocab/emit.ts`
- `packages/vocab/mod.ts`
- `packages/vocab/name.ts`
- `packages/vocab/package.json`
- `packages/vocab/read.ts`
- `packages/vocab/runtime.ts`
- `packages/vocab/schema/mod.ts`

### Added (untracked in baseline) (33)

- `.mise/tasks/bench.ts`
- `docs/research/architecture-design-20260814.md`
- `docs/standard-schema.md`
- `docs/testing.md`
- `docs/vocabulary-generation.md`
- `packages/rdf/namespace_test.ts`
- `packages/rdf/source_test.ts`
- `packages/rdf/term_test.ts`
- `packages/rdf/text_test.ts`
- `packages/rdf/write_test.ts`
- `packages/sparql/builder_bench.ts`
- `packages/sparql/builder_test.ts`
- `packages/sparql/client_test.ts`
- `packages/sparql/composition_test.ts`
- `packages/sparql/http/error_test.ts`
- `packages/sparql/patterns/cypher_test.ts`
- `packages/sparql/patterns/objects_test.ts`
- `packages/sparql/patterns/triples_test.ts`
- `packages/sparql/result/binding_test.ts`
- `packages/sparql/result/json_test.ts`
- `packages/sparql/sparql_test.ts`
- `packages/sparql/update_test.ts`
- `packages/sparql/utils_test.ts`
- `packages/triplestore/format_test.ts`
- `packages/vocab/compile.ts`
- `packages/vocab/compile_bench.ts`
- `packages/vocab/compile_test.ts`
- `packages/vocab/name_test.ts`
- `packages/vocab/read_test.ts`
- `packages/vocab/runtime_bench.ts`
- `packages/vocab/runtime_test.ts`
- `packages/vocab/standard.ts`
- `packages/vocab/standard_test.ts`

<!-- CHANGED_FILES_END -->
