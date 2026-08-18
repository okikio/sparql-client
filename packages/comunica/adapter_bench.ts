/** Measures Comunica adapter overhead against the same caller-owned RDF/JS engine. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { DataFactory, Store } from 'n3'
import { report } from '../../bench/report.ts'
import { create } from './mod.ts'

const engine = new QueryEngine()
const source = new Store()
for (let index = 0; index < 10_000; index++) {
  source.addQuad(
    DataFactory.namedNode(`https://example.com/s/${index}`),
    DataFactory.namedNode('https://example.com/p'),
    DataFactory.literal(`v${index}`),
  )
}
const context = { sources: [source] }
const client = create(engine, { context: () => context })
const ask = 'ASK { <https://example.com/s/1729> <https://example.com/p> ?o }'
const select = 'SELECT ?o WHERE { <https://example.com/s/1729> <https://example.com/p> ?o }'

if (!await engine.queryBoolean(ask, context) || !await client.queryBoolean(ask)) {
  throw new Error('Comunica ASK benchmark oracle failed.')
}
const direct = await engine.queryBindings(select, context)
let directCount = 0
for await (const _ of direct) directCount++
let wrappedCount = 0
for await (const _ of await client.queryBindings(select)) wrappedCount++
if (directCount !== 1 || wrappedCount !== directCount) {
  throw new Error('Comunica binding benchmark oracle failed.')
}

group('Comunica adapter: 10k-quad RDF/JS source', () => {
  bench('direct ASK', async () => do_not_optimize(await engine.queryBoolean(ask, context)))
  bench('@okikio ASK adapter', async () => do_not_optimize(await client.queryBoolean(ask)))
  bench('direct SELECT materialize', async () => {
    const stream = await engine.queryBindings(select, context)
    let count = 0
    for await (const _ of stream) count++
    do_not_optimize(count)
  })
  bench('@okikio SELECT materialize', async () => {
    let count = 0
    for await (const _ of await client.queryBindings(select)) count++
    do_not_optimize(count)
  })
})

await report()
