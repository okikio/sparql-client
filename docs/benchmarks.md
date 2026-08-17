# Benchmark decisions

This document records performance changes that survived equivalent-work benchmarks. Package `*_bench.ts` files and `bench/vocab/types.ts` are the durable benchmark definitions. Assistant-only raw host captures are not project artifacts and are not retained in the repository.

## Measurement rules

A benchmark must state the operation, correctness oracle, fixture size, warm/cold state, and relevant resource costs. Fixture construction stays outside timed callbacks. Do not compare operations that return different semantic results. Treat one host run as evidence about a mechanism, not as a universal throughput claim.

## Decisions retained

### Bounded RDF source windows

Direct `string` and `Uint8Array` sources are exposed to line parsers through bounded internal windows. The original whole-string path was roughly twice as slow as 4 KiB caller chunks on the same 10,000-quad fixture. After unifying both paths, direct text and 4 KiB chunks are approximately equivalent on the host benchmark.

**Decision:** retain bounded internal source windows. They remove API-shape-dependent performance and bound the active scanner window.

### Synchronous SPARQL scanner hot loop

The first syntax scanner awaited `peek()` and `take()` for almost every character. On a 10,000-pattern query, source-ranged token streaming was about 216 ms median. Moving character classification into a synchronous buffered loop and awaiting only refill reduced the same operation to about 53 ms in the refreshed host run.

**Decision:** retain the synchronous buffered lexical loop. Public token/event allocation remains unchanged.

### Vocabulary schema composition

The first vocabulary emitter repeated every inherited runtime property descriptor into every descendant schema. A synthetic 1,000-class deep hierarchy emitted about 14.9 MiB and took about 518 ms to generate. Parent schema composition reduced that case to about 0.56 MiB and about 10 ms generation, while generated TypeScript still validates inherited properties.

**Decision:** retain parent schema composition and keep generated compiler-cost benchmarks as a release gate.

### Dataset exact-term indexes

For 50,000 quads, an exact subject scan and exact indexed lookup return the same result set. The refreshed host medians are about 0.447 ms for the scan and 0.0024 ms for the index.

**Decision:** retain exact subject, predicate, object, and graph indexes.

### Compact singleton index buckets

The first indexes allocated a `Set` for every indexed term, including singleton subjects and objects. Recovery profiling showed index construction was a large share of cold-open cost. Storing one quad key directly and promoting to a `Set` only on the second value materially reduced index construction and triplestore recovery time.

**Decision:** retain `quadKey | Set<quadKey>` buckets.

### Homogeneous durable delta segments

The first persistent delta format prefixed every line with add/delete state and reparsed each line independently during recovery. Every public mutation generation is homogeneous, so the operation is now stored once in the immutable commit and the segment is ordinary N-Quads parsed once.

**Decision:** retain format version 2. It simplifies recovery and removes per-record parser setup.

## Experiments rejected

### Numeric quad IDs in indexes

Replacing quad keys in index buckets with numeric IDs marginally improved isolated index construction but did not improve end-to-end cold reopen consistently and increased representation complexity.

**Decision:** rejected. Keep compact string buckets until a memory profile or larger representative workload proves the additional indirection worthwhile.

## Current host observations

These values are not cross-runtime guarantees. They are retained so future changes can be compared to the same workload.

| Case | Refreshed median |
| --- | ---: |
| Dataset full subject scan, 50k | ~0.447 ms |
| Dataset indexed subject match, 50k | ~0.0024 ms |
| N-Quads, 10k direct text | ~28.7 ms |
| N-Quads, 10k 4 KiB chunks | ~28.3 ms |
| Turtle, 10k equivalent quads | ~142 ms |
| SPARQL syntax stream, 10k patterns | ~57 ms |
| SPARQL syntax materialize, 10k patterns | ~63 ms |
| Triplestore indexed match, 50k | ~0.0053 ms |

Cold triplestore reopen remains much more expensive than warm lookup because it verifies, parses, and rebuilds in-memory indexes. Recovery profiling shows SHA-256 is only a few milliseconds; parsing plus index reconstruction dominates. Do not optimize hashing before those measured costs.

## Durable benchmark programs

The current repository-owned benchmark programs are:

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

The first eight are in-process runtime benchmarks using Mitata. `bench/vocab/types.ts` is a separate process/compiler benchmark because TypeScript wall time, compiler diagnostics, memory, and type-instantiation counts must be measured in isolated compiler processes.

Two benchmark definitions were added during the completeness pass but were not executed on this host because the canonical benchmark runtime is Deno:

- structured SPARQL builder versus equivalent direct string assembly
- full vocabulary `read -> name plan -> emit` compilation and generated Standard Schema runtime validation

Do not attach invented throughput numbers to those new cases until `deno task bench` runs on a Deno-capable host.
