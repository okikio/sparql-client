import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal } from '@okikio/rdf'
import { select, triple, update } from '@okikio/sparql'
import { create, type ResultStream } from './mod.ts'

describe('@okikio/comunica', () => {
  it('forwards caller-owned query context and structured documents', async () => {
    let seen: unknown
    let queryText = ''
    let updateText = ''
    const client = create({
      queryBoolean: (query: string, context?: unknown) => {
        queryText = query
        seen = context
        return Promise.resolve(true)
      },
      queryVoid: (query: string) => {
        updateText = query
        return Promise.resolve()
      },
      queryBindings: () => Promise.resolve({ [Symbol.asyncIterator]: async function* () {} }),
      queryQuads: () => Promise.resolve({ [Symbol.asyncIterator]: async function* () {} }),
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
    const stream: ResultStream<Map<string, ReturnType<typeof literal>>> = {
      async *[Symbol.asyncIterator]() {
        yield { *[Symbol.iterator]() { yield ['name', literal('Alice')] as const } }
        yield { *[Symbol.iterator]() { yield ['name', literal('Bob')] as const } }
      },
      destroy() {
        destroyed = true
      },
    }
    const client = create({
      queryBindings: () => Promise.resolve(stream),
      queryQuads: () => Promise.resolve({ [Symbol.asyncIterator]: async function* () {} }),
      queryBoolean: () => Promise.resolve(true),
      queryVoid: () => Promise.resolve(),
    })

    for await (const row of await client.queryBindings('SELECT ?name WHERE {}')) {
      expect(row.get('name')?.value).toBe('Alice')
      break
    }
    expect(destroyed).toBe(true)
  })
})
