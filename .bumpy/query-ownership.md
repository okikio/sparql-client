---
'@okikio/sparql': minor
'@okikio/comunica': minor
'@okikio/oxigraph': minor
'@okikio/triplestore': minor
---

### Keep construction meaning and operation ownership together

Expression and property-path helpers now retain compact child records instead of
flattening away grouping. `(1 + 2) * 3` evaluates to 9; repetition of a compound
path repeats the whole path. Paths have `SparqlPathType` and belong only in query
predicates. Checked graph templates reject evaluated clauses and paths. DATA
rejects variables; DELETE rejects blank-node allocations/references. Explicit
`rawTerm`, `rawExpr` and `rawPattern` keep syntax responsibility with their author.

A builder retains BIND/OPTIONAL/VALUES admission order. FILTER remains scoped to
its containing group rather than becoming an imperative step. Rebinding an
already introduced checked variable rejects; an unbound expression alone is not
a mandatory construction error. Repeated VALUES remain separate joins, and an
empty SELECT now includes its required `WHERE {}`. SubSelect accepts only SELECT
without FROM/FROM NAMED and hoists compatible prefixes into the outer document.

The complete example uses a borrowed engine, binds the expression in WHERE and
inserts its output term. Expressions do not belong directly in INSERT templates.

```ts
import { Store } from 'oxigraph'
import { create } from '@okikio/oxigraph'
import * as sparql from '@okikio/sparql'

const engine = new Store()
const client = create(engine)
try {
  await client.update('INSERT DATA { <urn:person> <urn:age> 20 }')
  await client.update(
    sparql.modify()
      .delete(sparql.triple('?person', 'urn:age', '?oldAge'))
      .insert(sparql.triple('?person', 'urn:age', '?newAge'))
      .where(sparql.triple('?person', 'urn:age', '?oldAge'))
      .where(sparql.bind(sparql.v('oldAge').add(1), 'newAge'))
      .done().build(),
  )
  console.log(await client.queryBoolean('ASK { <urn:person> <urn:age> 21 }')) // true
  const rows = await client.queryBindings(
    sparql.select(['newAge'])
      .where(sparql.triple('urn:person', 'urn:age', '?newAge')),
  )
  try {
    for await (const row of rows) console.log(row.get('newAge')?.value) // 21
  } finally {
    await rows.close()
  }
} finally {
  engine.free()
}
```

Plain object strings are literals. The subquery tutorial now uses an explicit
`prefixed('schema', 'Person')` object, not the literal `"schema:Person"`. Full
SPARQL Unicode token productions validate prefixes/local names, variables, blank
labels and language spelling. They do not look up the language registry, certify
a complete raw query, or supply undeclared prefix mappings.

| Previous assumption                                 | Current migration                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `mod()` / `%` is SPARQL 1.1                         | Removed; use an explicit engine extension in `rawExpr()` only when that engine supports it  |
| A path is any data term                             | Use `SparqlPathType` only as a query predicate                                              |
| A branded expression is a template object           | Bind it in WHERE and insert its output variable                                             |
| Unsafe integer JS numbers retain exact input digits | Use `integer(bigint)` or a safe integer number                                              |
| Exponent-form decimal convenience changes datatype  | `decimal()` preserves xsd:decimal; use a validated decimal string for exact input precision |
| A complete ASK/CONSTRUCT/FROM query is a SubSelect  | Use SELECT without dataset clauses                                                          |
| A custom `Queryable` can return a lazy iterable     | Wrap its acquired source with exported `result()`                                           |

`double()` retains xsd:double, including XSD `INF`, `-INF` and `NaN`. A datatype
literal itself may retain an ill-typed lexical value; the general RDF factory does
not validate every datatype's value space. Numeric convenience constructors make
their own input policy explicit rather than inferring datatype from token spelling.

### Cancel acquired results before the first pull

SELECT/graph methods now return single-consumer `ResultType`. Normal `for await`
use stays the same. Ownership begins at acquisition: signal abort, `cancel()` or
`await close()` can end a pending pull or a never-consumed operation. An acquired
response arriving after abort is retired once. Borrowed engine/filesystem ownership
is separate and never transferred by closing an operation.

Terminal abort does not await an uncooperative `return()`/`destroy()`/body cancel.
`cleanup` observes actual cooperative release; `close({ waitForCleanup: true })`
and `await using` deliberately wait and can remain pending with a producer that
ignores cleanup. `onCleanup` observes late acquisition retirement when no result
was returned. Primary and cleanup failures remain separately inspectable.

Comunica's Boolean/update terminal promise races caller abort, but upstream work
can continue unless its context supports deeper cancellation. An aborted update
has an unknown remote outcome, not a rollback receipt. Oxigraph evaluation remains
synchronous; positive timeouts reject instead of pretending to interrupt Wasm.

HTTP Turtle graphs resolve relative IRIs against the final response URL, including
redirects, or the actual prepared request URL for injected fetch implementations.
The sibling Graph Store reader also terminates stalled acquisition/body reads
without waiting for uncooperative cleanup. No automatic mutation retry was added.

### Continue recovered storage without overwriting damaged history

New roots use triplestore format 3. Recovery tracks the trusted dataset head and
highest occupied generation separately. A write after fallback publishes a complete
snapshot above occupied damaged history. Snapshot parent records provenance;
delta parents remain required. Unsupported or mixed protocols, I/O failures,
cancellation and exceeded budgets reject open instead of becoming successful emptiness.

Format 2 roots open read-only. Explicit migration preserves source bytes and
publishes destination readiness only after its initial snapshot is verified:

```ts
import * as rdf from '@okikio/rdf'
import { migrate, open } from '@okikio/triplestore'
import { createFileSystem } from '@okikio/opfs'
import { createMemoryDriver } from '@okikio/opfs/driver/memory'
import { createRecordAdapter } from '@okikio/opfs/adapter/record'

await using fs = createFileSystem(createRecordAdapter(createMemoryDriver()))
const old = await open(fs, { path: '/knowledge' })
await old.add(rdf.quad(rdf.namedNode('urn:s'), rdf.namedNode('urn:p'), rdf.literal('one')))
await old.close()
const receipt = await migrate(fs, { from: '/knowledge', to: '/knowledge-v3' })
await using current = await open(fs, { path: receipt.path })
console.log(current.size) // 1
```

This executable example copies a current root; the same API admits legacy roots
read-only. Destination intent and immutable `ready.json` identify the initial
migration snapshot, not the latest head, so later writes reopen normally. An
interrupted destination is unready. Retry resumes exact matching bytes; conflicting
torn bytes require another fresh destination. Application path switching remains
caller-controlled, and old readers reject format 3. No atomic pointer switch is assumed.

Publication checks detect ordinary stale handles but are not multiwriter CAS.
The caller must exclude other writers. A fulfilled mutation is a process-visible
receipt, not fsync or power-loss durability. A failure after a write starts has kind
`outcome-unknown`, preserves its cause and fences further writes on that handle.
Close it, await `store.settlement` and reopen only after pending borrowed writes
settle. An uncooperative filesystem may leave settlement pending. Earlier successful
import batches remain published.

Recovery caps discovered records, cumulative actual segment bytes, retained parsed
quads, applied replay steps and unique dataset size. Verified artifacts are cached
once per open. `openReadStream` caps bytes during consumption; `readText`-only or
buffered stream adapters can allocate before the store applies that cap. The new
benchmarks separate incremental construction/compact emission and corrupt-suffix
recovery over borrowed memory storage. They do not measure disk durability, network
latency or advertise an unmeasured speedup.
