import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { acquire, result } from './stream.ts'

function gate<Value = void>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void
  return {
    promise: new Promise<Value>((yes) => {
      resolve = yes
    }),
    get resolve() {
      return resolve
    },
  }
}

describe('owned query result lifetime', () => {
  it('cancels acquired but never-consumed work and preserves a borrowed engine', async () => {
    let pulls = 0
    let returns = 0
    const controller = new AbortController()
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            pulls++
            return Promise.resolve({ done: false, value: 1 })
          },
          return() {
            returns++
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }
    const value = result(source, { signal: controller.signal })
    controller.abort(null)
    await value.cleanup
    expect(returns).toBe(1)
    expect(pulls).toBe(0)
    await expect(value[Symbol.asyncIterator]().next()).rejects.toBe(null)
    // Closing an operation never makes its borrowed source/engine globally unusable.
    const second = result([2])
    const collected = []
    for await (const item of second) collected.push(item)
    expect(collected).toEqual([2])
    let finished = 0
    const complete = result([1], {
      release: () => {
        finished++
      },
    })
    for await (const _value of complete) { /* Exhaustion requests owned release too. */ }
    await complete.cleanup
    await complete.close()
    expect(finished).toBe(1)
  })

  it('terminates pending next independently of uncooperative return', {
    timeout: 5000,
  }, async () => {
    const entered = gate()
    const controller = new AbortController()
    let returns = 0
    const value = result({
      [Symbol.asyncIterator]() {
        return {
          next() {
            entered.resolve()
            return new Promise<IteratorResult<number>>(() => {})
          },
          return() {
            returns++
            return new Promise<IteratorResult<number>>(() => {})
          },
        }
      },
    }, { signal: controller.signal })
    const next = value[Symbol.asyncIterator]().next()
    await entered.promise
    const reason = new Error('stop pending pull')
    controller.abort(reason)
    await expect(next).rejects.toBe(reason)
    await value.close()
    expect(returns).toBe(1)
  })

  it('preserves primary and cleanup failure including thrown undefined', async () => {
    const cleanup = new Error('cleanup rejected')
    const value = result({
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            throw undefined
          },
          return(): IteratorResult<number> {
            throw cleanup
          },
        }
      },
    })
    await expect(value[Symbol.asyncIterator]().next()).rejects.toBe(undefined)
    try {
      await value.cleanup
      throw new Error('Expected cleanup failure')
    } catch (cause) {
      expect(cause).toBeInstanceOf(AggregateError)
      if (cause instanceof AggregateError) expect(cause.errors).toEqual([undefined, cleanup])
    }
  })

  it('checks pre-abort before acquisition and retires a late acquired resource once', {
    timeout: 5000,
  }, async () => {
    const aborted = AbortSignal.abort(null)
    let opened = 0
    await expect(acquire(
      () => {
        opened++
        return 1
      },
      () => undefined,
      aborted,
    )).rejects.toBe(null)
    expect(opened).toBe(0)
    const entered = gate()
    const release = gate<number>()
    const retired = gate()
    const controller = new AbortController()
    let count = 0
    const observed = gate<{ cleanup: Promise<void> }>()
    const cleanupFailure = new Error('Late retirement failed')
    const acquiring = acquire(
      () => {
        entered.resolve()
        return release.promise
      },
      (value) => {
        expect(value).toBe(7)
        count++
        retired.resolve()
        throw cleanupFailure
      },
      controller.signal,
      (cleanup) => observed.resolve({ cleanup }),
    )
    await entered.promise
    controller.abort(null)
    await expect(acquiring).rejects.toBe(null)
    release.resolve(7)
    await retired.promise
    expect(count).toBe(1)
    const observation = await observed.promise
    await expect(observation.cleanup).rejects.toBe(cleanupFailure)
  })
})
