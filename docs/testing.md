# Testing and validation

For the local runtime loop, run `deno task test`, then choose the affected real-environment lanes from
[VALIDATION.md](../VALIDATION.md). Run `deno task verify` for the full source contracts on CI or an isolated runner.
Test definitions belong to the capability they protect; generated output and local investigations have separate lifetimes.

## Permanent tests

Permanent behavior tests are co-located with the package that owns the behavior:

```text
packages/rdf/**/*_test.ts
packages/sparql/**/*_test.ts
packages/vocab/**/*_test.ts
packages/triplestore/**/*_test.ts
packages/oxigraph/**/*_test.ts
packages/comunica/**/*_test.ts
```

Tests use `node:test` for test structure and `@std/expect` for expectations. Deno remains the canonical runtime used by the project tasks.

A test belongs beside the capability it specifies. Do not create a permanent centralized `tests/` directory to hold package behavior.

Examples of ownership:

```text
RDF/XML grammar/cancellation packages/rdf/xml/mod_test.ts
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
deno task integration
deno task browser
deno task consumer
deno task consumer:linux
```

`verify` runs the formatting check, lint, strict type check, core dependency firewall, documentation lint, and permanent tests.

`test`, `test:release`, `integration`, and `integration:storage` run Deno tests with `--no-check`.
Focused local runs must use it too, for example:

```sh
deno test --no-check packages/rdf/shape/inspect_test.ts
```

On a workstation where type checking has caused memory spikes, keep `check`, `check:release`, `verify`,
`release-check`, `release:prepare`, and installed-consumer type checks on CI or an isolated runner with a memory
budget. Run compiler-cost benchmarks (`bench:types` and `bench:all`) there too. Keep checking serial and separate
from runtime tests and benchmark measurement. The test flag does not disable compiler subprocesses inside tests
or tooling and does not bound the tested code's memory use. Record runtime and static validation separately;
release and JSR publication gates still require static validation.

The dependency firewall parses TypeScript imports and exports rather than matching lines or comments. It rejects
computed dynamic imports and runtime references outside the four owned core packages, including relative traversal and
symlink escapes. Type-only references remain separate because they are erased from runtime code. Its pinned compiler
is a development tool; it does not enter the published core packages.

Distribution checks inspect Deno's resolved runtime graph for the actual public browser consumers. Ordinary strings
that mention an optional engine cannot fail that check, while a reachable external module cannot pass merely because
its package name changed. npm and JSR export maps must expose the same names and targets; object insertion order is
incidental. Permanent controls challenge each boundary with valid harmless changes and prohibited runtime edges.

The root npm scripts are only aliases to the Deno tasks. They do not define a second Node project lifecycle.

The package task writes `.tmp/packages/artifacts.json` only after source inputs remain unchanged throughout packing.
Installed consumers require that receipt, the exact current name/version/archive set, and matching SHA-256 archive
bytes. They also compare the installed first-party payload with extracted archive members. Same-version source edits,
extra or stale archives, and a modified installed tree fail before runtime or Linux validation. Receipt and tarballs
travel together in CI. Rebuild on CI or an isolated runner after changing package inputs; `package` includes a JSR
dry-run and can invoke type checking. Root runtime-test task edits and JSON record order do not invalidate an archive.

The package task preserves generated JavaScript exports and resolves workspace dependency versions in the actual
archives. Its tar child suppresses macOS AppleDouble files and extended-attribute headers. When changing packaging,
inspect archive members and payloads, then run the clean installed consumers; a successful build alone cannot establish
the contents that a user will install.

## Benchmarks

Hot runtime benchmarks are package-owned `*_bench.ts` Mitata programs. `deno task bench` discovers them through `.mise/tasks/bench.ts` and runs each in an isolated Deno process.

The [benchmark guide](benchmarks.md) maps every permanent program to its workload and correctness oracle. Primitive
measurements locate costs; parser ingestion, engine adapters, compiler consumers, and store recovery measure their
different composed workflows. These questions require separate inputs and interpretations.

`bench/vocab/types.ts` is intentionally outside a package because it is a cross-process TypeScript compiler benchmark. It launches isolated compiler processes and measures a different resource lifecycle from a hot in-process kernel.

