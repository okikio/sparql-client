# Benchmark workloads and interpretation

For a parser change, first collect one equivalent-work cell with its semantic oracle:

```sh
BENCH_ONLY=packages/rdf/parse_compare_bench.ts BENCH_PARSE_FORMAT=N-Quads BENCH_PARSE_COUNT=10000 deno task bench:report
```

Use whole-document cases to compare completed parsing throughput. Use first-result latency to study consumers that stop after one quad; that measurement includes early-return cleanup and cannot establish whole-document speed. A timing comparison needs the same input, required output, runtime, options, and cleanup. Synthetic fixtures expose scale and mechanism; they do not stand in for every real corpus.

Benchmark definitions belong beside their owning packages, with cross-process measurements under `bench/` or `.mise/tasks/`. Generated reports and dated investigations belong in ignored `.tmp/reports/`, or CI artifacts. Keep host-specific numbers with the recorded source/runtime identity instead of turning one run into a permanent claim.

## Decide what the number can answer

| Workload                           | Consumer question                                                                        | Required correctness and interpretation                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Term/index/parser primitives       | What cost will repeated term creation, lookup, or parsing add to a larger pipeline?      | Consume the values; compare independent semantic results. A primitive improvement requires a composed workload before claiming end-to-end benefit.                                   |
| Whole-document and chunked parsing | How long does ingesting the complete RDF document take, and does chunk size change cost? | Same quad multiset or graph-isomorphic dataset, including graph, datatype, language and document scope. Setup stays outside timing; parser construction and consumption stay inside. |
| First quad and early return        | How quickly can an inspector obtain one fact and stop upstream work?                     | Correct first result and cleanup; this is a different workload from full ingestion.                                                                                                  |
| Dataset/store matching             | What does a known-term lookup cost compared with scanning the same dataset?              | Exact matching result set and unique fixture quads; broad/prefix filtering remains a separate question.                                                                              |
| Engine adapters                    | What cost does translating a real engine's results add for a query consumer?             | Same store, query, materialization and term values; release temporary owned Wasm wrappers.                                                                                           |
| Vocabulary compilation and schemas | What do vocabulary authoring, editor/compiler checks, and repeated validation cost?      | Compile/import actual generated exports and validate positive/negative consumers. Output size alone does not prove usable types.                                                     |
| Store replay/snapshot recovery     | What does reopening acknowledged state cost after mutation or compaction?                | Recover the same dataset through the intended segment path. Warm lookups cannot predict recovery cost.                                                                               |
| Installed storage fresh process    | What does runtime/module startup plus opening persisted application state cost?          | Exact file/range bytes, recovered RDF, and borrowed-filesystem usability. Process state is fresh; OS/filesystem caches remain warm or unknown unless explicitly controlled.          |

Measure retained memory separately from hot throughput. Finite lifecycle observations can reveal growth; they cannot prove the absence of all leaks. Allocation-heavy callbacks use the pinned Mitata GC controls deliberately, with an exposed collector. `gc('inner')` collects before and after a batch iteration and changes the measurement conditions; document that condition instead of calling it production GC behavior.

Retain raw samples and report units, fixture size, host/runtime/harness, concurrency, warmup, GC/cache state, and source/dependency identity. Use repeated comparable runs and effect size relative to host variation. Shared-host timings are diagnostic observations rather than hard latency gates. If percentile estimators differ, label them; a small sample's estimated p99 is not a production tail guarantee. Check the physical mechanism, such as fewer copies, parser allocations, requests, or index scans, before claiming a performance improvement.

