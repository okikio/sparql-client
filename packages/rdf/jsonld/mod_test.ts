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
  serialize,
  toRdf,
} from './mod.ts'

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
