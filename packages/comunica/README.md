# `@okikio/comunica`

Adapter from a caller-owned Comunica `QueryEngine` to `@okikio/sparql`'s result-mode-specific `Queryable` contract.

```ts
import { QueryEngine } from '@comunica/query-sparql'
import { create } from '@okikio/comunica'

const engine = new QueryEngine()
const client = create(engine, {
  context: () => ({ sources: [/* caller-owned sources */] }),
})

const rows = await client.queryBindings(query)
await client.update(update)
```

The package does not create an engine or choose data sources at import time. The supplied engine remains caller-owned.

Streaming SELECT/graph results destroy the upstream result stream when the consumer returns early or the operation signal aborts. Boolean/update operations are promise-based upstream, so their deeper cancellation behavior depends on the context and capabilities supplied to Comunica.

The public generic method is `update()`. The adapter translates it to Comunica's upstream `queryVoid()` method internally.