The [Mitata documentation](https://github.com/evanwashere/mitata) describes result consumption, computed parameters, GC and fail-fast execution. The installed version in `deno.lock` governs each run. Review framework changes before changing sample or GC policy.

## Durable benchmark programs

Both `deno task bench` and `deno task bench:report` discover the twelve package-owned Mitata definitions and use the same process plan from `.mise/tasks/benchmarks.ts`. Programs run serially in a deterministic order, with the competitive parser matrix last. The competitive parser definition expands into one process per syntax and fixture size; the other eleven definitions each use one process.

Use `deno task bench:check` to run every program's correctness preflight without collecting timings. It imports generated vocabulary modules, exercises their schemas, compares complete RDF results, and checks query semantics before any Mitata callback runs. Measured tasks explicitly disable this mode so an inherited environment flag cannot turn a report into a preflight-only run.

| Program                                   | Equivalent work and oracle                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/comunica/adapter_bench.ts`      | Direct Comunica results versus its adapter, with the same source and query.             |
| `packages/oxigraph/adapter_bench.ts`      | Direct Oxigraph results versus its adapter, with the same store and query.              |
| `packages/rdf/dataset_bench.ts`           | Construction, exact indexes and pattern filtering against N3 Store and a semantic scan. |
| `packages/rdf/nquads/parse_bench.ts`      | Whole-document and chunked N-Quads parsing with equivalent quads.                       |
| `packages/rdf/parse_compare_bench.ts`     | Native/N3/Oxigraph syntax parsing, chunk boundaries and first-result latency.           |
| `packages/rdf/standards_compare_bench.ts` | Native JSON-LD, RDFC, RDF/XML, RDFa and Microdata versus independent processors.        |
| `packages/rdf/turtle/parse_bench.ts`      | Turtle parsing with equivalent dataset output.                                          |
| `packages/sparql/builder_bench.ts`        | Structured construction versus equivalent direct query assembly.                        |
| `packages/sparql/syntax/scan_bench.ts`    | Source-ranged streaming and materialized query syntax.                                  |
| `packages/triplestore/store_bench.ts`     | Indexed store lookups and corresponding matching quads.                                 |
| `packages/vocab/compile_bench.ts`         | Complete vocabulary inspect/name/emit compilation.                                      |
| `packages/vocab/runtime_bench.ts`         | Generated Standard Schema validation against the same values.                           |

`deno task bench:types` runs `bench/vocab/types.ts` separately. Its eleven fixtures cover flat/tree/deep inheritance, up to 1,000 classes or depth, and two/four/eight combined types. Each generated module is checked by an isolated TypeScript 5.9.3 compiler process. The report separates generation time/source bytes, compiler wall time, memory, instantiations and compiler diagnostics. Runtime throughput cannot substitute for this compiler cost.

The deep-1,000 fixture is an adversarial flattened inheritance workload, not a representative namespace.
It requires 500,500 effective property references, emitted in both interfaces and runtime schema descriptors.
Its explicit output cap is 128 MiB; every other fixture keeps the production 32 MiB output default.
All fixtures keep the 1,000,000 effective-property limit. An independent complete inherited-property identity
check runs before generation timing. Reports retain these limits, reference counts and actual emitted bytes,
so compiler cost can be interpreted alongside the generated output rather than class count alone.

Compiler preparation is explicit and outside every measured interval. An isolated TypeScript 5.9.3
`--version` invocation may download missing compiler bytes into the inherited `DENO_DIR`; a second
`--cached-only` invocation must then confirm the same pin before fixtures run. Neither invocation
uses the workspace config, lockfile or `node_modules`. This also works when release preparation
seeds only source caches into a fresh runner. Acquisition and offline-admission commands and raw
outputs are retained separately in the report. Compiler files and bundled declarations are hashed
after preparation and checked again after measurements. Every measured child remains cached-only:
a missing cache entry fails the workload instead of introducing network work into its timing.

The pinned compiler's `Memory used` field is heap usage rounded to decimal kilobytes: `K` represents 1,000 bytes. It is
one heap observation, not peak RSS or retained memory after a controlled collection. The child does not expose manual
GC. Compiler phase times are printed to hundredths of a second, so those fields have 10 ms resolution; the parent's
wall clock is a separate measurement. Keep raw diagnostics and require the declared metrics rather than accepting a
successful compiler exit with missing observations.

## Competitive benchmark matrix

- N-Triples, N-Quads, Turtle and TriG parsing compare the native implementation, N3 and Oxigraph.
- Streaming workloads include whole buffers, 64 B, 1 KiB, 4 KiB and 64 KiB chunks, deterministic hostile splits and first-result latency.
- Parser scales cover 100, 10,000 and 100,000 quads; `BENCH_LARGE=1` adds 1,000,000.
- Dataset workloads compare exact-term combinations and construction with N3 Store and a semantic scan. The large dataset fixture contains 100,000 unique quads.
- Standards workloads compare equivalent semantic output with independent JSON-LD, canonicalization and markup processors.
- Oxigraph and Comunica workloads compare direct engine calls with their `@okikio/*` adapters.

The regular parser fixtures use synthetic subjects and literals; they expose bulk scaling and chunk costs rather than representative Unicode or nesting distributions. The labeled blank-node canonicalization fixture does not characterize ambiguous symmetric worst cases. Add a traceable representative corpus or adversarial family before using these timings to make those claims.

The Dataset fixture correlates subject, predicate and graph values. Its exact-match combinations reveal index and scan costs for that layout; they do not model independent selectivity or a production hit/miss distribution. Whole-parser cases materialize and count each API's native result. Native and N3 whole-document cases both retain complete quad arrays, making N3 the closer bulk comparator. N3 literal accessors decode fields from its encoded term identity, while native literals store those fields eagerly; these cases still measure the representations supplied by their respective APIs. Oxigraph's lazy JavaScript term getters are checked in semantic preflight, but decoding every getter is outside those count timings. Use a separate complete-term-consumption workload before treating this comparison as the cost of supplying decoded RDF terms to an application.

Every group checks its semantic oracle before registering timed work. Fixture construction stays outside the callback, and callbacks consume results with `do_not_optimize()`. Allocation-heavy groups use inner GC where the workload requires it. Host load, runtime, fixture mode and cold/warm state must accompany any resulting comparison.

Mitata 1.0.34 retains only nonnegative heap deltas across batches and normalizes each delta by batch size. Those values are not total allocations, retained memory or RSS. A zero observation count with null aggregates means heap data is unavailable, rather than zero bytes. The report validator checks the complete pinned shape, finite nonnegative values and consistent bounds whenever optional heap or GC data is present; absent optional fields remain valid.

The default GC policy collects once after warmup. Inner GC collects before and after each batch. Its GC observations measure only the explicit collection after the batch, in nanoseconds per collection, without per-operation normalization. They are separate from operation latency; natural collection inside timed operations remains part of the timed cost.

With `BENCH_LARGE=1`, the parser matrix retains all sixteen cells: four syntaxes at 100, 10,000, 100,000 and 1,000,000 quads. Each cell retains nine timed cases: native/N3/Oxigraph whole-document parsing, four native chunk sizes, hostile splits and native first-result latency. That is 144 parser cases across sixteen isolated processes, plus the other eleven benchmark processes. Process isolation changes fixture lifetime; it does not reduce scales, competitors, semantic checks or Mitata sampling.

Each child starts with `--v8-flags=--expose-gc`, so the parser's `.gc('inner')` requests have an exposed collector. Materialized semantic-oracle arrays stay within short-lived function activations rather than benchmark closures. Temporary Oxigraph Wasm result and term wrappers are released after their values are consumed, including failure paths; the benchmark does not dispose a caller-owned engine. A process exit then retires the completed cell's strings, chunk fixtures and runtime heap before the next cell starts. Process isolation prevents completed cells from accumulating their fixtures in the next cell. It does not establish a universal resource limit.

## Reproduction and report lifetime

```sh
deno task bench
BENCH_LARGE=1 deno task bench:report
deno task bench:types
deno task bench:storage
```

The runners permit environment access for Mitata/engine initialization and `--allow-read=node_modules,packages` for package fixtures and engine WASM assets. Invoking a benchmark file directly must preserve those child-process permissions:

```sh
deno run --v8-flags=--expose-gc --allow-env --allow-read=node_modules,packages packages/rdf/parse_compare_bench.ts
```

For a focused diagnostic cell, preserve the same permissions and sample policy while selecting the explicit fixture:

```sh
BENCH_LARGE=1 BENCH_ONLY=packages/rdf/parse_compare_bench.ts BENCH_PARSE_FORMAT=N-Quads BENCH_PARSE_COUNT=1000000 deno task bench:report
```

Unset `BENCH_ONLY`, `BENCH_PARSE_FORMAT` and `BENCH_PARSE_COUNT` for the full matrix. The shared plan validates those selectors and records each completed child's name, environment and arguments. A focused result is evidence for its selected cell, not completion of the full matrix.

`bench:report` selects Mitata JSON output with `BENCH_FORMAT=json`. Each invocation atomically creates its own directory with a timestamp prefix and random suffix, then writes `meta.json` before collecting samples. Concurrent starts cannot overwrite each other's metadata. Every program retains raw JSON stdout and a separate `.stderr` file, including unsuccessful runs. Metadata records the exact child arguments, runtime, CPU/OS/memory, large-fixture mode, elapsed time, exit code and SHA-256 identities for package TypeScript, benchmark source and pinned configuration.

Native report capture streams each pipe into a preopened file and awaits every partial write before reading more.
stdout and stderr each have an independent 128 MiB retained-byte quota. This is deliberate admission headroom over
an observed 32 MiB truncation, not a typical report size or a performance budget. The failing dataset report had
all 23 measured runs and 8,842 measured samples before its calibration array exhausted the old memory collector.
The new collector keeps both measured and calibration samples. Exceeding a quota retains the admitted prefix and
fails collection; an incomplete file is never parsed as a successful report. Capture failures retain their stage
separately from the direct child's actual exit code and signal.

After file-open and child acquisition, the twenty-minute child watchdog covers output capture and owned retirement.
Acquisition remains inside the isolated runner's outer watchdog. The child timer stops only that direct child;
inherited descendant pipes or an uncooperative native disk call still require the isolated runner's outer watchdog.
JSON decoding uses fatal UTF-8 and a file-size-bounded read after successful collection. This validation still
materializes the complete admitted JSON and its arrays, outside Mitata's measured callbacks. Streaming capture
does not make JSON parsing constant-memory or establish power-loss durability of the evidence files.
`elapsedMs` remains total runner lifecycle. `captureElapsedMs` records acquisition, child execution, pipe capture
and file close; `validationElapsedMs` records subsequent raw-file admission and validation. These milliseconds
are orchestration observations, separate from Mitata's nanosecond operation samples. Compiler and human-output
callers retain their existing separate 32 MiB in-memory collector.

The runner saves progress after each program. A nonzero child exit fails the report while preserving its evidence. After all programs finish, the runner hashes its inputs again; any source or dependency change invalidates the timings. Source, tests, manifests and benchmark runner code must stay frozen during collection. Documentation edits outside those hashed inputs do not change the measurements.

`bench:storage` requires the installed sibling OPFS artifact and the six current workspace artifacts; prepare them through `consumer:storage`. Its report records actual installed-input and fixture identities. The full `release-check` DAG runs this gate after the installed storage consumer checks. The publishing workflow selects the exact published OPFS version from its reviewed source commit before running those gates.

Compiler reports also use an atomically acquired directory under `.tmp/reports/types/`. `BENCH_TYPES_REPORT`
selects its base directory, and `STORAGE_COLD_REPORT` selects a base for packed-storage reports. Each configured
base contains a timestamp-prefixed child with an owned random suffix; neither variable selects a shared
`report.json` to overwrite. Without `STORAGE_COLD_REPORT`, storage evidence uses its own temporary directory.
Both runners print the actual report location, which must be retained with its raw files.

CI uploads `.tmp/reports/bench/` with the commit SHA in the artifact name. A completed equivalent-work report can support a performance decision; a partial report or historical timing cannot establish a current performance pass or a universal throughput SLO.
