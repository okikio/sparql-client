/** Measures consumed query results and adapter overhead against one benchmark-owned engine. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { Store } from 'oxigraph'
import { report } from '../../bench/report.ts'
import { create } from './mod.ts'

const store = new Store()
// The pinned Wasm Store exposes free() even though its public TypeScript declaration omits it.
const free: unknown = Reflect.get(store, 'free')
if (typeof free !== 'function') throw new Error('Pinned Oxigraph Store has no explicit release.')
const rows = 10_000
let data = ''
for (let index = 0; index < rows; index++) {
  data += `<https://example.com/s/${index}> <https://example.com/p> "v${index}" .\n`
}
/** The benchmark owns query-result wrappers; the production adapter still borrows its supplied store. */
const pending = new Set<{ free(): void }>()
const view = {
  query(query: string): ReturnType<Store['query']> {
    const result = store.query(query)
    if (Array.isArray(result)) {
      for (const row of result) {
        const terms = row instanceof Map ? row.values() : [row]
        for (const value of terms) {
          if (
            typeof value === 'object' && value !== null && 'free' in value &&
            typeof value.free === 'function'
          ) {
            pending.add(value as unknown as { free(): void })
          }
        }
      }
    }
    return result
  },
  update(query: string): void {
    store.update(query)
  },
}
/** Release work belongs to both timed lanes; it does not depend on GC finalizer scheduling. */
function retire(): void {
  for (const value of pending) value.free()
  pending.clear()
}
/** Consumes the same count and complete literal value through either API shape. */
function direct(query: string): { count: number; values: string[] } {
  const result = view.query(query)
  if (!Array.isArray(result)) throw new Error('SELECT result is not an array.')
  const values: string[] = []
  for (const row of result) {
    if (!(row instanceof Map)) throw new Error('SELECT row is not a binding Map.')
    values.push(row.get('o')!.value)
  }
  return { count: values.length, values }
}
const client = create(view)
/** The wrapped consumer retains ordinary RDF values, never engine-owned Wasm wrappers. */
async function wrapped(query: string): Promise<{ count: number; values: string[] }> {
  const values: string[] = []
  for await (const row of await client.queryBindings(query)) values.push(row.get('o')!.value)
  return { count: values.length, values }
}
const ask = 'ASK { <https://example.com/s/1729> <https://example.com/p> ?o }'
const select = 'SELECT ?o WHERE { <https://example.com/s/1729> <https://example.com/p> ?o }'
try {
  store.load(data, { format: 'application/n-triples' })
  if (view.query(ask) !== true || await client.queryBoolean(ask) !== true) {
    throw new Error('Oxigraph ASK benchmark oracle failed.')
  }
  for (const consume of [direct, wrapped]) {
    try {
      const value = await consume(select)
      if (value.count !== 1 || value.values[0] !== 'v1729') {
        throw new Error('Oxigraph binding oracle differs.')
      }
    } finally {
      retire()
    }
  }
  group('Oxigraph adapter: 10k-quad store', () => {
    bench('direct ASK', () => do_not_optimize(view.query(ask)))
    bench('@okikio ASK adapter', async () => do_not_optimize(await client.queryBoolean(ask)))
    bench('direct SELECT consume bindings + retire', () => {
      try {
        do_not_optimize(direct(select))
      } finally {
        retire()
      }
    }).gc('inner')
    bench('@okikio SELECT consume bindings + retire', async () => {
      try {
        do_not_optimize(await wrapped(select))
      } finally {
        retire()
      }
    }).gc('inner')
  })
  await report()
} finally {
  retire()
  free.call(store)
}
