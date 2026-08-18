import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { strlit, triple, update } from '../mod.ts'
import { create, QueryError } from './mod.ts'

describe('@okikio/sparql/http', () => {
  it('keeps SELECT bindings as RDF terms', async () => {
    const client = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () =>
        new Response(
          JSON.stringify({
            head: { vars: ['name'] },
            results: {
              bindings: [{ name: { type: 'literal', value: 'Alice', 'xml:lang': 'en' } }],
            },
          }),
          { headers: { 'content-type': 'application/sparql-results+json' } },
        ),
    })
    const rows = []
    for await (const row of await client.queryBindings('SELECT ?name WHERE {}')) rows.push(row)
    expect(rows[0]?.get('name')?.termType).toBe('Literal')
  })

  it('parses graph result media types without converting RDF terms to bindings', async () => {
    const client = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () =>
        new Response('<urn:s> <urn:p> "o" <urn:g> .\n', {
          headers: { 'content-type': 'application/n-quads; version=1.2' },
        }),
    })
    const values = []
    for await (const value of await client.queryQuads('CONSTRUCT WHERE { ?s ?p ?o }')) {
      values.push(value)
    }
    expect(values).toHaveLength(1)
    expect(values[0]?.graph.value).toBe('urn:g')
  })

  it('rejects graph and binding media types that do not match the requested result mode', async () => {
    const bindingClient = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () => new Response('plain', { headers: { 'content-type': 'text/plain' } }),
    })
    await expect(bindingClient.queryBindings('SELECT * WHERE {}')).rejects.toThrow(
      'Expected SPARQL JSON',
    )

    const graphClient = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    })
    await expect(graphClient.queryQuads('CONSTRUCT WHERE { ?s ?p ?o }')).rejects.toThrow(
      'Unsupported RDF graph',
    )
  })

  it('enforces response byte limits before JSON decoding', async () => {
    const client = create({
      endpoint: 'https://example.com/sparql',
      maxResponseBytes: 8,
      fetch: async () =>
        new Response('{"boolean":true}', {
          headers: { 'content-type': 'application/sparql-results+json' },
        }),
    })
    try {
      await client.queryBoolean('ASK {}')
      throw new Error('Expected response limit failure.')
    } catch (error) {
      expect(error instanceof QueryError).toBe(true)
      if (error instanceof QueryError) expect(error.kind).toBe('limit')
    }
  })

  it('cancels a response body whose read is already pending', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const client = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () =>
        new Response(body, { headers: { 'content-type': 'application/sparql-results+json' } }),
    })
    const controller = new AbortController()
    const pending = client.queryBoolean('ASK {}', { signal: controller.signal })
    await Promise.resolve()
    controller.abort(new Error('stop-http'))
    await expect(pending).rejects.toThrow('stop-http')
    expect(cancelled).toBe(true)
  })

  it('uses the configured update endpoint and SPARQL Update media type', async () => {
    let requestUrl = ''
    let contentType = ''
    let body = ''
    const client = create({
      endpoint: 'https://example.com/query',
      updateEndpoint: 'https://example.com/update',
      fetch: async (input, init) => {
        requestUrl = String(input)
        const headers = new Headers(init?.headers)
        contentType = headers.get('content-type') ?? ''
        body = String(init?.body ?? '')
        return new Response(null, { status: 204 })
      },
    })
    const document = update().insertData(triple('urn:s', 'urn:p', strlit('o'))).build()
    await client.update(document)
    expect(requestUrl).toBe('https://example.com/update')
    expect(contentType).toBe('application/sparql-update; charset=utf-8')
    expect(body.includes('INSERT DATA')).toBe(true)
  })

  it('normalizes non-success responses into bounded HTTP errors', async () => {
    const client = create({
      endpoint: 'https://example.com/sparql',
      fetch: async () =>
        new Response('temporarily unavailable', { status: 503, statusText: 'Unavailable' }),
    })
    try {
      await client.queryBoolean('ASK {}')
      throw new Error('Expected HTTP failure.')
    } catch (error) {
      expect(error instanceof QueryError).toBe(true)
      if (error instanceof QueryError) {
        expect(error.kind).toBe('http')
        expect(error.details.status).toBe(503)
      }
    }
  })
})

it('supports SPARQL Protocol GET query dataset parameters without moving them into the body', async () => {
  let method = ''
  let url = ''
  let body: BodyInit | null | undefined
  const client = create({
    endpoint: 'https://example.com/sparql?existing=1',
    fetch: async (input, init) => {
      method = init?.method ?? ''
      url = String(input)
      body = init?.body
      return new Response(JSON.stringify({ boolean: true }), {
        headers: { 'content-type': 'application/sparql-results+json' },
      })
    },
  })

  expect(
    await client.queryBoolean('ASK {}', {
      queryMethod: 'get',
      queryDataset: {
        defaultGraphUris: ['https://example.com/default'],
        namedGraphUris: ['https://example.com/named'],
      },
    }),
  ).toBe(true)

  const target = new URL(url)
  expect(method).toBe('GET')
  expect(body).toBeUndefined()
  expect(target.searchParams.get('existing')).toBe('1')
  expect(target.searchParams.get('query')).toBe('ASK {}')
  expect(target.searchParams.getAll('default-graph-uri')).toEqual(['https://example.com/default'])
  expect(target.searchParams.getAll('named-graph-uri')).toEqual(['https://example.com/named'])
})

it('supports form-encoded SPARQL query and update protocol requests', async () => {
  const requests: Array<{ url: string; contentType: string; body: string }> = []
  const client = create({
    endpoint: 'https://example.com/sparql',
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        contentType: new Headers(init?.headers).get('content-type') ?? '',
        body: String(init?.body ?? ''),
      })
      return requests.length === 1
        ? new Response(JSON.stringify({ boolean: true }), {
          headers: { 'content-type': 'application/sparql-results+json' },
        })
        : new Response(null, { status: 204 })
    },
  })

  await client.queryBoolean('ASK {}', {
    queryMethod: 'post-form',
    queryDataset: { defaultGraphUris: ['https://example.com/default'] },
  })
  await client.update('CLEAR DEFAULT', {
    updateMethod: 'post-form',
    updateDataset: { usingNamedGraphUris: ['https://example.com/named'] },
  })

  expect(requests[0]?.url).toBe('https://example.com/sparql')
  expect(requests[0]?.contentType).toBe('application/x-www-form-urlencoded; charset=utf-8')
  const query = new URLSearchParams(requests[0]?.body)
  expect(query.get('query')).toBe('ASK {}')
  expect(query.getAll('default-graph-uri')).toEqual(['https://example.com/default'])

  expect(requests[1]?.contentType).toBe('application/x-www-form-urlencoded; charset=utf-8')
  const update = new URLSearchParams(requests[1]?.body)
  expect(update.get('update')).toBe('CLEAR DEFAULT')
  expect(update.getAll('using-named-graph-uri')).toEqual(['https://example.com/named'])
})

it('keeps direct POST dataset parameters in the request URL', async () => {
  let url = ''
  let body = ''
  const client = create({
    endpoint: 'https://example.com/sparql',
    fetch: async (input, init) => {
      url = String(input)
      body = String(init?.body ?? '')
      return new Response(JSON.stringify({ boolean: true }), {
        headers: { 'content-type': 'application/sparql-results+json' },
      })
    },
  })
  await client.queryBoolean('ASK {}', {
    queryDataset: { namedGraphUris: ['https://example.com/named'] },
  })
  expect(new URL(url).searchParams.getAll('named-graph-uri')).toEqual(['https://example.com/named'])
  expect(body).toBe('ASK {}')
})