Every benchmark needs a correctness oracle outside the timed callback. Faster output is not accepted if it performs less work or changes semantics.

Fast report-contract tests also belong to the canonical unit gate. They reject missing, failed, nonfinite or incomplete
measurement data without running a benchmark. Fault-injection investigation transcripts remain local evidence; the
reusable validity contract remains in source.

SPARQL builder property tests use `@traqula/parser-sparql-1-2` as the independent parser oracle. Traqula is an active SPARQL 1.2 parser and runs the W3C SPARQL parser suites in its own repository. The project does not treat Traqula as specification authority: official W3C tests remain the conformance source, and known upstream parser defects become differential fixtures rather than behavior to copy. Archived SPARQL.js is not a direct project oracle.

See [`research/dependencies.md`](./research/dependencies.md) for comparator roles and known-defect profiles.

## Review the oracle before the pass count

A test should state the consumer behavior that would break if its assertion failed. Use exact bytes for persisted
content, exact terms and graph identity for RDF, and exact lexical ranges where tooling exposes those ranges. Protocol
signatures and deliberate canonical serialization also need exact assertions. Generated comments, private counters,
incidental iteration order, and human-readable error wording usually do not define the consumer contract.

For emitted vocabulary code, import its exports and check their values, schema results, and consumer types. For a
dataset property, compare with an independent term/quad model rather than constructing its expected result through the
same dataset implementation. Validate official fixture reads before entering a negative parser assertion: missing files
must fail setup rather than pass as malformed syntax.

Use [Node test lifecycle hooks](https://nodejs.org/api/test.html) or `try/finally` to register cleanup as soon as a resource
is acquired. Test-scoped mocks restore their patched methods automatically; a global tracker requires explicit reset.
Injected protocol doubles remain useful when they make bytes, retries, cancellation, and ownership observable across
runtimes. Await the source's explicit pull/open signal before aborting pending work; a microtask or short sleep does not
prove that the operation reached the intended state. When cancellation promises to preserve the caller's reason,
assert the same reason object rather than its message. Use a test deadline around a deliberately stalled source so a
regression terminates with a failed test; that deadline is a hang guard, not a performance target.

For graph-pattern builders, parse a complete query with independently written expected terms. Keep projection and
clause roles, triple multiplicity, and ordered syntax visible while permitting harmless whitespace and basic graph
pattern conjunction order. For scanner benchmarks, compare every public token and range field independently of
record property insertion order; token order and range values remain exact.

[Standard-library expectations](https://jsr.io/@std/expect/doc) include `rejects`, `resolves`, partial object matching,
and asymmetric matchers. Select the assertion that expresses the contract. Partial matching is appropriate for a
structured error's stable fields; it must not weaken a test that promises the complete result set. Framework features
are useful when they make an invariant clearer, not because every test must use every feature.

Challenge an oracle with a deliberately wrong result or broken fixture when a false pass is plausible. Keep that
investigation local; retain the useful invariant in the permanent test. Passing proves only the asserted behavior for
the executed scenario.

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
integration/browser/     real Window/Worker and optional sibling OPFS consumers
integration/storage/     source and installed cross-repository persistence consumers
integration/consumer.ts  installed package behavior fixture
```

These are reusable inputs to canonical tasks, including slower release lanes that are intentionally outside the normal
unit gate. Keep them visible in Git. Downloaded corpora, generated configurations, consumer installations, browser
artifacts, timings, and dated plans/results belong under ignored `.tmp/`; assistant-only support belongs under ignored
`.agents/`. Do not ignore a permanent test to make the working tree quieter.

`deno task conformance` is strict: a skipped official case is a release failure, not a quiet success. `deno task support` validates the report schema, current implementation/evidence identity, pinned suite revisions, complete status records and totals, and requires passing cases for every profile advertised in `support.json`. Reusable malformed/stale-evidence controls run in the canonical unit suite; actual disposable Git cache controls run through `integration/cache_test.ts`.

See `conformance/source.ts` for immutable suite revisions and `docs/conformance.md` for the complete evidence flow.
