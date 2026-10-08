import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import { create } from './mod.ts'

const source = quad(
  namedNode('urn:s'),
  namedNode('urn:p'),
  namedNode('urn:o'),
  namedNode('urn:source'),
)

describe('@okikio/sparql/graph-store', () => {
  it('rejects malformed UTF-8 graph bytes and releases the acquired body', async () => {
    let canceled = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<urn:s> <urn:p> "'))
        controller.enqueue(new Uint8Array([0xff]))
        controller.enqueue(new TextEncoder().encode('" .'))
      },
      cancel() {
        canceled++
      },
    }, { highWaterMark: 0 })
    const client = create({
      endpoint: 'https://example.test/data',
      fetch: () =>
        Promise.resolve(
          new Response(stream, {
            headers: { 'content-type': 'application/n-triples' },
          }),
        ),
    })
    await expect(client.get({ default: true })).rejects.toMatchObject({
      kind: 'protocol',
      cause: expect.any(TypeError),
    })
    expect(canceled).toBe(1)
    expect(stream.locked).toBe(false)
  })

  it('preserves graph characters split across UTF-8 response chunks', async () => {
    const bytes = new TextEncoder().encode('<urn:s> <urn:p> "€🙂" .')
    const client = create({
      endpoint: 'https://example.test/data',
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
                controller.close()
              },
            }),
            { headers: { 'content-type': 'application/n-triples' } },
          ),
        ),
    })
    expect((await client.get({ default: true }))[0]?.object.value).toBe('€🙂')
  })
  it('separates stalled header/body abort from uncooperative cleanup and retires late responses', {
    timeout: 5000,
  }, async () => {
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const retired = Promise.withResolvers<void>()
    let cancels = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancels++
        retired.resolve()
        return new Promise(() => {})
      },
    }, { highWaterMark: 0 })
    const headers = create({
      endpoint: 'https://example.test/data',
      fetch: () => {
        entered.resolve()
        return response.promise
      },
    })
    const reading = headers.get({ default: true }, { signal: controller.signal })
    await entered.promise
    controller.abort(null)
    await expect(reading).rejects.toBe(null)
    response.resolve(new Response(body, { headers: { 'content-type': 'application/n-triples' } }))
    await retired.promise
    expect(cancels).toBe(1)
    expect(body.locked).toBe(false)

    const pulling = Promise.withResolvers<void>()
    const stopped = Promise.withResolvers<{ cleanup: Promise<void> }>()
    const bodyController = new AbortController()
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        pulling.resolve()
        return new Promise(() => {})
      },
      cancel() {
        cancels++
        return new Promise(() => {})
      },
    }, { highWaterMark: 0 })
    const client = create({
      endpoint: 'https://example.test/data',
      fetch: () =>
        Promise.resolve(
          new Response(stalled, { headers: { 'content-type': 'application/n-triples' } }),
        ),
    })
    const next = client.get({ default: true }, {
      signal: bodyController.signal,
      onCleanup: (cleanup) => stopped.resolve({ cleanup }),
    })
    await pulling.promise
    bodyController.abort(null)
    await expect(next).rejects.toBe(null)
    await stopped.promise
    expect(stalled.locked).toBe(false)
    expect(cancels).toBe(2)
  })

  it('isolates blank labels in separate downloaded graph documents', async () => {
    const client = create({
      endpoint: 'http://example.test/',
      fetch: () =>
        Promise.resolve(
          new Response('_:node <urn:test:p> _:node .', {
            headers: { 'content-type': 'application/n-triples' },
          }),
        ),
    })
    const first = await client.get({ graph: 'urn:test:g' }),
      second = await client.get({ graph: 'urn:test:g' })
    expect(first[0]?.subject.equals(first[0].object)).toBe(true)
    expect(first[0]?.subject.equals(second[0]!.subject)).toBe(false)
    expect(first[0]?.graph.value).toBe('urn:test:g')
  })

  it('does not consume mutation input or contact the endpoint after pre-abort', async () => {
    const controller = new AbortController()
    const reason = new Error('stopped before upload')
    controller.abort(reason)
    let consumed = false, fetched = false
    const input = {
      *[Symbol.iterator]() {
        consumed = true
        yield source
      },
    }
    const client = create({
      endpoint: 'http://example.test/',
      fetch: () => {
        fetched = true
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    })
    await expect(client.put({ default: true }, input, { signal: controller.signal })).rejects.toBe(
      reason,
    )
    await expect(client.post({ default: true }, input, { signal: controller.signal })).rejects.toBe(
      reason,
    )
    expect(consumed).toBe(false)
    expect(fetched).toBe(false)
  })

  it('rejects invalid byte limits before sending a request', () => {
    for (const maxResponseBytes of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => create({ endpoint: 'http://example.test/', maxResponseBytes })).toThrow(
        RangeError,
      )
    }
  })

  it('reports malformed graph content as a protocol error', async () => {
    const client = create({
      endpoint: 'http://example.test/',
      fetch: () =>
        Promise.resolve(
          new Response('<urn:s> <urn:p> "unterminated', {
            headers: { 'content-type': 'application/n-triples' },
          }),
        ),
    })
    await expect(client.get({ default: true })).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('cancels rejected media and oversized transfer bodies', async () => {
    for (const media of ['application/n-triples', 'text/html']) {
      let canceled = false
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(128))
        },
        cancel() {
          canceled = true
        },
      })
      const client = create({
        endpoint: 'http://example.test/',
        maxResponseBytes: 32,
        fetch: () => Promise.resolve(new Response(stream, { headers: { 'content-type': media } })),
      })
      await expect(client.get({ default: true })).rejects.toThrow()
      expect(canceled).toBe(true)
      expect(stream.locked).toBe(false)
    }
  })

  it(
    'interrupts a stalled response reader and preserves caller abort reason',
    { timeout: 5_000 },
    async () => {
      let canceled = false
      let entered!: () => void
      const reading = new Promise<void>((resolve) => entered = resolve)
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          entered()
          return new Promise<void>(() => {})
        },
        cancel() {
          canceled = true
        },
      }, { highWaterMark: 0 })
      const controller = new AbortController()
      const reason = new Error('caller stopped graph download')
      const client = create({
        endpoint: 'http://example.test/',
        fetch: () =>
          Promise.resolve(
            new Response(stream, { headers: { 'content-type': 'application/n-triples' } }),
          ),
      })
      const result = client.get({ default: true }, { signal: controller.signal })
      await reading
      controller.abort(reason)
      await expect(result).rejects.toBe(reason)
      expect(canceled).toBe(true)
      expect(stream.locked).toBe(false)
    },
  )

  it('emits the exact default selector used by Graph Store HTTP Protocol', async () => {
    let url = ''
    const client = create({
      endpoint: 'https://example.com/data',
      // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
      fetch: async (input) => {
        url = String(input)
        return new Response(null, { status: 204 })
      },
    })
    await client.delete({ default: true })
    expect(url).toBe('https://example.com/data?default')
  })

  it('percent-encodes named graph selectors without losing endpoint query parameters', async () => {
    let url = ''
    const client = create({
      endpoint: 'https://example.com/data?tenant=a',
      // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
      fetch: async (input) => {
        url = String(input)
        return new Response(null, { status: 204 })
      },
    })
    await client.delete({ graph: 'https://example.com/graph?a=1&b=2' })
    const target = new URL(url)
    expect(target.searchParams.get('tenant')).toBe('a')
    expect(target.searchParams.get('graph')).toBe('https://example.com/graph?a=1&b=2')
  })

  it('writes graph payloads as RDF graphs and reattaches the selected graph on reads', async () => {
    const bodies: string[] = []
    const client = create({
      endpoint: 'https://example.com/data',
      // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
      fetch: async (_input, init) => {
        if (init?.body) bodies.push(String(init.body))
        if (init?.method === 'GET') {
          return new Response('<urn:s> <urn:p> <urn:o> .\n', {
            headers: { 'content-type': 'application/n-triples' },
          })
        }
        return new Response(null, { status: 204 })
      },
    })

    await client.put({ graph: 'urn:target' }, [source])
    expect(bodies[0]).toBe('<urn:s> <urn:p> <urn:o> .\n')
    const values = await client.get({ graph: 'urn:target' })
    expect(values).toHaveLength(1)
    expect(values[0]?.graph.value).toBe('urn:target')
  })
})
