/** Controlled response fixtures protect the Schema.org task's network ownership. @module */
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { download } from './schema.ts'

/** Captures even an undefined rejection without promoting it to success. */
async function failure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation
  } catch (error) {
    return error
  }
  throw new Error('Expected the source download to fail.')
}

/** A diagnostic watchdog bounds broken fixture admission; it is not a latency assertion. */
async function watch<Value>(operation: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Source fixture did not settle.')), 5_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('Schema.org task bounded source', () => {
  it('accepts exact-cap multichunk bytes with no length or an understated length', async () => {
    for (const headers of [{}, { 'content-length': '1' }]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 255]))
          controller.enqueue(new Uint8Array([17, 42]))
          controller.close()
        },
      })
      const value = await download('https://source.invalid', {
        maxBytes: 4,
        fetch: () => Promise.resolve(new Response(body, { headers })),
      })
      expect([...value]).toEqual([0, 255, 17, 42])
      expect(body.locked).toBe(false)
    }
  })

  it('rejects an overflowing chunk before another pull and cancels the borrowed body', async () => {
    for (const headers of [{}, { 'content-length': '1' }]) {
      let pulls = 0
      let canceled = 0
      let reason: unknown
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
        cancel(error) {
          canceled++
          reason = error
        },
      }, { highWaterMark: 0 })
      const error = await failure(download('https://source.invalid', {
        maxBytes: 4,
        fetch: () => Promise.resolve(new Response(body, { headers })),
      }))
      expect(error).toBeInstanceOf(RangeError)
      expect(reason).toBe(error)
      expect(pulls).toBe(2)
      expect(canceled).toBe(1)
      expect(body.locked).toBe(false)
    }
  })

  it('cancels rejected status and declared oversize bodies before acquiring their bytes', async () => {
    for (const init of [{ status: 503 }, { headers: { 'content-length': '5' } }]) {
      let pulls = 0
      let canceled = 0
      const body = new ReadableStream<Uint8Array>({
        pull() {
          pulls++
        },
        cancel() {
          canceled++
        },
      }, { highWaterMark: 0 })
      await failure(download('https://source.invalid', {
        maxBytes: 4,
        fetch: () => Promise.resolve(new Response(body, init)),
      }))
      expect(pulls).toBe(0)
      expect(canceled).toBe(1)
      expect(body.locked).toBe(false)
    }
  })

  it('interrupts an admitted pending body with the original caller reason', async () => {
    const started = Promise.withResolvers<void>()
    const caller = new AbortController()
    const reason = new Error('Caller stopped the source.')
    let canceled = 0
    const body = new ReadableStream<Uint8Array>({
      pull() {
        started.resolve()
      },
      cancel(error) {
        expect(error).toBe(reason)
        canceled++
      },
    }, { highWaterMark: 0 })
    const pending = download('https://source.invalid', {
      signal: caller.signal,
      fetch: () => Promise.resolve(new Response(body)),
    })
    const rejected = failure(pending)
    try {
      await watch(started.promise)
    } finally {
      caller.abort(reason)
      await watch(rejected)
    }
    expect(await rejected).toBe(reason)
    expect(canceled).toBe(1)
    expect(body.locked).toBe(false)
  })

  it('forwards header cancellation and rejects pre-aborted acquisition', async () => {
    const started = Promise.withResolvers<void>()
    const caller = new AbortController()
    const reason = new Error('Stop pending headers.')
    const pending = download('https://source.invalid', {
      signal: caller.signal,
      fetch(_url, init) {
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
          started.resolve()
        })
      },
    })
    const rejected = failure(pending)
    try {
      await watch(started.promise)
    } finally {
      caller.abort(reason)
      await watch(rejected)
    }
    expect(await rejected).toBe(reason)
    let fetched = false
    expect(
      await failure(download('https://source.invalid', {
        signal: caller.signal,
        fetch() {
          fetched = true
          return Promise.resolve(new Response())
        },
      })),
    ).toBe(reason)
    expect(fetched).toBe(false)
  })

  it('keeps the deadline active through pending headers and a pending body', async () => {
    const caller = new AbortController()
    const headers = failure(download('https://source.invalid', {
      timeoutMs: 1,
      signal: caller.signal,
      fetch(_url, init) {
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
        })
      },
    }))
    let headerError: unknown
    try {
      headerError = await watch(headers)
    } finally {
      caller.abort()
      await watch(headers)
    }
    expect(headerError).toBeInstanceOf(DOMException)
    expect((headerError as DOMException).name).toBe('TimeoutError')
    let canceled = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled++
      },
    })
    const bodyCaller = new AbortController()
    const pending = failure(download('https://source.invalid', {
      timeoutMs: 1,
      signal: bodyCaller.signal,
      fetch: () => Promise.resolve(new Response(body)),
    }))
    let bodyError: unknown
    try {
      bodyError = await watch(pending)
    } finally {
      bodyCaller.abort()
      await watch(pending)
    }
    expect(bodyError).toBeInstanceOf(DOMException)
    expect((bodyError as DOMException).name).toBe('TimeoutError')
    expect(canceled).toBe(1)
    expect(body.locked).toBe(false)
  })

  it('preserves a byte failure and independent undefined cleanup rejection', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5))
      },
      cancel() {
        return Promise.reject(undefined)
      },
    })
    const error = await failure(download('https://source.invalid', {
      maxBytes: 4,
      fetch: () => Promise.resolve(new Response(body)),
    }))
    expect(error).toBeInstanceOf(AggregateError)
    const combined = error as AggregateError
    expect(combined.errors.length).toBe(2)
    expect(combined.errors[0]).toBeInstanceOf(RangeError)
    expect(combined.errors[1]).toBeUndefined()
    expect(combined.cause).toBe(combined.errors[0])
    expect(body.locked).toBe(false)
  })

  it('rejects invalid physical limits before fetch acquisition', async () => {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (const name of ['maxBytes', 'timeoutMs'] as const) {
        let fetched = false
        const error = await failure(download('https://source.invalid', {
          [name]: value,
          fetch() {
            fetched = true
            return Promise.resolve(new Response())
          },
        }))
        expect(error).toBeInstanceOf(RangeError)
        expect(fetched).toBe(false)
      }
    }
  })
})
