import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { finish } from '../integration/releases.ts'

describe('browser fixture ownership', () => {
  it('releases every acquired resource in reverse order and preserves primary failures', async () => {
    const order: string[] = []
    const value = { borrowed: true }
    expect(
      await finish((releases) => {
        releases.push(() => {
          order.push('filesystem')
        })
        releases.push(() => {
          order.push('store')
        })
        return value
      }),
    ).toBe(value)
    expect(order).toEqual(['store', 'filesystem'])

    const cleanup = new Error('fixture cleanup')
    const later = new Error('outer cleanup')
    order.length = 0
    let rejected = false
    let caught: unknown
    try {
      await finish((releases) => {
        releases.push(() => {
          order.push('filesystem')
          throw later
        })
        releases.push(() => {
          order.push('store')
          throw cleanup
        })
        throw undefined
      })
    } catch (error) {
      rejected = true
      caught = error
    }
    expect(rejected).toBe(true)
    expect(order).toEqual(['store', 'filesystem'])
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([undefined, cleanup, later])

    rejected = false
    caught = value
    try {
      await finish((releases) => {
        releases.push(() => {
          throw undefined
        })
        return value
      })
    } catch (error) {
      rejected = true
      caught = error
    }
    expect(rejected).toBe(true)
    expect(caught).toBeUndefined()
  })
})
