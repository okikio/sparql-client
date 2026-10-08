# `@okikio/triplestore`

A persistent RDF Dataset over a borrowed structural filesystem. This complete
memory-backed example uses the public OPFS composition surface; closing the
store leaves the filesystem available to its caller.

```ts
import * as rdf from '@okikio/rdf'
import { open } from '@okikio/triplestore'
import { createFileSystem } from '@okikio/opfs'
import { createMemoryDriver } from '@okikio/opfs/driver/memory'
import { createRecordAdapter } from '@okikio/opfs/adapter/record'

await using fileSystem = createFileSystem(createRecordAdapter(createMemoryDriver()))
const item = rdf.quad(
  rdf.namedNode('urn:product:1'),
  rdf.namedNode('https://schema.org/name'),
  rdf.literal('Widget'),
)
const store = await open(fileSystem, { path: '/knowledge' })
await store.add(item)
await store.close()
await using reopened = await open(fileSystem, { path: '/knowledge' })
console.log(reopened.has(item)) // true
```

## Publication and recovery

Format 3 uses immutable N-Quads segments and commit records. Successful mutation
means the segment and commit were written, read back and validated before the
in-memory head changed. This is a process-visible publication receipt. The
filesystem contract supplies no fsync/persistence barrier or compare-and-swap;
power-loss durability and simultaneous writers are not guaranteed.

The application must exclude other writers to the same root. Namespace checks
detect ordinary stale handles but cannot establish distributed coordination.
Recovery falls back only from admitted artifact corruption. Cancellation, I/O
failure, mixed/newer protocols and exceeded budgets reject open. A corrupt sole
authoritative generation never becomes an empty successful dataset.

Recovery separates trusted state from occupied history. The next write after
fallback uses a complete snapshot above the highest occupied generation. It
preserves damaged files instead of overwriting them. Snapshot parent identifies
provenance; a delta parent remains required for replay. `compact()` publishes a
snapshot; it does not promise physical garbage collection.

## Failed or canceled publication

A failure after a write starts has kind `outcome-unknown` and retains its cause.
The live handle rejects further mutations. Close it, await `store.settlement`
and reopen under exclusive ownership before choosing the next operation. The
settlement promise observes actual pending borrowed writes, which can outlive
terminal cancellation when the filesystem ignores its signal. It may remain
pending with an uncooperative filesystem; do not reopen concurrently with that
unfinished writer. Earlier successful `import` batches remain published.

## Migration

Format 2 opens read-only. Migration explicitly selects a fresh destination:

```ts
import { migrate, open } from '@okikio/triplestore'

// fileSystem is the caller-owned filesystem from the complete example above.
const receipt = await migrate(fileSystem, { from: '/knowledge', to: '/knowledge-v3' })
await using migrated = await open(fileSystem, { path: receipt.path })
console.log(migrated.size) // 1
```

Migration never rewrites or removes the source. The destination stores intent
before its initial snapshot and admits ordinary open only after verified
`ready.json`. Retry resumes exact matching bytes; a torn conflicting destination
requires another fresh root. The immutable receipt identifies the initial
snapshot rather than a later head, so later valid mutations reopen normally.
The caller controls application path switching; no atomic pointer switch is
assumed. Old readers reject format 3. Retain the old root for rollback.

## Resource boundaries

All limits are positive safe integers and reject invalid values before I/O:

| Option            |   Default | Boundary                                                                       |
| ----------------- | --------: | ------------------------------------------------------------------------------ |
| `maxRecords`      |   100,000 | Discovered files and replay ancestry records                                   |
| `maxSegmentBytes` |   256 MiB | One immutable segment                                                          |
| `maxReplayBytes`  |   512 MiB | Cumulative admitted segment bytes across candidates                            |
| `maxReplayQuads`  | 2,000,000 | Parsed retained quads and applied replay steps, each bounded across candidates |
| `maxQuads`        | 1,000,000 | Materialized unique dataset quads                                              |

Verified artifacts are cached once per open, including rejected candidates.
`openReadStream` enables a byte cap during consumption. A filesystem exposing
only `readText` may allocate before that text is capped; a buffered stream
adapter can also allocate before its stream is exposed. In-memory exact-term
indexes are rebuilt on open. Persisted indexes, distributed transactions and
power-loss durability profiles require separate capabilities and evidence.
