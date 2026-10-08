import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { create } from './mod.ts'
import { tokens } from '../syntax/mod.ts'

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

describe('HTTP retrieval context and source ownership', () => {
  it('resolves relative Turtle IRIs against the final retrieval URL or prepared request URL', async () => {
    for (const redirected of [false, true]) {
      const client = create({
        endpoint: 'https://example.test/path/sparql?existing=1',
        fetch: () => {
          const response = new Response('<#person> <../predicate> <child> .', {
            headers: { 'content-type': 'text/turtle' },
          })
          if (redirected) {
            Object.defineProperty(response, 'url', { value: 'https://redirect.test/final/result' })
          }
          return Promise.resolve(response)
        },
      })
      const result = await client.queryQuads('CONSTRUCT WHERE { ?s ?p ?o }', { queryMethod: 'get' })
      const quads = []
      for await (const value of result) quads.push(value)
      const origin = redirected ? 'https://redirect.test' : 'https://example.test'
      const root = redirected
        ? `${origin}/final/result`
        : `${origin}/path/sparql?existing=1&query=CONSTRUCT+WHERE+%7B+%3Fs+%3Fp+%3Fo+%7D`
      expect(quads).toHaveLength(1)
      expect(quads[0]?.subject.value).toBe(`${root}#person`)
      expect(quads[0]?.predicate.value).toBe(`${origin}/predicate`)
      expect(quads[0]?.object.value).toBe(
        redirected ? `${origin}/final/child` : `${origin}/path/child`,
      )
    }
  })

  it('owns a never-consumed graph body and exposes uncooperative cleanup separately', {
    timeout: 5000,
  }, async () => {
    let cancels = 0
    let pulls = 0
    const complete = gate()
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulls++
        return new Promise<void>(() => {})
      },
      cancel() {
        cancels++
        return complete.promise
      },
    }, { highWaterMark: 0 })
    const client = create({
      endpoint: 'https://example.test/sparql',
      fetch: () =>
        Promise.resolve(new Response(body, { headers: { 'content-type': 'text/turtle' } })),
    })
    const result = await client.queryQuads('CONSTRUCT WHERE { ?s ?p ?o }')
    await result.close()
    expect(cancels).toBe(1)
    expect(pulls).toBe(0)
    expect(body.locked).toBe(false)
    let cleaned = false
    const cleaning = result.cleanup.then(() => {
      cleaned = true
    })
    await Promise.resolve()
    expect(cleaned).toBe(false)
    complete.resolve()
    await cleaning
    expect(cleaned).toBe(true)
  })

  it('terminates stalled iterable syntax independently of an uncooperative return', {
    timeout: 5000,
  }, async () => {
    const entered = gate()
    const controller = new AbortController()
    let returned = 0
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<string>> {
            entered.resolve()
            return new Promise(() => {})
          },
          return(): Promise<IteratorResult<string>> {
            returned++
            return new Promise(() => {})
          },
        }
      },
    }
    const scanning = tokens(source, { signal: controller.signal })[Symbol.asyncIterator]().next()
    await entered.promise
    controller.abort(null)
    await expect(scanning).rejects.toBe(null)
    expect(returned).toBe(1)
  })

  it('terminates a stalled syntax Web reader, releases its lock and requests cancel once', {
    timeout: 5000,
  }, async () => {
    const entered = gate()
    const controller = new AbortController()
    let cancelled = 0
    const source = new ReadableStream<Uint8Array>({
      pull() {
        entered.resolve()
        return new Promise(() => {})
      },
      cancel() {
        cancelled++
        return new Promise(() => {})
      },
    }, { highWaterMark: 0 })
    const scanning = tokens(source, { signal: controller.signal })[Symbol.asyncIterator]().next()
    await entered.promise
    controller.abort(null)
    await expect(scanning).rejects.toBe(null)
    expect(cancelled).toBe(1)
    expect(source.locked).toBe(false)
  })
})
