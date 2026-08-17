# `@okikio/triplestore`

Crash-recoverable persistent RDF Dataset backed by a borrowed structural filesystem.

```ts
import * as rdf from '@okikio/rdf'
import { open } from '@okikio/triplestore'

await using store = await open(fileSystem, { path: '/knowledge' })

await store.add(rdf.quad(
  rdf.namedNode('urn:product:1'),
  rdf.namedNode('https://schema.org/name'),
  rdf.literal('Widget'),
))
```

## Storage capability

The package does not depend on OPFS directly. It accepts a small filesystem contract so the caller can provide `@okikio/opfs` or another compatible filesystem.

The filesystem remains caller-owned. Closing the store does not dispose it.

## Persistence model

The baseline uses immutable N-Quads segments plus immutable generation records. A generation becomes recoverable only after its commit record and referenced segment can be validated.

```text
write segment
    |
    v
publish commit
    |
    v
new generation visible on reopen
```

Recovery scans newest to oldest for a valid committed generation. An interrupted commit publication is ignored. A corrupt newest generation can fall back to an older valid committed generation, but a corrupt only-generation is never treated as an empty database.

`compact()` writes a snapshot generation so older delta segments are no longer required to reconstruct that state.

## Current limits

- one writer per store path
- no cross-process writer coordination yet
- no physical garbage collection contract yet
- in-memory exact-term indexes are rebuilt on open
- persistent-index formats are intentionally deferred until benchmark and durability comparisons justify one
