# `@okikio/comunica`

Adapter from a caller-owned Comunica `QueryEngine` to `@okikio/sparql`'s result-mode-specific `Queryable` contract.

```ts
import { QueryEngine } from '@comunica/query-sparql'
import { create } from '@okikio/comunica'

const engine = new QueryEngine()
const client = create(engine, {
  context: () => ({ sources: [] }),
})

const rows = await client.queryBindings('SELECT ?s WHERE { ?s ?p ?o }')
try {
  for await (const row of rows) console.log(row.get('s')?.value)
} finally {
  await rows.close()
}
await client.update('INSERT DATA { <urn:s> <urn:p> <urn:o> }')
```

The package does not create an engine or choose data sources at import time. The supplied engine remains caller-owned.

SELECT/graph results are owned from acquisition, even before the first pull.
Abort terminates pending acquisition/next without awaiting an uncooperative
upstream return/destroy. The adapter requests stream destruction once and exposes
actual cooperative completion through `rows.cleanup`. `await using` and
`close({ waitForCleanup: true })` intentionally wait for that release and may
remain pending if upstream ignores cleanup. `onCleanup` observes late acquisition
retirement when no result was returned. A fulfilled void `destroy()` proves its
invocation completed, not an independently observed network teardown.

Boolean/update terminal promises also race caller abort. The underlying engine
work can continue without deeper cancellation support in its context; an aborted
update has an unknown mutation outcome and is not automatically retried.

The public generic method is `update()`. The adapter translates it to Comunica's upstream `queryVoid()` method internally.
