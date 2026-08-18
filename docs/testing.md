# Testing and validation

The repository has one permanent test architecture and one disposable assistant fallback.

## Permanent tests

Permanent behavior tests are co-located with the package that owns the behavior:

```text
packages/rdf/**/*_test.ts
packages/sparql/**/*_test.ts
packages/vocab/**/*_test.ts
packages/triplestore/**/*_test.ts
packages/jsonld-js/**/*_test.ts
packages/rdf-canonize/**/*_test.ts
packages/rdfxml-streaming-parser/**/*_test.ts
packages/rdfa-streaming-parser/**/*_test.ts
packages/microdata-rdf-streaming-parser/**/*_test.ts
packages/oxigraph/**/*_test.ts
packages/comunica/**/*_test.ts
```

Tests use `node:test` for test structure and `@std/expect` for expectations. Deno remains the canonical runtime used by the project tasks.

A test belongs beside the capability it specifies. Do not create a permanent centralized `tests/` directory to hold package behavior.

Examples of ownership:

```text
RDF/XML cancellation        packages/rdfxml-streaming-parser/mod_test.ts
SPARQL Update grammar       packages/sparql/update_test.ts
vocabulary compilation      packages/vocab/compile_test.ts
store recovery              packages/triplestore/store_test.ts
Comunica stream cleanup     packages/comunica/mod_test.ts
```

## `.agents/` policy

`.agents/` is **not** project test infrastructure.

It is reserved for temporary assistant-only validation support when this execution environment cannot run the canonical project tooling. It must not contain the authoritative copy of:

- tests
- benchmarks
- conformance fixtures
- expected outputs
- generated project artifacts
- release evidence
- reusable project scripts

It must not be committed or included in published packages. The repository ignores `.agents/` to make that rule explicit.

If an assistant-only test finds a real invariant, move that invariant into a package-owned test before calling the work complete.

## Canonical commands

The Deno project tasks are authoritative:

```sh
deno task fmt
deno task lint
deno task check
deno task test
deno task bench
deno task bench:types
deno task bench:all
deno task verify
```

`verify` runs the formatting check, lint, strict type check, core dependency firewall, documentation lint, and permanent tests.

The root npm scripts are only aliases to the Deno tasks. They do not define a second Node project lifecycle.

## Benchmarks

Hot runtime benchmarks are package-owned `*_bench.ts` Mitata programs. `deno task bench` discovers them through `.mise/tasks/bench.ts` and runs each in an isolated Deno process.

Current durable benchmark programs cover:

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

`bench/vocab/types.ts` is intentionally outside a package because it is a cross-process TypeScript compiler benchmark. It launches isolated compiler processes and measures a different resource lifecycle from a hot in-process kernel.

Every benchmark needs a correctness oracle outside the timed callback. Faster output is not accepted if it performs less work or changes semantics.

See [`benchmarks.md`](./benchmarks.md) for performance decisions that changed the architecture.

## Required test categories

The permanent suite should cover at least these categories as the implementation grows:

### Semantic correctness

- RDF term equality and RDF 1.2 term forms
- parser/serializer round trips where the format permits them
- SPARQL grammar position and document-role constraints
- ontology relationship interpretation
- SHACL loss preservation
- Standard Schema structural behavior

### Streaming and cancellation

- hostile source chunking
- early iterator return
- pending `ReadableStream.read()` cancellation
- upstream Node-stream destruction
- abort before and during operations where supported

### Persistence

- add/delete replay
- incomplete publication
- corrupt newest generation
- fallback to an older committed generation
- snapshot compaction
- borrowed-resource ownership
- behavior after close

### Integration

- generated RDF vocabulary terms inside SPARQL
- structured SPARQL query/update documents through engine adapters
- native processor options, limits, cancellation, and standards semantics
- RDF/JS conversion
- generated TypeScript compilation

### Pathological inputs

- cyclic ontology hierarchies
- cyclic SHACL paths
- malformed but recoverable RDF syntax
- deep generated inheritance
- naming collisions independent of source order
- bounded parser resource limits

## Upstream conformance

Injected substitutes are useful for testing adapter ownership and lifecycle, but they are not proof that the real third-party processor conforms.

Release validation should separately run:

- W3C RDF/N-Triples/N-Quads/Turtle/TriG suites
- W3C or upstream RDF/XML/RDFa/Microdata suites
- JSON-LD upstream/W3C suites
- RDFC-1.0 vectors
- SPARQL 1.1 and applicable 1.2 tests
- SHACL suites appropriate to the implemented version/profile
- real Oxigraph and Comunica integration

Keep those inputs as real project fixtures or reproducible external test tasks, not assistant scratch data.

## Documentation coverage

Important non-exported symbols are part of maintainability even though they are not public API. The source audit therefore covers top-level declarations plus implemented class methods, accessors, and constructors, including private implementation symbols.

The documentation gate should answer two separate questions:

1. Does every important declaration have TSDoc?
2. Do critical comments explain the invariant, ownership, failure behavior, or performance reason rather than restating the identifier?

A numeric coverage result answers only the first question. Scanner refill/rewind behavior, tolerant parse atomicity, store publication/recovery, ontology inference semantics, generated-schema inheritance, collision planning, and engine cancellation require substantive comments.

## Assistant fallback

When Deno/JSR is unavailable, an assistant may use an external Node harness to exercise the same package-owned tests. That harness is not part of the repository and does not replace Deno validation.

A final validation report must distinguish:

```text
canonical Deno gate: not run / pass / fail
external fallback:  not run / pass / fail
```

Never turn fallback success into a claim that Deno formatting, linting, JSR resolution, or Deno runtime behavior passed.

## Release evidence tasks

The normal package tests stay co-located with their implementation. Cross-package release evidence has separate ownership:

```text
conformance/             official standards runners and comparison oracles
integration/             real engine and Testcontainers tests
support.json             machine-readable public support claims
.mise/tasks/support.ts   claim-to-report verification
.mise/tasks/distribution.ts  optional-dependency/tree-shaking audit
```

`deno task conformance` is strict: a skipped official case is a release failure, not a quiet success. `deno task support` additionally requires at least one passing case for every standards profile advertised in `support.json`.

See `conformance/source.ts` for immutable suite revisions and `docs/conformance.md` for the complete evidence flow.
