# `@okikio/oxigraph`

Adapter from a caller-owned Oxigraph `Store` to `@okikio/sparql`'s result-mode-specific `Queryable` contract.

```ts
import { Store } from 'oxigraph'
import { createClient } from '@okikio/oxigraph'

const store = new Store()
const client = createClient(store)

const rows = await client.queryBindings(query)
await client.update(update)
```

The package does not initialize Wasm or create a store at import time. The supplied store remains caller-owned.

The current Oxigraph JavaScript Store API is synchronous. `AbortSignal` is checked before an operation begins, but a positive `timeoutMs` is rejected because the adapter cannot truthfully interrupt an already-running synchronous Wasm call. Use an owned Worker/process when interruptibility is required.
