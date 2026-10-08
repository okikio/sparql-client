import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as rdf from './mod.ts'
import * as jsonld from './jsonld/mod.ts'
import { inspect } from './ontology/mod.ts'
import { createDocumentLoader } from './jsonld/loader.ts'
import { parse as parseRdfa } from './rdfa/mod.ts'
import { parse as parseMicrodata } from './microdata/mod.ts'
import { consume } from './stream.ts'

const s = rdf.namedNode('urn:s'), p = rdf.namedNode('urn:p')
describe('semantic boundary regression cases', () => {
  it('preserves empty language/null graph RDFJS defaults and rejects contradictory literal tuples', () => {
    expect(rdf.literal('x', '').equals(rdf.literal('x'))).toBe(true)
    expect(rdf.literal('x', { language: '', direction: null }).equals(rdf.literal('x'))).toBe(true)
    expect(() => rdf.literal('x', { language: '', direction: 'ltr' })).toThrow(TypeError)
    expect(rdf.quad(s, p, rdf.literal('x'), null).graph).toBe(rdf.defaultGraph())
    const datatype = rdf.namedNode(rdf.XSD.integer)
    expect(rdf.fromTerm(rdf.literal('ill-typed', datatype))).toEqual(
      rdf.literal('ill-typed', datatype),
    )
    expect(() => rdf.literal('x', rdf.namedNode(rdf.RDF.langString))).toThrow(TypeError)
    const bad = { ...rdf.literal('x', 'en'), datatype }
    expect(() => rdf.fromTerm(bad)).toThrow(TypeError)
  })
  it('bounds external quad copying and rejects cycles and non-RDF positions', () => {
    const cycle = { ...rdf.quad(s, p, rdf.literal('x')) }
    Object.defineProperty(cycle, 'object', { value: cycle })
    expect(() => Reflect.apply(rdf.fromTerm, undefined, [cycle])).toThrow(RangeError)
    let nested: rdf.ObjectTermType = rdf.literal('x')
    for (let index = 0; index < 514; index++) nested = rdf.quad(s, p, nested)
    expect(() => rdf.fromTerm(nested)).toThrow(RangeError)
    expect(() => Reflect.apply(rdf.quad, undefined, [rdf.literal('x'), p, s])).toThrow(
      TypeError,
    )
    expect(() => Reflect.apply(rdf.quad, undefined, [s, rdf.variable('p'), s])).toThrow(
      TypeError,
    )
  })
  it('rejects native directional RDF at JSON-LD1.1 boundary for every legacy mapping', async () => {
    for (const rdfDirection of [undefined, 'i18n-datatype', 'compound-literal'] as const) {
      await expect(
        jsonld.fromRdf([rdf.quad(s, p, rdf.literal('x', { language: 'en', direction: 'rtl' }))], {
          rdfDirection,
        }),
      ).rejects.toBeInstanceOf(TypeError)
    }
  })
  it('retains datatype instance assertions and attaches metadata to every ontology role', async () => {
    const type = rdf.namedNode(rdf.RDF.type),
      label = rdf.namedNode('http://www.w3.org/2000/01/rdf-schema#label')
    const model = await inspect([{
      id: 'document',
      quads: [
        rdf.quad(s, type, rdf.namedNode(rdf.XSD.integer)),
        rdf.quad(p, type, rdf.namedNode('http://www.w3.org/2000/01/rdf-schema#Class')),
        rdf.quad(p, type, rdf.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')),
        rdf.quad(p, label, rdf.literal('Both', 'en')),
      ],
    }])
    expect(model.datatypes).toEqual([])
    expect(model.assertions).toHaveLength(1)
    expect(model.evidence).toHaveLength(4)
    expect(model.evidence.every((value) => value.sourceId === 'document')).toBe(true)
    expect(model.classes[0]?.labels).toEqual([{ value: 'Both', language: 'en' }])
    expect(model.properties[0]?.labels).toEqual(model.classes[0]?.labels)
  })
  it('counts shared-cache admissions and isolates snapshots without acquiring loaders', async () => {
    const value = { '@context': { name: 'urn:name' } }
    const load = createDocumentLoader({
      maxDocuments: 1,
      cache: {
        get: (url) => ({ contextUrl: null, documentUrl: url, document: value }),
        set() {
          throw new Error('Cache hit must not mutate borrowed cache')
        },
      },
    })
    const admitted = await load('urn:a')
    value['@context'].name = 'urn:changed'
    expect(await load('urn:a')).toBe(admitted)
    expect((admitted.document as { '@context': { name: string } })['@context'].name).toBe(
      'urn:name',
    )
    await expect(load('urn:b')).rejects.toMatchObject({ kind: 'document-limit' })
  })
  it('shares document admission across input and context loading in one public operation', async () => {
    let loads = 0
    await expect(
      jsonld.expand('https://example.test/input', {
        maxDocuments: 1,
        loadDocument: (url): Promise<jsonld.RemoteDocumentType> => {
          loads++
          const document: jsonld.JsonLdValueType = url.endsWith('input')
            ? { '@context': 'https://example.test/context', name: 'value' }
            : { '@context': { name: 'urn:name' } }
          return Promise.resolve({
            documentUrl: url,
            contextUrl: null,
            document,
          })
        },
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(loads).toBe(1)
  })
  it('rejects cyclic, accessor and oversized custom JSON data without invoking getters', async () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    let getterCalls = 0
    const getter = Object.defineProperty({}, 'x', {
      enumerable: true,
      get() {
        getterCalls++
        throw new Error('Must not invoke')
      },
    })
    for (const document of [cycle, getter, 'x'.repeat(64)]) {
      const load = createDocumentLoader({
        maxBytes: 32,
        loadDocument: (url) =>
          Promise.resolve({
            documentUrl: url,
            contextUrl: null,
            document: document as jsonld.JsonLdValueType,
          }),
      })
      await expect(load('urn:x')).rejects.toMatchObject({
        kind: typeof document === 'string' ? 'document-size' : 'json',
      })
      expect(getterCalls).toBe(0)
    }
  })
  it('extracts ordinary RDFa and Microdata text using HTML character references', async () => {
    const rdfa: rdf.Quad[] = []
    for await (
      const value of parseRdfa(
        '<div about="urn:person"><span property="http://schema.org/name">caf&eacute;</span></div>',
      )
    ) rdfa.push(value)
    expect(rdfa[0]?.object.value).toBe('café')
    const microdata: rdf.Quad[] = []
    for await (
      const value of parseMicrodata(
        '<div itemscope itemtype="https://schema.org/Person" itemid="urn:person"><span itemprop="name">caf&eacute;</span></div>',
      )
    ) microdata.push(value)
    expect(
      microdata.find((value) => value.predicate.value === 'https://schema.org/name')?.object.value,
    ).toBe('café')
  })
  it('settles abort despite a never-ending return and exposes independent cleanup', {
    timeout: 2000,
  }, async () => {
    const controller = new AbortController(), started = Promise.withResolvers<void>()
    let returned = 0, cleanup: Promise<void> | undefined
    const input: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next() {
          started.resolve()
          return new Promise(() => {})
        },
        return() {
          returned++
          return new Promise(() => {})
        },
      }),
    }
    const result = consume(input, controller.signal, (value) => {
      cleanup = value
    }).next()
    await started.promise
    controller.abort(null)
    await expect(result).rejects.toBe(null)
    expect(returned).toBe(1)
    expect(cleanup).toBeInstanceOf(Promise)
  })
})
