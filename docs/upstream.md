# Upstream regression tests and workloads

Run `deno task test:upstream` to exercise the adopted parser, dataset, store and engine cases.
The parser cases also run with the normal `deno task test` command. The integration cases have
their own task because they initialize real external engines. These runtime commands use
`--no-check`; type checking remains a separate CI gate.

Run `deno task bench:upstream:check` for the Jena workload correctness preflight and
`deno task bench:upstream` for timing. `BENCH_FORMAT=json` retains Mitata's structured output;
workload metadata is written separately to stderr. The full cheese corpus has 7,744 unique
triples. Six selector families each consume all those triples across their distinct selectors,
with separate Dataset, N3 and Store lanes. The Store borrows a memory filesystem and uses a warm
index; this run measures matching and iteration, not physical disk I/O or crash durability.

Official W3C profiles answer whether the declared format profile accepts, rejects or interprets
the pinned standards cases correctly. Upstream library and datastore suites add cases discovered
by other implementations and their users. Keep these two kinds of evidence separate. An upstream
library can deliberately accept extensions or recover from errors that our selected strict
profile must reject. Its test expectation does not override the specification or the public API.

## Sources and adaptation

The parser corpus and provenance live under `conformance/upstream/`. Its harness is
`conformance/upstream_test.ts`. Store and adapter scenarios live under `integration/upstream/`.
Benchmark definitions, provenance and original snapshots live under `bench/upstream/`.
Each group's README and manifest identify the immutable upstream commit, original file and case,
license and notices, copied-file hashes, adaptations and deliberate exclusions.
The maintained parser corpus has 535 vectors, each run as whole input and hostile byte chunks.
The datastore suite has 69 dataset, store, engine and oracle cases plus a source-provenance check. The DatasetCore adaptation keeps36 supported original cases and maps the legacy RDF-star Quad-subject case to an explicit RDF 1.2 rejection test; provenance retains its original identity and profile reason. The copied datastore
sources and licenses are checked before and after benchmark consumption and in the integration
suite; missing, modified or unexplained extra snapshots fail acquisition.

Copied source files are evidence and fixture inputs. The harness does not run their test setup,
download scripts or upstream implementation internals. Preserve their original bytes. The root
formatter and linter exclude the raw parser corpus and benchmark source snapshots; they still
check our harnesses and benchmark programs. Updating a pin requires reviewing the source diff,
license and case mapping, then rerunning the affected suite. A hash change is a provenance failure,
not a reason to regenerate expected results from candidate output.

Positive parser cases compare RDF term meaning and graph identity with independently recorded
expected results. Blank-node labels can vary where the contract allows dataset isomorphism.
Negative cases require the declared rejection class rather than an incidental diagnostic string.
The 299 grammar negatives require `SyntaxError`. Ten malformed UTF-8 cases independently prove
their encoding fault before requiring the decoder's `TypeError`. An internal error cannot count
as a passing grammar rejection. Chunked runs must
retain the same meaning, including splits inside escapes and Unicode encodings. Dataset matching
checks bound and wildcard positions, graph identity, duplicates and deletion. Persistent-store
cases also exercise reopen and compaction. Engine cases only claim the operations supported by
the selected adapter and injected engine.

Every excluded upstream case needs a visible profile reason. Examples include an unsupported
format, a legacy RDF-star dialect, recovery mode, a complete evaluator requirement or an
implementation-specific callback contract. A failure in a supported contract requires a fix;
it must not silently become an exclusion.

## Performance interpretation

An adopted benchmark retains the upstream workload question, source and input characteristics.
It must also define our actual measured operation. Parsing a dataset, inserting it into an index,
counting matching triples and durably storing it are different costs. Keep them in separate lanes.
Construct selectors and immutable inputs outside the timer, and consume complete results.
Correctness preflights run before timing, with independent expected output and controls that
reject wrong terms, missing statements or unexpected multiplicity where relevant.

Record the implementation, runtime and harness version, corpus hash, size, warm/cold state,
concurrency, units and setup scope. Report CPU time, wall time, heap and RSS separately when those
instruments are actually used. A throughput sample does not establish memory bounds, crash
durability or a universal performance budget. Host noise needs measured variability rather than
a fragile timing threshold.

Upstream source and dataset licenses can differ. Preserve dataset-specific attribution and
share-alike terms rather than assuming the repository's source license covers every resource.
Fixtures and benchmark snapshots are intentional maintained assets, outside published package
roots. Downloads, manual research and raw captures belong under ignored `.tmp/`.

These suites expand independently sourced coverage. They do not establish every possible input,
all query-engine semantics, SHACL validation, entailment or every deployment's resource budget.
Use the declared profiles in `support.json` and the [conformance guide](./conformance.md) to
interpret the exact supported capabilities.
