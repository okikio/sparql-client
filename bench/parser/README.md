# Turtle/TriG scanner cost

Use `compare.ts` to decide whether a scanner change reduces complete RDF ingestion cost while preserving the public streaming parser. Save the baseline before editing the scanner:

```sh
cp -R packages/rdf /tmp/compact-baseline
PARSER_BASELINE=file:///tmp/compact-baseline/ PARSER_SYNTAX=Turtle PARSER_COUNT=100000 BENCH_FORMAT=json deno run --v8-flags=--expose-gc --allow-env --allow-read bench/parser/compare.ts > /tmp/turtle-compare.json
```

Repeat with `PARSER_SYNTAX=TriG`, serially. The baseline and candidate must use identical loaded parser dependencies, configuration, runtime and options. A causal comparison changes only `compact.ts`; retain hashes of the loaded files before and after collection. A changing working tree requires frozen source/configuration snapshots. Keep the original config and lock beside the explicitly derived execution config, and record the command that selected it. Do not attribute frozen observations to later production source edits.

The deterministic fixture uses one unique subject and plain literal per statement. TriG wraps each statement in one of eight named graphs. Whole-input and 4 KiB chunk cases construct the parser and retain complete quad arrays. N3 uses its whole-document array API. Preflight checks every subject, predicate, literal lexical value, language, direction, datatype and graph against the independently constructed fixture, preserving multiplicity. These synthetic ASCII documents expose scanner scaling; they do not represent Unicode, nesting, recovery frequency or arbitrary real datasets. Native literals store fields eagerly while N3 exposes some fields through getters; a count consumer does not measure every downstream term accessor.

Mitata consumes the resulting array lengths and controls warmup/sampling. Inner GC explicitly collects before and after a batch. Preserve all native raw samples and label percentile estimators. Use the normal package competitive matrix for broader syntax/chunk/first-result coverage. This focused diagnostic is not automatically discovered as another default package benchmark.

## Profile the mechanism separately

```sh
PARSER_SYNTAX=Turtle PARSER_COUNT=100000 PARSER_PROFILE=cpu PARSER_REPORT=/tmp/turtle-cpu.json deno run --v8-flags=--expose-gc --allow-env --allow-read --allow-write --allow-sys bench/parser/profile.ts
```

Run `PARSER_PROFILE=heap` separately for allocation attribution and `PARSER_PROFILE=off` for uninstrumented observations. `PARSER_CHUNK=4096` selects chunked input; zero means a complete string. `PARSER_ITERATIONS` controls diagnostic observations. These plain observations include first-parse JIT work and are not a substitute for warmed Mitata distributions. `PARSER_IMPLEMENTATION=n3` supports its whole-document API only. `PARSER_MODULE` selects an explicit saved native module URL.

Each parse timer includes parser construction and complete array materialization. Process CPU differences cover that interval in user/system microseconds, including process background GC threads where applicable. Independent RDF identity checks and result release/explicit collection occur after the timer. RSS, total/used heap and external memory snapshots use bytes. Process maximum RSS converts KiB to bytes and includes setup, materialized outputs and earlier oracle work. It is not a parser-only peak or a leak test. After-release GC is one retained-heap observation with the fixture still held; profiler modes also hold profiler records. Deno's Node compatibility `arrayBuffers: 0` is unavailable, so the maintained profiler uses native Deno memory fields rather than presenting that placeholder as measured zero.

CPU sampling identifies active frames; sample fractions are not exact process CPU fractions. V8 heap sampling uses a 32 KiB interval and includes objects collected by minor/major GC. It estimates allocation attribution, rather than exact allocation count, positive Mitata heap delta, RSS or retained memory. The local parser has no network source: request metrics are not used or measured. Report writing and source-identity checks stay outside timers. Invalid/missing physical measurements and changed input hashes fail the diagnostic.

## Set a workload budget

Start from the application's document sizes, required output consumption and supported chunk sources. Collect repeated baseline and candidate runs on the same runtime/machine with recorded GC policy, host load and cache state. Compare medians, raw dispersion, CPU and allocation attribution; retain process-memory observations even when latency improves. Use several independent invocations and change the ordering to examine drift before assigning confidence or a regression threshold. A small diagnostic sample cannot establish production p99 or a universal SLO.

Set an absolute ingestion target only from an actual application requirement. Without that requirement, use the baseline and competing equivalent-work implementations to assess effect size and remaining cost. Accept a scanner optimization when correctness remains intact and its effect exceeds observed host variation across whole and chunked ingestion. Do not require global equality with N3 or infer bounded total memory from faster parsing; retaining a million quads is a separate consumer choice.

One-record limits remain correctness contracts. The default lexical cap is 8 Mi UTF-16 code units, nested grammar depth is 128, and tolerant statement buffering defaults to one million semantic events. Scanner tests exercise a token across repeated 64 KiB compaction with the exact limit and one code unit beyond, configured depth overflow, tolerant event overflow without partial statements, every UTF-8 byte edge, source ranges, stalled-read cancellation and early-return cleanup. Those tests protect limits; benchmark fixture volume does not certify arbitrary records or worst-case resources.
