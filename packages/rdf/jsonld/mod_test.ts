import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad, RDF } from '../mod.ts'
import {
  compact,
  createDocumentLoader,
  expand,
  flatten,
  frame,
  fromRdf,
  JsonLdError,
  JsonLdLoadError,
  serialize,
  toRdf,
} from './mod.ts'

/** Creates a caller-owned loader that returns one supplied HTML document. */
function htmlLoad(source: string, documentUrl = 'https://example.test/page') {
  // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
  return async () => ({ contextUrl: null, documentUrl, document: source })
}

describe('@okikio/rdf/jsonld', () => {
  it('keeps remote loading disabled unless the caller explicitly enables or supplies it', async () => {
    await expect(createDocumentLoader()('https://example.test/context')).rejects.toThrow('disabled')
  })

  it('deduplicates concurrent caller-owned remote document loads', async () => {
    let loads = 0
    const load = createDocumentLoader({
      async loadDocument(url) {
        loads++
        await Promise.resolve()
        return { contextUrl: null, documentUrl: url, document: { '@context': {} } }
      },
    })
    const [left, right] = await Promise.all([
      load('https://example.test/context'),
      load('https://example.test/context'),
    ])
    expect(loads).toBe(1)
    expect(left).toBe(right)
  })

  it('matches the W3C basic expansion shape without an external processor', async () => {
    const value = {
      '@context': {
        t1: 'http://example.com/t1',
        t2: 'http://example.com/t2',
        term1: 'http://example.com/term1',
        term2: 'http://example.com/term2',
        term3: 'http://example.com/term3',
        term4: 'http://example.com/term4',
        term5: 'http://example.com/term5',
      },
      '@id': 'http://example.com/id1',
      '@type': 't1',
      term1: 'v1',
      term2: { '@value': 'v2', '@type': 't2' },
      term3: { '@value': 'v3', '@language': 'en' },
      term4: 4,
      term5: [50, 51],
    }
    expect(await expand(value)).toEqual([{
      '@id': 'http://example.com/id1',
      '@type': ['http://example.com/t1'],
      'http://example.com/term1': [{ '@value': 'v1' }],
      'http://example.com/term2': [{ '@value': 'v2', '@type': 'http://example.com/t2' }],
      'http://example.com/term3': [{ '@value': 'v3', '@language': 'en' }],
      'http://example.com/term4': [{ '@value': 4 }],
      'http://example.com/term5': [{ '@value': 50 }, { '@value': 51 }],
    }])
  })

  it('expands transparent @nest into the containing node', async () => {
    expect(
      await expand({
        '@context': { '@vocab': 'http://example.org/' },
        p1: 'v1',
        '@nest': { p2: 'v2' },
      }),
    ).toEqual([{
      'http://example.org/p1': [{ '@value': 'v1' }],
      'http://example.org/p2': [{ '@value': 'v2' }],
    }])
  })

  it('expands nested @nest values from their actual source object', async () => {
    expect(
      await expand({
        '@context': { '@vocab': 'https://example.test/' },
        '@nest': { '@nest': { name: 'Nested' } },
      }),
    ).toEqual([{
      'https://example.test/name': [{ '@value': 'Nested' }],
    }])
  })

  it('bounds nested @nest work with an explicit depth limit', async () => {
    await expect(
      expand(
        {
          '@context': { '@vocab': 'https://example.test/' },
          '@nest': { '@nest': { name: 'Too deep' } },
        },
        { maxNestDepth: 1 },
      ),
    ).rejects.toThrow('configured limit of 1')
  })

  it('unwraps context documents and matches W3C compact test 0001', async () => {
    expect(
      await compact(
        { '@id': 'http://example.org/test#example' },
        { '@context': {} },
      ),
    ).toEqual({})
  })

  it('keeps prototype-looking JSON keys as data', async () => {
    const input = JSON.parse(
      '{"@context":{"__proto__":"https://example.test/proto"},"__proto__":"safe"}',
    )
    const output = await expand(input)
    const node = output[0] as Record<string, unknown>

    expect(Object.hasOwn(node, 'https://example.test/proto')).toBe(true)
    expect(node['https://example.test/proto']).toEqual([{ '@value': 'safe' }])
  })

  it('expands language maps and reverse relationships', async () => {
    const language = await expand({
      '@context': {
        vocab: 'http://example.com/vocab/',
        label: { '@id': 'vocab:label', '@container': '@language' },
      },
      '@id': 'http://example.com/queen',
      label: { en: 'The Queen', de: ['Die Königin', 'Ihre Majestät'] },
    }, { ordered: true })
    const languageNode = language[0] as Record<string, unknown>
    expect(languageNode['http://example.com/vocab/label']).toEqual([
      { '@value': 'Die Königin', '@language': 'de' },
      { '@value': 'Ihre Majestät', '@language': 'de' },
      { '@value': 'The Queen', '@language': 'en' },
    ])

    const reverse = await expand({
      '@context': { name: 'http://xmlns.com/foaf/0.1/name' },
      '@id': 'http://example.com/people/markus',
      name: 'Markus',
      '@reverse': {
        'http://xmlns.com/foaf/0.1/knows': {
          '@id': 'http://example.com/people/dave',
          name: 'Dave',
        },
      },
    })
    const reverseNode = reverse[0] as Record<string, unknown>
    expect(reverseNode['@reverse']).toBeDefined()
  })

  it('compacts, flattens, and frames native expanded data', async () => {
    const input = {
      '@context': {
        name: 'https://schema.org/name',
        knows: { '@id': 'https://schema.org/knows', '@type': '@id' },
      },
      '@id': 'https://example.test/a',
      name: 'A',
      knows: 'https://example.test/b',
    }
    const compacted = await compact(input, {
      name: 'https://schema.org/name',
      knows: { '@id': 'https://schema.org/knows', '@type': '@id' },
    })
    expect(compacted).toBeDefined()
    const flat = await flatten(input)
    expect(Array.isArray(flat)).toBe(true)
    const framed = await frame(input, {
      '@context': { name: 'https://schema.org/name' },
      '@type': {},
      name: {},
    })
    expect(framed).toBeDefined()
  })

  it('converts RDF collections in both directions without an N-Quads intermediary', async () => {
    const input = {
      '@context': { items: { '@id': 'https://example.test/items', '@container': '@list' } },
      '@id': 'https://example.test/s',
      items: ['a', 'b'],
    }
    const values = await toRdf(input)
    expect(values.some((value) => value.predicate.value === RDF.first)).toBe(true)
    const output = await fromRdf(values)
    expect(JSON.stringify(output)).toContain('@list')
    expect(await serialize(values)).toMatch(/@list/u)
  })

  it('extracts raw application/ld+json scripts and honors a document fragment target', async () => {
    const html =
      `<script id="first" type="application/ld+json">{"@context":{"name":"https://schema.org/name"},"@id":"urn:first","name":"1 < 2"}</script><script id="second" type="application/ld+json">{"@context":{"name":"https://schema.org/name"},"@id":"urn:second","name":"selected"}</script>`
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const load = async (url: string) => ({
      contextUrl: null,
      documentUrl: `${url}#second`,
      document: html,
    })
    const output = await expand('https://example.test/page', { loadDocument: load })
    const selected = output[0] as Record<string, unknown>
    expect(selected['@id']).toBe('urn:second')
    expect(selected['https://schema.org/name']).toEqual([{ '@value': 'selected' }])
  })

  it('preserves an input fragment when Fetch omits it from the response URL', async () => {
    const body = [
      '<script id="first" type="application/ld+json">{"@context":{"p":"urn:p"},"@id":"urn:first","p":"first"}</script>',
      '<script id="second" type="application/ld+json">{"@context":{"p":"urn:p"},"@id":"urn:second","p":"second"}</script>',
    ].join('')
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const fetch: typeof globalThis.fetch = async () => {
      const response = new Response(body, { headers: { 'content-type': 'text/html' } })
      Object.defineProperty(response, 'url', { value: 'https://example.test/page' })
      return response
    }
    const output = await expand('https://example.test/page#second', { remote: true, fetch })
    expect((output[0] as Record<string, unknown>)['@id']).toBe('urn:second')
  })

  it('inherits an HTML fragment through redirects that omit a fragment', async () => {
    const body = [
      '<script id="first" type="application/ld+json">{"@context":{"p":"urn:p"},"@id":"urn:first","p":"first"}</script>',
      '<script id="second" type="application/ld+json">{"@context":{"p":"urn:p"},"@id":"urn:second","p":"second"}</script>',
    ].join('')
    let requests = 0
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const fetch: typeof globalThis.fetch = async (input) => {
      requests++
      if (requests === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: '/final' },
        })
      }
      expect(String(input)).toBe('https://example.test/final#second')
      const response = new Response(body, { headers: { 'content-type': 'text/html' } })
      Object.defineProperty(response, 'url', { value: 'https://example.test/final' })
      return response
    }
    const output = await expand('https://example.test/start#second', { remote: true, fetch })
    expect((output[0] as Record<string, unknown>)['@id']).toBe('urn:second')
  })

  it('follows application/ld+json alternate links only for non-JSON media', async () => {
    let requests = 0
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const fetch: typeof globalThis.fetch = async (input) => {
      requests++
      if (requests === 1) {
        expect(String(input)).toBe('https://example.test/page')
        return new Response('<html></html>', {
          headers: {
            'content-type': 'text/html',
            link: '<alternate.jsonld>; rel="alternate"; type="application/ld+json"',
          },
        })
      }
      expect(String(input)).toBe('https://example.test/alternate.jsonld')
      return new Response('{"@context":{"p":"urn:p"},"p":"alternate"}', {
        headers: { 'content-type': 'application/ld+json' },
      })
    }
    const output = await expand('https://example.test/page', { remote: true, fetch })
    expect((output[0] as Record<string, unknown>)['urn:p']).toEqual([{ '@value': 'alternate' }])
    expect(requests).toBe(2)

    requests = 0
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const jsonFetch: typeof globalThis.fetch = async () => {
      requests++
      return new Response('{"@context":{"p":"urn:p"},"p":"original"}', {
        headers: {
          'content-type': 'application/json',
          link: '<alternate.jsonld>; rel="alternate"; type="application/ld+json"',
        },
      })
    }
    const json = await expand('https://example.test/page', { remote: true, fetch: jsonFetch })
    expect((json[0] as Record<string, unknown>)['urn:p']).toEqual([{ '@value': 'original' }])
    expect(requests).toBe(1)
  })

  it('reports JSON-LD loader codes for unsupported media and duplicate context links', async () => {
    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const unsupported: typeof globalThis.fetch = async () =>
      new Response('{"@id":"urn:value"}', { headers: { 'content-type': 'application/example' } })
    try {
      await expand('https://example.test/value', { remote: true, fetch: unsupported })
      throw new Error('Expected unsupported remote media to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonLdLoadError)
      if (error instanceof JsonLdLoadError) {
        expect(error.kind).toBe('media')
        expect(error.code).toBe('loading document failed')
      }
    }

    // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
    const duplicate: typeof globalThis.fetch = async () =>
      new Response('{"name":"value"}', {
        headers: {
          'content-type': 'application/json',
          link: [
            '<a.jsonld>; rel="http://www.w3.org/ns/json-ld#context"',
            '<b.jsonld>; rel="http://www.w3.org/ns/json-ld#context"',
          ].join(', '),
        },
      })
    try {
      await expand('https://example.test/value', { remote: true, fetch: duplicate })
      throw new Error('Expected duplicate JSON-LD context links to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonLdLoadError)
      if (error instanceof JsonLdLoadError) expect(error.code).toBe('multiple context link headers')
    }
  })

  it('merges every selected HTML JSON-LD script when extractAllScripts is true', async () => {
    const html = [
      '<script type="application/ld+json">',
      '[{"@context":{"p":"urn:p"},"@id":"urn:a","p":"a"},',
      '{"@context":{"p":"urn:p"},"@id":"urn:b","p":"b"}]',
      '</script>',
      '<script type="application/ld+json">',
      '{"@context":{"p":"urn:p"},"@id":"urn:c","p":"c"}',
      '</script>',
    ].join('')
    const output = await expand('https://example.test/page', {
      extractAllScripts: true,
      loadDocument: htmlLoad(html),
    })
    expect(output.map((value) => (value as Record<string, unknown>)['@id'])).toEqual([
      'urn:a',
      'urn:b',
      'urn:c',
    ])
  })

  it('treats all HTML scripts as one To RDF input by default', async () => {
    const body = [
      '<script type="application/ld+json">',
      '{"@context":{"p":"urn:p"},"@id":"urn:a","p":"a"}',
      '</script>',
      '<script type="application/ld+json">',
      '{"@context":{"p":"urn:p"},"@id":"urn:b","p":"b"}',
      '</script>',
    ].join('')
    const loadDocument = htmlLoad(body)
    expect(await toRdf('https://example.test/page', { loadDocument })).toHaveLength(2)
    expect(
      await toRdf('https://example.test/page', { extractAllScripts: false, loadDocument }),
    ).toHaveLength(1)
    expect(
      await toRdf('https://example.test/page', { loadDocument: htmlLoad('<html></html>') }),
    ).toEqual([])
  })

  it('uses JSON-LD HTML error codes for missing and invalid script content', async () => {
    await expect(
      expand('https://example.test/page', { loadDocument: htmlLoad('<html></html>') }),
    ).rejects.toThrow('no application/ld+json script')
    expect(
      await expand('https://example.test/page', {
        extractAllScripts: true,
        loadDocument: htmlLoad('<html></html>'),
      }),
    ).toEqual([])

    try {
      await expand('https://example.test/page', {
        loadDocument: htmlLoad('<script type="application/ld+json">{/* comment */}</script>'),
      })
      throw new Error('Expected invalid HTML JSON-LD script to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonLdError)
      if (error instanceof JsonLdError) expect(error.code).toBe('invalid script element')
    }
  })

  it('resolves HTML document base separately from an explicit base override', async () => {
    const body = [
      '<html><head><base href="http://a.example.com/base">',
      '<script type="application/ld+json">',
      '{"@context":{"foo":"http://example.com/foo"},"@id":"","foo":"bar"}',
      '</script></head></html>',
    ].join('')
    const loadDocument = htmlLoad(body)
    const documentBase = await expand('https://example.test/page', { loadDocument })
    expect((documentBase[0] as Record<string, unknown>)['@id']).toBe('http://a.example.com/base')

    const explicitBase = await expand('https://example.test/page', {
      base: 'http://override.example/doc',
      loadDocument,
    })
    expect((explicitBase[0] as Record<string, unknown>)['@id']).toBe(
      'http://override.example/doc',
    )
  })

  it('decodes a fragment before selecting its JSON-LD script id', async () => {
    const html = [
      '<script id="first" type="application/ld+json">{"@id":"urn:first"}</script>',
      '<script id="second item" type="application/ld+json">',
      '{"@context":{"p":"urn:p"},"@id":"urn:second","p":"selected"}',
      '</script>',
    ].join('')
    const url = 'https://example.test/page#second%20item'
    const output = await expand(url, { loadDocument: htmlLoad(html, url) })
    expect((output[0] as Record<string, unknown>)['@id']).toBe('urn:second')
  })

  it('round-trips ordinary native RDF values', async () => {
    const values = [
      quad(
        namedNode('https://example.test/s'),
        namedNode('https://example.test/p'),
        namedNode('https://example.test/o'),
      ),
    ]
    expect(await fromRdf(values)).toEqual([{
      '@id': 'https://example.test/s',
      'https://example.test/p': [{ '@id': 'https://example.test/o' }],
    }])
  })
})
