---
'@okikio/rdf': minor
---

### Bound semantic expansion and the complete remote loading attempt

Markup size alone does not bound Microdata output. A vocabulary registry can
attach many aliases to one property, and `itemref` can connect shallow elements
into a deep semantic chain. The reader now admits each emitted statement under
`maxQuads` (default 1,000,000) and each active item expansion under `maxItemDepth`
(default 128), before any output is yielded.

```ts
import { parse } from '@okikio/rdf/microdata'

const html = '<div itemscope itemtype="urn:v:Item"><span itemprop="name">Ada</span></div>'
const values = []
for await (const value of parse(html, { maxQuads: 100, maxItemDepth: 16 })) {
  values.push(value)
}
console.log(values.length) // 2: the item type and name statements
```

Both bounds must be positive safe integers. Exceeding a bound throws `RangeError`.
Completed shared items can be reused without spending another active depth level.
These bounds complement the byte, markup node and markup depth caps; extraction
still materializes the complete host tree and result. They do not certify a
complete WHATWG HTML parser.

The built-in JSON-LD loader now applies one `timeoutMs` deadline across URL
approval, response headers, redirects, response retirement and body transfer.
Previously each redirect received another deadline and an injected fetch could
stall before the body deadline began. A late acquired response is canceled even
when injected fetch ignores its signal. Cancellation also prevents a pending
URL approval from dispatching a request after the caller aborts.

Applications that relied on a separate timeout budget for every redirect should
set an explicit whole-document budget. `0` keeps the documented disabled timer;
values above 2,147,483,647 now reject instead of overflowing the portable timer.
The caller still owns an injected document loader and cross-operation cache.

RDFC candidate permutation exploration now uses explicit search state instead
of synchronous recursive generator calls. Large first candidates reach the
canonicalizer's work admission without overflowing the host stack. Positional
order, duplicate positions and canonical digests remain unchanged; adversarial
datasets still need explicit quad and N-degree work budgets.
