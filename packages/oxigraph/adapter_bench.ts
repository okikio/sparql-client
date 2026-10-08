/** Measures consumed query results and adapter overhead against one benchmark-owned engine. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { Store } from 'oxigraph'
import { report } from '../../bench/report.ts'
import { finish } from '../../integration/releases.ts'
import { expectTerm } from '../../bench/oracle.ts'
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
/** Getter-produced datatype wrappers share the benchmark's lifetime, including during adapter conversion. */
function track<T extends object>(value: T): T {
  if (typeof Reflect.get(value, 'free') === 'function') {
    pending.add(value as T & { free(): void })
  }
  return new Proxy(value, {
    get(target, key) {
      const child: unknown = Reflect.get(target, key, target)
      return key === 'datatype' && typeof child === 'object' && child !== null
        ? track(child)
        : child
    },
  })
}
const view = {
  query(query: string): ReturnType<Store['query']> {
    const result = store.query(query)
    if (Array.isArray(result)) {
      for (const row of result) {
        if (row instanceof Map) {
          for (const [key, value] of row) row.set(key, track(value))
        } else {
          throw new Error('Benchmark view expects SELECT bindings or ASK booleans.')
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
  const failures: unknown[] = []
  for (const value of [...pending].reverse()) {
    pending.delete(value)
    try {
      value.free()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Benchmark term retirement failed.')
}
/** Retains a timed synchronous consumer failure as well as any independent wrapper-release failure. */
function retiring<Value>(body: () => Value): Value {
  const failures: unknown[] = []
  let value!: Value
  try {
    value = body()
  } catch (error) {
    failures.push(error)
  }
  try {
    retire()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, 'Query consumer and retirement failed.')
  return value
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
const expected = {
  termType: 'Literal',
  value: 'v1729',
  language: '',
  datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#string' },
}
const failures: unknown[] = []
try {
  let termReleased = false, datatypeReleased = false
  const owned = track({
    free() {
      termReleased = true
    },
    get datatype() {
      return {
        free() {
          datatypeReleased = true
        },
      }
    },
  })
  void owned.datatype
  retire()
  if (!termReleased || !datatypeReleased) {
    throw new Error('Benchmark ownership did not release a getter-produced datatype.')
  }
  const refusal = new Error('Fixture retirement refusal')
  termReleased = false
  const refusing = track({
    free() {
      termReleased = true
    },
    get datatype() {
      return {
        free() {
          throw refusal
        },
      }
    },
  })
  void refusing.datatype
  let observed: unknown
  try {
    retire()
  } catch (error) {
    observed = error
  }
  if (
    !termReleased || !(observed instanceof AggregateError) || !observed.errors.includes(refusal)
  ) {
    throw new Error('One failed term release blocked another owned release.')
  }
  store.load(data, { format: 'application/n-triples' })
  if (view.query(ask) !== true || await client.queryBoolean(ask) !== true) {
    throw new Error('Oxigraph ASK benchmark oracle failed.')
  }
  await finish(async (releases) => {
    releases.push(retire)
    const bindings = view.query(select)
    if (!Array.isArray(bindings)) throw new Error('SELECT result is not an array.')
    for (const row of bindings) {
      if (!(row instanceof Map)) throw new Error('SELECT row is not a binding Map.')
      expectTerm(row.get('o'), expected, 'Oxigraph direct binding')
    }
    for await (const row of await client.queryBindings(select)) {
      expectTerm(row.get('o'), expected, 'Oxigraph adapted binding')
    }
  })
  for (const consume of [direct, wrapped]) {
    await finish(async (releases) => {
      releases.push(retire)
      const value = await consume(select)
      if (value.count !== 1 || value.values[0] !== 'v1729') {
        throw new Error('Oxigraph binding oracle differs.')
      }
    })
  }
  group('Oxigraph adapter: 10k-quad store', () => {
    bench('direct ASK', () => do_not_optimize(view.query(ask)))
    bench('@okikio ASK adapter', async () => do_not_optimize(await client.queryBoolean(ask)))
    bench('direct SELECT consume bindings + retire', () => {
      retiring(() => {
        do_not_optimize(direct(select))
      })
    }).gc('inner')
    bench('@okikio SELECT consume bindings + retire', async () => {
      await finish(async (releases) => {
        releases.push(retire)
        do_not_optimize(await wrapped(select))
      })
    }).gc('inner')
  })
  await report()
} catch (error) {
  failures.push(error)
} finally {
  try {
    retire()
  } catch (error) {
    failures.push(error)
  }
  try {
    free.call(store)
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) throw new AggregateError(failures, 'Owned Oxigraph benchmark failed.')
