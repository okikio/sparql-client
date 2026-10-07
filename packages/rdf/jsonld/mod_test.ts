import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad, RDF, XSD } from '../mod.ts'
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
import type { RemoteDocumentType } from './types.ts'

/** Creates a caller-owned loader that returns one supplied HTML document. */
function htmlLoad(source: string, documentUrl = 'https://example.test/page') {
  // deno-lint-ignore require-await -- Test double intentionally implements an asynchronous runtime contract.
  return async () => ({ contextUrl: null, documentUrl, document: source })
}

describe('@okikio/rdf/jsonld', () => {
  it('frames graph-local identities without replacing one graph with another', async () => {
    const input = {
      '@id': 'urn:owner',
      'urn:proof': { '@graph': { '@id': 'urn:shared', 'urn:p': 'inside' } },
      'urn:subject': { '@id': 'urn:shared', 'urn:p': 'outside' },
    }
    expect(
      await frame(input, {
        '@context': { '@vocab': 'urn:', proof: { '@container': '@graph' } },
        '@graph': { '@id': 'urn:owner' },
      }),
    ).toEqual({
      '@context': { '@vocab': 'urn:', proof: { '@container': '@graph' } },
      '@id': 'urn:owner',
      proof: { '@id': 'urn:shared', p: 'inside' },
      subject: { '@id': 'urn:shared', p: 'outside' },
    })
  })

  it('frames included resources before their ordinary references and honors the context base', async () => {
    const context = {
      '@base': 'https://example.test/',
      '@vocab': 'urn:',
      author: { '@type': '@id' },
      included: { '@id': '@included', '@container': '@set' },
    }
    const input = {
      '@id': 'https://example.test/article',
      '@type': 'urn:Article',
      'urn:author': {
        '@id': 'https://example.test/person',
        '@type': 'urn:Person',
        'urn:name': 'Ada',
      },
    }
    expect(
      await frame(input, {
        '@context': context,
        '@type': 'Article',
        included: { '@type': 'Person' },
      }, { base: 'https://fallback.test/' }),
    ).toEqual({
      '@context': context,
      '@id': 'article',
      '@type': 'Article',
      author: 'person',
      included: [{ '@id': 'person', '@type': 'Person', name: 'Ada' }],
    })
  })

  it('filters framed list references and keeps default markers out of JSON output', async () => {
    const context = { '@vocab': 'urn:', empty: { '@container': '@set' } }
    const input = {
      '@id': 'urn:owner',
      'urn:list': { '@list': [{ '@id': 'urn:keep' }, { '@id': 'urn:discard' }] },
    }
    expect(
      await frame(input, {
        '@context': context,
        '@id': 'urn:owner',
        list: { '@list': [{ '@id': 'urn:keep' }] },
        missing: {},
        empty: { '@default': ['@null'] },
      }),
    ).toEqual({
      '@context': context,
      '@id': 'urn:owner',
      list: { '@list': [{ '@id': 'urn:keep' }] },
      missing: null,
      empty: [],
    })
  })

  it('rejects malformed directional RDF mappings through the public Promise', async () => {
    await expect(
      fromRdf([
        quad(
          namedNode('urn:s'),
          namedNode('urn:p'),
          literal('value', namedNode('https://www.w3.org/ns/i18n#en_sideways')),
        ),
      ], { rdfDirection: 'i18n-datatype' }),
    ).rejects.toMatchObject({ code: 'invalid base direction' })
  })

  it('keeps blank identities local to each independently converted document', async () => {
    const input = {
      '@id': '_:source',
      'urn:p': { '@id': '_:source' },
      'urn:list': { '@list': ['item'] },
      'urn:direction': { '@value': 'value', '@direction': 'ltr' },
    }
    const first = await toRdf(input, { rdfDirection: 'compound-literal' })
    const second = await toRdf(input, { rdfDirection: 'compound-literal' })
    const firstIds = new Set(
      first.flatMap((value) => [value.subject, value.object, value.graph]).filter((term) =>
        term.termType === 'BlankNode'
      ).map((term) => term.value),
    )
    const secondIds = new Set(
      second.flatMap((value) => [value.subject, value.object, value.graph]).filter((term) =>
        term.termType === 'BlankNode'
      ).map((term) => term.value),
    )
    expect(firstIds.size).toBe(3)
    expect([...secondIds].some((id) => firstIds.has(id))).toBe(false)
    for (const values of [first, second]) {
      const relation = values.find((value) => value.predicate.value === 'urn:p')!
      expect(relation.subject.equals(relation.object)).toBe(true)
    }
    const supplied = blankNode('caller-owned')
    expect(await fromRdf([quad(supplied, namedNode('urn:p'), literal('value'))])).toEqual([{
      '@id': '_:caller-owned',
      'urn:p': [{ '@value': 'value' }],
    }])
  })
  it('returns a distinct generalized RDF predicate only through the explicit option', async () => {
    const input = { '@id': '_:subject', '_:subject': { '@id': 'urn:object' } }
    expect(await toRdf(input)).toEqual([])
    const values = await toRdf(input, { produceGeneralizedRdf: true })
    expect(values).toHaveLength(1)
    expect(values[0]!.predicate.termType).toBe('BlankNode')
    expect(values[0]!.subject.equals(values[0]!.predicate)).toBe(true)
    expect(Object.isFrozen(values[0])).toBe(true)
  })

  it('uses canonical numeric and JSON literal spellings in RDF output', async () => {
    const values = await toRdf({
      '@id': 'urn:s',
      'urn:double': 5.3,
      'urn:json': { '@value': { z: [2, 1], a: { '10': 'ten', '1': 'one' } }, '@type': '@json' },
    })
    expect(values.find((value) => value.predicate.value === 'urn:double')!.object.value).toBe(
      '5.3E0',
    )
    expect(values.find((value) => value.predicate.value === 'urn:json')!.object.value).toBe(
      '{"a":{"1":"one","10":"ten"},"z":[2,1]}',
    )
    expect(await toRdf({ '@id': 'urn:invalid subject', 'urn:p': 'discard' })).toEqual([])
    expect(
      await toRdf({
        '@id': 'urn:s',
        'urn:invalid property': 'discard',
        'urn:p': { '@id': 'relative' },
      }, { base: '' }),
    ).toEqual([])
  })

  it('preserves malformed RDF collection cells and reconstructs nested empty lists', async () => {
    const cell = blankNode('cell'),
      source = [
        quad(namedNode('urn:s'), namedNode('urn:p'), cell),
        quad(cell, namedNode(RDF.first), literal('item')),
        quad(cell, namedNode(RDF.rest), namedNode(RDF.nil)),
        quad(cell, namedNode('urn:extra'), literal('keep')),
      ]
    const value = await fromRdf(source)
    expect(value).toHaveLength(2)
    expect(value).toEqual(expect.arrayContaining([{
      '@id': '_:cell',
      [RDF.first]: [{ '@value': 'item' }],
      [RDF.rest]: [{ '@list': [] }],
      'urn:extra': [{ '@value': 'keep' }],
    }, { '@id': 'urn:s', 'urn:p': [{ '@id': '_:cell' }] }]))
    const nested = await fromRdf([
      quad(namedNode('urn:s'), namedNode('urn:p'), cell),
      quad(cell, namedNode(RDF.first), namedNode(RDF.nil)),
      quad(cell, namedNode(RDF.rest), namedNode(RDF.nil)),
    ])
    expect(nested).toEqual([{ '@id': 'urn:s', 'urn:p': [{ '@list': [{ '@list': [] }] }] }])
  })

  it('selects compaction terms without losing language, index, or reverse meaning', async () => {
    const context = {
      typed: { '@id': 'urn:p', '@type': 'urn:type' },
      plain: 'urn:p',
      back: { '@reverse': 'urn:back' },
    }
    expect(
      await compact({
        '@id': 'urn:s',
        'urn:p': [{ '@value': 'value', '@type': 'urn:other', '@index': 'source' }],
        '@reverse': { 'urn:back': [{ '@id': 'urn:o' }] },
      }, context),
    ).toEqual({
      '@context': context,
      '@id': 'urn:s',
      plain: { '@value': 'value', '@type': 'urn:other', '@index': 'source' },
      back: { '@id': 'urn:o' },
    })
  })

  it('resolves RDF IRIs without changing Unicode, host case, or encoded dot identity', async () => {
    expect(
      await expand({ '@id': '../%2E/é', 'urn:p': 'value' }, {
        base: 'https://EXAMPLE.test/path/document',
      }),
    ).toEqual([{ '@id': 'https://EXAMPLE.test/%2E/é', 'urn:p': [{ '@value': 'value' }] }])
  })
  it('retains explicit empty properties and removes the default graph wrapper', async () => {
    expect(await expand({ '@graph': [{ 'urn:p': [] }] })).toEqual([{ 'urn:p': [] }])
    expect(await flatten({ '@id': 'urn:s', 'urn:p': [] })).toEqual([{
      '@id': 'urn:s',
      'urn:p': [],
    }])
    expect(await expand([{ '@value': 'orphan', '@language': 'en' }, { '@language': 'en' }]))
      .toEqual([])
  })

  it('preserves nested anonymous node relationships and list item ownership in RDF', async () => {
    const values = await toRdf({
      '@id': 'urn:s',
      'urn:p': { 'urn:q': 'nested' },
      'urn:list': { '@list': [{ '@id': 'urn:item' }] },
    })
    const relation = values.find((value) =>
      value.subject.value === 'urn:s' && value.predicate.value === 'urn:p'
    )!
    expect(relation.object.termType).toBe('BlankNode')
    expect(
      values.some((value) =>
        value.subject.equals(relation.object) && value.predicate.value === 'urn:q' &&
        value.object.value === 'nested'
      ),
    ).toBe(true)
    expect(
      values.filter((value) =>
        value.subject.value === 'urn:s' && value.predicate.value === 'urn:list'
      ),
    ).toHaveLength(1)
    expect(
      values.some((value) =>
        value.predicate.value === RDF.first && value.object.value === 'urn:item'
      ),
    ).toBe(true)
  })

  it('preserves scalar node identifiers and native values during RDF conversion', async () => {
    expect(
      await fromRdf([
        quad(namedNode('urn:s'), namedNode('urn:p'), literal('42', namedNode(XSD.integer))),
      ], { useNativeTypes: true }),
    ).toEqual([{ '@id': 'urn:s', 'urn:p': [{ '@value': 42 }] }])
    await expect(
      fromRdf([
        quad(
          namedNode('urn:s'),
          namedNode('urn:p'),
          literal('{broken', namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON')),
        ),
      ]),
    ).rejects.toMatchObject({ code: 'invalid JSON literal' })
  })

  it('rejects invalid value objects while retaining JSON null literals', async () => {
    for (
      const value of [{ '@value': 'x', 'urn:p': 'extra' }, { '@value': true, '@language': 'en' }, {
        '@value': {},
      }, { '@value': 'x', '@type': 'urn:bad type' }]
    ) {
      await expect(expand({ 'urn:p': value })).rejects.toBeInstanceOf(JsonLdError)
    }
    expect(await expand({ 'urn:p': { '@value': null, '@type': '@json' } })).toEqual([{
      'urn:p': [{ '@value': null, '@type': '@json' }],
    }])
  })

  it('expands graph maps and @none aliases without adding false identifiers', async () => {
    const context = { graph: { '@id': 'urn:p', '@container': ['@graph', '@id'] }, none: '@none' }
    expect(await expand({ '@context': context, graph: { none: { 'urn:q': 'value' } } })).toEqual([{
      'urn:p': [{ '@graph': [{ 'urn:q': [{ '@value': 'value' }] }] }],
    }])
  })

  it('validates context containers, prefix mappings, and custom indexes', async () => {
    for (
      const definition of [
        { '@id': 'urn:p', '@container': ['@list', '@set'] },
        { '@id': 'urn:p', '@prefix': 'yes' },
        { '@id': 'urn:p', '@index': 'urn:index' },
        { '@id': 'urn:p', surprise: true },
      ]
    ) {
      await expect(expand({ '@context': { p: definition }, p: 'x' })).rejects.toBeInstanceOf(
        JsonLdError,
      )
    }
    await expect(expand({ '@context': { '@id': 'urn:id' } })).rejects.toMatchObject({
      code: 'keyword redefinition',
    })
    await expect(
      flatten([{ '@id': 'urn:s', '@index': 'one' }, { '@id': 'urn:s', '@index': 'two' }]),
    ).rejects.toMatchObject({ code: 'conflicting indexes' })
  })
  it('keeps remote loading disabled unless the caller explicitly enables or supplies it', async () => {
    await expect(createDocumentLoader()('https://example.test/context')).rejects.toMatchObject({
      kind: 'remote-disabled',
      code: 'loading document failed',
    })
  })

  it('applies the current byte policy to a shared cache without reloading or changing its contents', async () => {
    const url = 'https://example.test/cached-context'
    const document: RemoteDocumentType = {
      contextUrl: null,
      documentUrl: url,
      document: { '@context': { label: 'urn:雪😀' } },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(document.document)).byteLength
    const values = new Map<string, RemoteDocumentType>()
    let writes = 0, loads = 0, reloads = 0
    const cache = {
      get(key: string) {
        return values.get(key)
      },
      set(key: string, value: RemoteDocumentType) {
        writes++
        values.set(key, value)
      },
    }
    const warm = createDocumentLoader({
      cache,
      maxBytes: bytes + 1,
      loadDocument(): Promise<RemoteDocumentType> {
        loads++
        return Promise.resolve(document)
      },
    })
    expect(await warm(url)).toBe(document)
    expect(loads).toBe(1)
    expect(writes).toBe(1)
    const reload = (): Promise<RemoteDocumentType> => {
      reloads++
      return Promise.reject(new Error('A cache hit must not reload its document.'))
    }
    const strict = createDocumentLoader({ cache, maxBytes: bytes - 1, loadDocument: reload })
    await expect(strict(url)).rejects.toMatchObject({ kind: 'document-size', url })
    const exact = createDocumentLoader({ cache, maxBytes: bytes, loadDocument: reload })
    expect(await exact(url)).toBe(document)
    expect(reloads).toBe(0)
    expect(writes).toBe(1)
    expect([...values]).toEqual([[url, document]])
  })

  it('rechecks local cached documents after their caller-owned data changes', async () => {
    const url = 'https://example.test/mutable-context'
    const value = { '@context': { label: 'urn:label' } }
    const document: RemoteDocumentType = { contextUrl: null, documentUrl: url, document: value }
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    let loads = 0
    const load = createDocumentLoader({
      maxBytes: bytes,
      loadDocument(): Promise<RemoteDocumentType> {
        loads++
        return Promise.resolve(document)
      },
    })
    expect(await load(url)).toBe(document)
    value['@context'].label += '雪'
    await expect(load(url)).rejects.toMatchObject({ kind: 'document-size', url })
    expect(loads).toBe(1)
    expect(document.document).toBe(value)
    expect(value['@context'].label).toBe('urn:label雪')
  })

  it('deduplicates concurrent caller-owned remote document loads', async () => {
    let loads = 0
    const reading = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const load = createDocumentLoader({
      async loadDocument(url) {
        loads++
        reading.resolve()
        await release.promise
        return { contextUrl: null, documentUrl: url, document: { '@context': {} } }
      },
    })
    const pending = Promise.all([
      load('https://example.test/context'),
      load('https://example.test/context'),
    ])
    await reading.promise
    try {
      expect(loads).toBe(1)
    } finally {
      release.resolve()
    }
    const [left, right] = await pending
    expect(loads).toBe(1)
    expect(left).toBe(right)
  })

  it('shares size rejection across concurrent loads and does not cache the rejected document', async () => {
    const reading = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let loads = 0
    const load = createDocumentLoader({
      maxBytes: 32,
      async loadDocument(url) {
        loads++
        reading.resolve()
        await release.promise
        return { contextUrl: null, documentUrl: url, document: 'x'.repeat(33) }
      },
    })
    const pending = Promise.allSettled([
      load('https://example.test/context'),
      load('https://example.test/context'),
    ])
    await reading.promise
    release.resolve()
    const results = await pending
    expect(loads).toBe(1)
    expect(results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ kind: 'document-size' }) },
      { status: 'rejected', reason: expect.objectContaining({ kind: 'document-size' }) },
    ])
    await expect(load('https://example.test/context')).rejects.toMatchObject({
      kind: 'document-size',
    })
    expect(loads).toBe(2)
  })

  it(
    'cancels a remote body after headers and releases its reader',
    { timeout: 2_000 },
    async () => {
      const reading = Promise.withResolvers<void>()
      let cancelled = 0
      const body = new ReadableStream<Uint8Array>({
        pull() {
          reading.resolve()
          return new Promise<void>(() => {})
        },
        cancel() {
          cancelled++
        },
      }, { highWaterMark: 0 })
      const controller = new AbortController()
      const load = createDocumentLoader({
        remote: true,
        signal: controller.signal,
        fetch: () => Promise.resolve(new Response(body)),
      })
      const pending = load('https://example.test/context')
      await reading.promise
      controller.abort(new Error('stop JSON-LD body'))
      await expect(pending).rejects.toMatchObject({
        kind: 'abort',
        url: 'https://example.test/context',
      })
      expect(cancelled).toBe(1)
      expect(body.locked).toBe(false)
    },
  )

  it('retains a remote deadline until body consumption completes', { timeout: 2_000 }, async () => {
    const reading = Promise.withResolvers<void>()
    let cancelled = 0
    const body = new ReadableStream<Uint8Array>({
      pull() {
        reading.resolve()
        return new Promise<void>(() => {})
      },
      cancel() {
        cancelled++
      },
    }, { highWaterMark: 0 })
    const load = createDocumentLoader({
      remote: true,
      timeoutMs: 30,
      fetch: () => Promise.resolve(new Response(body)),
    })
    const pending = load('https://example.test/context')
    await reading.promise
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    expect(cancelled).toBe(1)
    expect(body.locked).toBe(false)
  })

  it('rejects an oversized remote chunk before requesting another producer chunk', async () => {
    let reads = 0, cancelled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++
        if (reads > 1) throw new Error('Loader requested bytes after the oversized chunk.')
        controller.enqueue(new Uint8Array(33))
      },
      cancel() {
        cancelled++
      },
    }, { highWaterMark: 0 })
    const load = createDocumentLoader({
      remote: true,
      maxBytes: 32,
      fetch: () => Promise.resolve(new Response(body)),
    })
    await expect(load('https://example.test/context')).rejects.toMatchObject({
      kind: 'document-size',
    })
    expect(reads).toBe(1)
    expect(cancelled).toBe(1)
    expect(body.locked).toBe(false)
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
    ).rejects.toBeInstanceOf(RangeError)
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
    expect(reverseNode['@reverse']).toEqual({
      'http://xmlns.com/foaf/0.1/knows': [{
        '@id': 'http://example.com/people/dave',
        'http://xmlns.com/foaf/0.1/name': [{ '@value': 'Dave' }],
      }],
    })
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
    expect(compacted).toEqual(input)
    const flat = await flatten(input)
    expect(flat).toEqual([{
      '@id': 'https://example.test/a',
      'https://schema.org/name': [{ '@value': 'A' }],
      'https://schema.org/knows': [{ '@id': 'https://example.test/b' }],
    }])
    const framed = await frame(input, {
      '@context': input['@context'],
      '@id': 'https://example.test/a',
      name: {},
    })
    expect(framed).toEqual(input)
  })

  it('converts RDF collections in both directions without an N-Quads intermediary', async () => {
    const input = {
      '@context': { items: { '@id': 'https://example.test/items', '@container': '@list' } },
      '@id': 'https://example.test/s',
      items: ['a', 'b'],
    }
    const values = await toRdf(input)
    expect(values).toHaveLength(5)
    expect(
      values.filter((value) => value.predicate.value === RDF.first).map((value) =>
        value.object.value
      ),
    )
      .toEqual(['a', 'b'])
    const output = await fromRdf(values)
    expect(output).toEqual([{
      '@id': 'https://example.test/s',
      'https://example.test/items': [{ '@list': [{ '@value': 'a' }, { '@value': 'b' }] }],
    }])
    expect(JSON.parse(await serialize(values))).toEqual(output)
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
    ).rejects.toMatchObject({ code: 'loading document failed' })
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

  it('resolves HTML base elements against the document fallback base', async () => {
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
      'http://a.example.com/base',
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
