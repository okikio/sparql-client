---
'@okikio/rdf': patch
---

### Retain complete native benchmark reports without buffering both output pipes

A native dataset benchmark completed its 23 measured runs, but its JSON report failed admission because Mitata's
calibration array filled the command collector's 32 MiB buffer. Dropping samples would hide the failure and remove
useful distributions. Native report collection now writes stdout and stderr to independent raw files, with awaited
partial writes and a finite 128 MiB quota for each stream.

```sh
deno task bench:report
# Inspect .tmp/reports/bench/<timestamp>-<owned-suffix>/meta.json, raw .json and .stderr files.
```

Metadata records retained and observed bytes, quotas, complete EOF, actual child exit/signal and independent capture
failures. A disk error, quota overflow or operational deadline rejects the report and retains the available prefix.
Every acquired reader/file receives a retirement attempt; errors remain independent and reject capture.
After file-open and child acquisition, the watchdog stops only the directly owned child. Acquisition, an inherited
descendant pipe or uncooperative native disk call
still needs the outer isolated-runner watchdog.

Complete raw JSON is decoded and validated after capture, outside Mitata callbacks. This still materializes the
admitted file and arrays; it does not promise constant-memory parsing or faster measured operations. Total runner
milliseconds, capture milliseconds and validation milliseconds remain separate from Mitata's nanosecond samples.
The compiler and other small-output callers keep their separate bounded in-memory collector. Existing workload
oracles, sample arrays and production APIs are unchanged.

Each invocation atomically acquires its own directory, so concurrent starts or identical timestamps cannot overwrite
another report's metadata. Raw files use exclusive creation inside that owned directory.
Compiler and packed-storage reports use the same ownership rule. `BENCH_TYPES_REPORT` and
`STORAGE_COLD_REPORT` now select base directories; read each invocation's report in its unique child directory.
