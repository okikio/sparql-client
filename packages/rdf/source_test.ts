import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad } from './mod.ts'
import { iterate } from './source.ts'

const value = quad(namedNode('urn:s'), namedNode('urn:p'), literal('o'))

describe('@okikio/rdf source iteration', () => {
  it('rejects cancellation that arrives with the next value before admitting that value', async () => {
    const controller = new AbortController()
    const source = {
      [Symbol.iterator]() {
        return {
          next() {
            controller.abort(new Error('abort with value'))
            return { done: false as const, value }
          },
        }
      },
    }
    await expect(iterate(source, { signal: controller.signal }).next()).rejects.toThrow(
      'abort with value',
    )
  })
  it('settles a pending source read on abort and returns the iterator exactly once', async () => {
    const controller = new AbortController()
    let returned = 0
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const source: AsyncIterable<typeof value> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            entered()
            return new Promise<IteratorResult<typeof value>>(() => {})
          },
          return() {
            returned++
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }
    const iterator = iterate(source, { signal: controller.signal })
    const pending = iterator.next()
    await started
    controller.abort(new Error('stop pending RDF input'))
    await expect(pending).rejects.toThrow('stop pending RDF input')
    expect(returned).toBe(1)
  })

  it('does not acquire an iterator for pre-aborted work', async () => {
    let acquired = 0
    const source = {
      [Symbol.iterator]() {
        acquired++
        return [value][Symbol.iterator]()
      },
    }
    await expect(iterate(source, { signal: AbortSignal.abort() }).next()).rejects.toThrow()
    expect(acquired).toBe(0)
  })

  it('returns upstream once when the consumer stops early', async () => {
    let returned = 0
    const source = {
      [Symbol.iterator]() {
        return {
          next: () => ({ done: false as const, value }),
          return() {
            returned++
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    for await (const _ of iterate(source)) break
    expect(returned).toBe(1)
  })

  it('preserves source and cleanup failures together', async () => {
    const primary = new Error('source failure'), cleanup = new Error('cleanup failure')
    const source = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<typeof value> {
            throw primary
          },
          return(): IteratorResult<typeof value> {
            throw cleanup
          },
        }
      },
    }
    await expect(iterate(source).next()).rejects.toMatchObject({
      cause: primary,
      errors: [primary, cleanup],
    })
  })
  it('adapts synchronous and asynchronous quad sources to one async contract', async () => {
    const sync = []
    for await (const item of iterate([value])) sync.push(item)

    async function* asyncSource() {
      yield value
    }
    const asyncValues = []
    for await (const item of iterate(asyncSource())) asyncValues.push(item)

    expect(sync).toHaveLength(1)
    expect(asyncValues).toHaveLength(1)
    expect(sync[0]?.equals(value)).toBe(true)
    expect(asyncValues[0]?.equals(value)).toBe(true)
  })
})
