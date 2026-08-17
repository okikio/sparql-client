import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal } from '@okikio/rdf'
import { select, triple, update } from '@okikio/sparql'
import { createClient, type ResultStreamType } from './mod.ts'

describe('@okikio/comunica', () => {
  it('forwards caller-owned query context and structured documents', async () => {
    let seen: unknown
    let queryText = ''
    let updateText = ''
    const client = createClient({
      queryBoolean: async (query: string, context?: unknown) => { queryText = query; seen = context; return true },
      queryVoid: async (query: string) => { updateText = query },
      queryBindings: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      queryQuads: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
    }, { context: () => ({ source: 'memory' }) })

    const query = select('*').where(triple('?s', '?p', '?o'))
    expect(await client.queryBoolean(query)).toBe(true)
    await client.update(update().deleteWhere(triple('?s', '?p', '?o')))
    expect(seen).toEqual({ source: 'memory' })
    expect(queryText).toBe(query.build().value)
    expect(updateText).toBe('DELETE WHERE { ?s ?p ?o . }')
  })

  it('destroys caller-owned result work when the consumer returns early', async () => {
    let destroyed = false
    const stream: ResultStreamType<Map<string, ReturnType<typeof literal>>> = {
      async *[Symbol.asyncIterator]() {
        yield new Map([['name', literal('Alice')]])
        yield new Map([['name', literal('Bob')]])
      },
      destroy() { destroyed = true },
    }
    const client = createClient({
      queryBindings: async () => stream,
      queryQuads: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      queryBoolean: async () => true,
      queryVoid: async () => undefined,
    })

    for await (const row of await client.queryBindings('SELECT ?name WHERE {}')) {
      expect(row.get('name')?.value).toBe('Alice')
      break
    }
    expect(destroyed).toBe(true)
  })
})
