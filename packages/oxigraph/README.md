# `@okikio/oxigraph`

Use `results: 'owned'` when adapting a native Oxigraph `Store`. The store remains yours; each query owns the materialized Wasm terms that it returns internally and the children allocated by their getters. Returned RDF values are detached and remain usable after operation cleanup.

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

// Disposal awaits cleanup, including when this loop breaks or throws.
await using rows = await client.queryBindings('SELECT ?s ?o WHERE { ?s <urn:p> ?o }')
for await (const row of rows) {
  console.log(row.get('s')?.value, row.get('o')?.value)
}
```

The package does not initialize Wasm or create a store at import time. `results: 'owned'` transfers operation results, never the store itself. Native Oxigraph 0.5.9 returns materialized arrays of binding maps or quads; owned mode requires that shape. It registers every parent before the first pull, captures each datatype or quad-component getter once, and releases each unique callable `free()` resource with children before parents. Successful completion, malformed acquisition, conversion failure, cancellation, early return and closing a never-consumed result all retire those resources. Cleanup attempts all releases and retains independent primary and cleanup failures.

The default `results: 'borrowed'` preserves structural stores that return caller-owned RDF values or lazy iterables. Their values and child resources remain caller-owned. A `free()` method alone never implies ownership. Choose borrowed mode for a custom store that reuses term objects; choose owned mode only when the materialized result terms and getter-created children are transferred to this query. An owned-mode lazy iterable is rejected without being drained. The adapter copies its array of parent references and does not clear or rewrite a structural store's original result array.

Results use the single-consumer `ResultType`. `rows.cancel()` and `await rows.close()` stop conversion and request cleanup before the first pull. `await rows.cleanup`, `close({ waitForCleanup: true })`, and `await using` wait for actual cleanup. An abort terminates consumption promptly; cleanup has separate completion authority. Free the application-owned store only after its operation results have settled. For runtimes without explicit resource syntax, use `try/finally` and `await rows.close({ waitForCleanup: true })`.

The current Oxigraph JavaScript Store API is synchronous and materializes its query results before this adapter can convert them. `AbortSignal` is checked before an operation begins, but a positive `timeoutMs` is rejected because the adapter cannot interrupt an already-running synchronous Wasm call. Canceling conversion cannot undo evaluation or make its original materialization bounded. Use an owned Worker or process when interruptibility is required.

Owned conversion copies the array of parent references and keeps an operation-local disposal ledger and semantic snapshots for visited terms. Native parents remain live until operation cleanup. This adds memory and conversion work proportional to the materialized results and visited child terms; it does not claim streaming engine evaluation or a measured speedup. Cyclic terms and nesting beyond the RDF factory’s 512-level bound reject while acquired resources are still retired. Even a malformed result containing the injected Store never transfers that Store to the operation.
