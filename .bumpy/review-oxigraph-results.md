---
'@okikio/oxigraph': patch
---

### Own query wrappers while borrowing the Oxigraph store

A long-lived Oxigraph store and one query's results have different lifetimes. Previously, the adapter returned detached RDF values but left native result terms and getter-created datatype/quad children to garbage-collector finalizers. Closing the result did not deterministically retire those hidden Wasm pointers. Freeing the store was not an operation-level cleanup contract.

Select explicit result ownership when adapting the native materialized Store API:

```ts
import { Store } from 'oxigraph'
import { create } from '@okikio/oxigraph'

const store = new Store()
// The application owns the Store. Explicit disposal retains cleanup failures.
using owner = {
  [Symbol.dispose]() {
    // Oxigraph 0.5.9's declarations omit its actual native free() method.
    const free: unknown = Reflect.get(store, 'free')
    if (typeof free !== 'function') throw new TypeError('This Store has no explicit free().')
    Reflect.apply(free, store, [])
  },
}

const client = create(store, { results: 'owned' })
await client.update('INSERT DATA { <urn:s> <urn:p> "hello" }')
await using rows = await client.queryBindings('SELECT ?o WHERE { <urn:s> <urn:p> ?o }')
for await (const row of rows) console.log(row.get('o')?.value)
```

`results: 'owned'` requires materialized arrays of maps or quads, matching Oxigraph 0.5.9. It owns all acquired term/quad wrappers before the consumer's first pull, including unconsumed rows. Conversion captures each child getter once and produces independent RDF values. Completion, early return, abort, malformed acquisition and conversion errors release each unique child before its parent. Cleanup attempts the remaining releases after a disposal failure, and the result's cleanup promise preserves both primary and cleanup causes. `await using` waits for this cleanup; the application still owns the store.

The default remains `results: 'borrowed'` for custom structural stores with shared caller-owned values or lazy iterables. The presence of `free()` does not transfer ownership. Owned lazy sources reject without being drained, and the adapter does not mutate the caller's original result arrays. This change adds deterministic operation retirement; it does not make synchronous query evaluation interruptible or remove native result materialization. Positive timeouts still reject rather than imply that synchronous Wasm work can be canceled.

Owned conversion copies the array of parent references and keeps an operation-local disposal ledger and semantic snapshots for visited terms. Native parents remain live until operation cleanup. This adds memory and conversion work proportional to the materialized results and visited child terms; it does not claim streaming engine evaluation or a measured speedup. Cyclic terms and nesting beyond the RDF factory’s 512-level bound reject while acquired resources are still retired. Even a malformed result containing the injected Store never transfers that Store to the operation.
