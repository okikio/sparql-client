import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import {
  blankNode,
  defaultGraph,
  equals,
  fromQuad,
  key,
  literal,
  namedNode,
  quad,
  RDF,
  triple,
  variable,
  XSD,
} from './mod.ts'

describe('@okikio/rdf terms and factories', () => {
  it('normalizes variables and language tags without changing RDF identity rules', () => {
    expect(variable('$name').value).toBe('name')
    expect(() => variable('?')).toThrow()

    const left = literal('bonjour', 'FR')
    const right = literal('bonjour', 'fr')
    expect(left.language).toBe('fr')
    expect(left.datatype.value).toBe(RDF.langString)
    expect(equals(left, right)).toBe(true)
  })

  it('creates RDF 1.2 directional language strings', () => {
    const value = literal('مرحبا', { language: 'AR', direction: 'rtl' })
    expect(value.language).toBe('ar')
    expect(value.direction).toBe('rtl')
    expect(value.datatype.value).toBe(RDF.dirLangString)
  })

  it('uses xsd:string only for plain strings', () => {
    const value = literal('Widget')
    expect(value.datatype.value).toBe(XSD.string)
    expect(value.language).toBe('')
  })

  it('represents triple terms as default-graph quads and rejects named-graph embedded quads', () => {
    const s = namedNode('urn:s')
    const p = namedNode('urn:p')
    const embedded = triple(s, p, literal('value'))
    expect(embedded.graph.termType).toBe('DefaultGraph')
    expect(quad(s, p, embedded).object.equals(embedded)).toBe(true)

    const named = quad(s, p, literal('value'), namedNode('urn:g'))
    expect(() => quad(s, p, named)).toThrow('triple term')
  })

  it('creates collision-safe semantic keys for nested terms', () => {
    const first = literal('a:1', namedNode('urn:type'))
    const second = literal('a', namedNode('1:urn:type'))
    expect(key(first) === key(second)).toBe(false)

    const embedded = triple(blankNode('s'), namedNode('urn:p'), first)
    expect(key(embedded).startsWith('Q')).toBe(true)
  })

  it('copies RDF/JS-compatible quads recursively and keeps the default graph singleton', () => {
    const source = quad(
      namedNode('urn:s'),
      namedNode('urn:p'),
      triple(namedNode('urn:a'), namedNode('urn:b'), literal('c')),
    )
    const copy = fromQuad(source)
    expect(copy === source).toBe(false)
    expect(copy.equals(source)).toBe(true)
    expect(defaultGraph() === defaultGraph()).toBe(true)
  })
})
