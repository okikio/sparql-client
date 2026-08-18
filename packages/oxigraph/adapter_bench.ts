/** Measures Oxigraph adapter overhead against the same caller-owned engine. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { Store } from 'oxigraph'
import { report } from '../../bench/report.ts'
import { create } from './mod.ts'

const store = new Store()
const rows = 10_000
let data = ''
for (let index = 0; index < rows; index++) {
  data += `<https://example.com/s/${index}> <https://example.com/p> \"v${index}\" .\n`
}
store.load(data, { format: 'application/n-triples' })
const client = create(store)
const ask = 'ASK { <https://example.com/s/1729> <https://example.com/p> ?o }'
const select = 'SELECT ?o WHERE { <https://example.com/s/1729> <https://example.com/p> ?o }'

if (store.query(ask) !== true || await client.queryBoolean(ask) !== true) {
  throw new Error('Oxigraph ASK benchmark oracle failed.')
}
const directRows = Array.from(store.query(select) as Iterable<unknown>)
const wrappedRows = []
for await (const row of await client.queryBindings(select)) wrappedRows.push(row)
if (directRows.length !== wrappedRows.length || wrappedRows.length !== 1) {
  throw new Error('Oxigraph binding benchmark oracle failed.')
}

group('Oxigraph adapter: 10k-quad store', () => {
  bench('direct ASK', () => do_not_optimize(store.query(ask)))
  bench('@okikio ASK adapter', async () => do_not_optimize(await client.queryBoolean(ask)))
  bench(
    'direct SELECT materialize',
    () => do_not_optimize(Array.from(store.query(select) as Iterable<unknown>).length),
  )
  bench('@okikio SELECT materialize', async () => {
    let count = 0
    for await (const _ of await client.queryBindings(select)) count++
    do_not_optimize(count)
  })
})

await report()
