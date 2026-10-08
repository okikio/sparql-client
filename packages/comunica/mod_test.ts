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
    const change = update().deleteWhere(triple('?s', '?p', '?o'))
    await client.update(change)
    expect(seen).toEqual({ source: 'memory' })
    expect(queryText).toBe(query.build().value)
    expect(updateText).toBe(change.build().value)
  })

  it('destroys caller-owned result work when the consumer returns early', async () => {
    let destroyed = false
    const stream: ResultStream<Iterable<readonly [string, ReturnType<typeof literal>]>> = {
      async *[Symbol.asyncIterator]() {
        yield {
          *[Symbol.iterator]() {
            yield ['name', literal('Alice')] as const
          },
        }
        yield {
          *[Symbol.iterator]() {
            yield ['name', literal('Bob')] as const
          },
        }
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

it('owns unused acquired results and races pending next without disposing the borrowed engine', {
  timeout: 5000,
}, async () => {
  let destroy = 0
  let pulls = 0
  const entered = Promise.withResolvers<void>()
  const stream = {
    destroy() {
      destroy++
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          pulls++
          entered.resolve()
          return new Promise<IteratorResult<unknown>>(() => {})
        },
      }
    },
  }
  const engine = {
    queryBindings: () => Promise.resolve(stream),
    queryQuads: () => Promise.resolve(stream),
    queryBoolean: () => Promise.resolve(true),
    queryVoid: () => Promise.resolve(),
  }
  const client = create(engine)
  const unused = await client.queryBindings('SELECT * WHERE {}')
  await unused.close({ waitForCleanup: true })
  expect(destroy).toBe(1)
  expect(pulls).toBe(0)
  const controller = new AbortController()
  const value = await client.queryBindings('SELECT * WHERE {}', { signal: controller.signal })
  const next = value[Symbol.asyncIterator]().next()
  await entered.promise
  controller.abort(null)
  await expect(next).rejects.toBe(null)
  await value.cleanup
  expect(destroy).toBe(2)
  expect(await client.queryBoolean('ASK {}')).toBe(true)
})

it(
  'retires results acquired after terminal cancellation and never starts pre-aborted acquisition',
  { timeout: 5000 },
  async () => {
    const entered = Promise.withResolvers<void>()
    const delivery = Promise.withResolvers<{
      destroy(): void
      [Symbol.asyncIterator](): AsyncIterator<unknown>
    }>()
    const retired = Promise.withResolvers<void>()
    let opened = 0
    const client = create({
      queryBindings() {
        opened++
        entered.resolve()
        return delivery.promise
      },
      queryQuads: () => Promise.resolve({ async *[Symbol.asyncIterator]() {} }),
      queryBoolean: () => Promise.resolve(true),
      queryVoid: () => Promise.resolve(),
    })
    await expect(client.queryBindings('SELECT * WHERE {}', { signal: AbortSignal.abort(null) }))
      .rejects.toBe(null)
    expect(opened).toBe(0)
    const controller = new AbortController()
    const value = client.queryBindings('SELECT * WHERE {}', { signal: controller.signal })
    await entered.promise
    controller.abort(null)
    await expect(value).rejects.toBe(null)
    let released = 0
    delivery.resolve({
      destroy() {
        released++
        retired.resolve()
      },
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ done: true, value: undefined }) }
      },
    })
    await retired.promise
    expect(released).toBe(1)
  },
)
