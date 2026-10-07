/** Real HTTP wire contracts and failure behavior independent of any triplestore implementation. @module */
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as http from '@okikio/sparql/http'
import * as graphStore from '@okikio/sparql/graph-store'
import { literal, namedNode, quad } from '@okikio/rdf'

/** Runs a local server on an OS-selected port and waits for shutdown after each scenario. */
async function serve(
  handler: (request: Request) => Response | Promise<Response>,
  run: (endpoint: string) => Promise<void>,
): Promise<void> {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, handler)
  try {
    await run(`http://127.0.0.1:${server.addr.port}/sparql?tenant=fixture`)
  } finally {
    await server.shutdown()
  }
}

/** Returns a standards-shaped JSON response without depending on client decoding. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/sparql-results+json' },
  })
}

describe('real SPARQL HTTP wire contracts', () => {
  for (const mode of ['get', 'post-form', 'post-direct'] as const) {
    it(`sends ${mode} query parameters and authorization on the actual wire`, async () => {
      const query = 'ASK { <urn:☃?x=1&y=2> <urn:p> "a+b & c" }'
      await serve(async (request) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('tenant')).toBe('fixture')
        expect(request.headers.get('authorization')).toBe('Bearer operation')
        let fields: URLSearchParams
        if (mode === 'get') {
          expect(request.method).toBe('GET')
          expect(await request.text()).toBe('')
          fields = url.searchParams
        } else if (mode === 'post-form') {
          expect(request.headers.get('content-type')).toContain('application/x-www-form-urlencoded')
          fields = new URLSearchParams(await request.text())
          expect(url.searchParams.has('query')).toBe(false)
        } else {
          expect(request.headers.get('content-type')).toContain('application/sparql-query')
          expect(await request.text()).toBe(query)
          fields = url.searchParams
        }
        if (mode !== 'post-direct') expect(fields.getAll('query')).toEqual([query])
        expect(fields.getAll('default-graph-uri')).toEqual(['urn:default:a', 'urn:default:b'])
        expect(fields.getAll('named-graph-uri')).toEqual(['urn:named'])
        return json({ head: {}, boolean: true })
      }, async (endpoint) => {
        const headers = new Headers({ authorization: 'Bearer client' })
        const client = http.create({ endpoint, headers, queryMethod: mode })
        expect(
          await client.queryBoolean(query, {
            headers: { authorization: 'Bearer operation' },
            queryDataset: {
              defaultGraphUris: ['urn:default:a', 'urn:default:b'],
              namedGraphUris: ['urn:named'],
            },
          }),
        ).toBe(true)
        expect(headers.get('authorization')).toBe('Bearer client')
      })
    })
  }

  for (const mode of ['post-form', 'post-direct'] as const) {
    it(`sends ${mode} updates and never retries a failed mutation`, async () => {
      let attempts = 0
      await serve(async (request) => {
        attempts++
        const fields = mode === 'post-form'
          ? new URLSearchParams(await request.text())
          : new URL(request.url).searchParams
        expect(fields.getAll('using-graph-uri')).toEqual(['urn:g'])
        expect(fields.getAll('using-named-graph-uri')).toEqual(['urn:n'])
        return new Response('rate limit', { status: 429, headers: { 'retry-after': '0' } })
      }, async (endpoint) => {
        const client = http.create({ endpoint, updateMethod: mode })
        await expect(
          client.update('INSERT DATA {}', {
            updateDataset: { usingGraphUris: ['urn:g'], usingNamedGraphUris: ['urn:n'] },
          }),
        ).rejects.toMatchObject({ kind: 'http', details: { status: 429 } })
        expect(attempts).toBe(1)
      })
    })
  }

  for (const status of [400, 401, 403, 404, 405, 406, 413, 414, 415, 429, 500, 502, 503]) {
    it(`preserves HTTP ${status} without reporting an empty successful result`, async () => {
      await serve(() => new Response('denied', { status }), async (endpoint) => {
        await expect(http.create({ endpoint }).queryBoolean('ASK {}')).rejects.toMatchObject({
          kind: 'http',
          details: { status },
        })
      })
    })
  }

  for (
    const body of [
      '{',
      '{"head":{"vars":["x"]},"results":{"bindings":[{"x":{"type":"unknown","value":"x"}}]}}',
    ]
  ) {
    it('rejects malformed JSON or hostile result terms with a protocol error', async () => {
      await serve(
        () =>
          new Response(body, { headers: { 'content-type': 'application/sparql-results+json' } }),
        async (endpoint) => {
          await expect(http.create({ endpoint }).queryBindings('SELECT ?x WHERE {}')).rejects
            .toMatchObject({ kind: 'protocol' })
        },
      )
    })
  }

  it(
    'cancels stalled response consumption on timeout and caller abort',
    { timeout: 5_000 },
    async () => {
      let reached = () => {}
      await serve(() =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              reached()
              controller.enqueue(new TextEncoder().encode('{'))
            },
          }),
          {
            headers: { 'content-type': 'application/sparql-results+json' },
          },
        ), async (endpoint) => {
        await expect(http.create({ endpoint }).queryBoolean('ASK {}', { timeoutMs: 30 })).rejects
          .toMatchObject({ kind: 'timeout' })
        const signal = AbortSignal.timeout(30)
        await expect(http.create({ endpoint }).queryBoolean('ASK {}', { signal })).rejects
          .toMatchObject({ kind: 'timeout' })
        const controller = new AbortController()
        // Acquire a transition for this request so caller abort proves active
        // wire work rather than only rejecting before the endpoint was reached.
        const current = new Promise<void>((resolve) => reached = resolve)
        const request = http.create({ endpoint }).queryBoolean('ASK {}', {
          signal: controller.signal,
        })
        await current
        controller.abort(new Error('caller stopped'))
        await expect(request).rejects.toMatchObject({ kind: 'abort' })
      })
    },
  )

  it('enforces graph limits during transfer and bounds failed Graph Store bodies', async () => {
    await serve(() =>
      new Response('<urn:s> <urn:p> "'.padEnd(8192, 'x'), {
        headers: { 'content-type': 'application/n-triples' },
      }), async (endpoint) => {
      await expect(graphStore.create({ endpoint, maxResponseBytes: 32 }).get({ default: true }))
        .rejects.toMatchObject({ kind: 'limit' })
      await expect(
        http.create({ endpoint, maxResponseBytes: 32 }).queryQuads('CONSTRUCT {} WHERE {}').then(
          async (source) => {
            for await (const _ of source) { /* Consume the transfer to enforce its limit. */ }
          },
        ),
      ).rejects.toMatchObject({ kind: 'limit' })
    })
    await serve(() => new Response('x'.repeat(100_000), { status: 403 }), async (endpoint) => {
      await expect(http.create({ endpoint }).queryBoolean('ASK {}')).rejects.toMatchObject({
        kind: 'http',
        details: { status: 403, response: 'x'.repeat(16 * 1024) },
      })
      try {
        await graphStore.create({ endpoint }).delete({ default: true })
        throw new Error('HTTP failure was accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(http.QueryError)
        expect((error as http.QueryError).details.response?.length).toBe(16 * 1024)
      }
    })
  })

  it('reports malformed graph syntax through the protocol error contract', async () => {
    await serve(
      () =>
        new Response('<urn:s> <urn:p> "unterminated', {
          headers: { 'content-type': 'application/n-triples' },
        }),
      async (endpoint) => {
        await expect(
          http.create({ endpoint }).queryQuads('CONSTRUCT {} WHERE {}').then(async (source) => {
            for await (const _ of source) { /* Syntax fails during graph consumption. */ }
          }),
        ).rejects.toMatchObject({ kind: 'protocol' })
      },
    )
  })

  it('round-trips embedded quote and Unicode data through Graph Store wire serialization', async () => {
    await serve(async (request) => {
      expect(await request.text()).toBe('<urn:s> <urn:p> "quote \\" 雪" .\n')
      return new Response(null, { status: 204 })
    }, async (endpoint) => {
      await graphStore.create({ endpoint }).put({ graph: 'urn:g' }, [
        quad(namedNode('urn:s'), namedNode('urn:p'), literal('quote " 雪')),
      ])
    })
  })
})
