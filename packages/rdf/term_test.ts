import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import {
  blankNode,
  dataset,
  defaultGraph,
  equals,
  fromQuad,
  fromTerm,
  key,
  literal,
  namedNode,
  quad,
  RDF,
  type Term,
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

  it('scopes generated blank-node labels beyond a restart-local counter', () => {
    const first = blankNode()
    const second = blankNode()

    // Labels are opaque: unrelated consumers may already have minted blank nodes.
    expect(first.termType).toBe('BlankNode')
    expect(second.termType).toBe('BlankNode')
    expect(first.value.length).toBeGreaterThan(0)
    expect(second.value.length).toBeGreaterThan(0)
    expect(first.value).not.toBe(second.value)
    expect(blankNode('stable').value).toBe('stable')
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

  it('preserves RDF/JS literal identity when legacy terms omit direction', () => {
    // Independent RDF/JS values intentionally do not use the native Literal
    // constructor. Older implementations expose either absent or null direction.
    const native = literal('bonjour', 'fr')
    for (const direction of [undefined, null, ''] as const) {
      const legacy: Term & {
        language: string
        datatype: ReturnType<typeof namedNode>
        direction?: string | null
      } = {
        termType: 'Literal',
        value: 'bonjour',
        language: 'fr',
        datatype: namedNode(RDF.langString),
        ...(direction === undefined ? {} : { direction }),
        equals: (other) => other?.termType === 'Literal' && other.value === 'bonjour',
      }
      expect(native.equals(legacy)).toBe(true)
      expect(fromTerm(legacy).equals(legacy)).toBe(true)
      expect(key(legacy)).toBe(key(native))
      expect(native.equals({ ...legacy, value: 'salut' })).toBe(false)
      const otherLanguage = { ...legacy, language: 'en' }
      const otherDatatype = { ...legacy, datatype: namedNode(XSD.string) }
      expect(native.equals(otherLanguage)).toBe(false)
      expect(native.equals(otherDatatype)).toBe(false)

      const stored = quad(namedNode('urn:s'), namedNode('urn:p'), native)
      // key accepts interoperable Term objects recursively; Dataset.has uses it
      // rather than requiring a specific constructor for the supplied statement.
      const external = { ...stored, object: legacy }
      expect(key(external)).toBe(key(stored))
      expect(dataset([stored]).has(external as typeof stored)).toBe(true)
    }
  })

  it('keeps directional language identity distinct from absent direction', () => {
    const left = literal('bonjour', { language: 'fr', direction: 'ltr' })
    const right = literal('bonjour', { language: 'fr', direction: 'rtl' })
    expect(left.equals(right)).toBe(false)
    expect(key(left)).not.toBe(key(right))
    const legacy = { ...left, direction: undefined }
    expect(left.equals(legacy)).toBe(false)
    expect(key(left)).not.toBe(key(legacy))
  })

  it('represents triple terms as default-graph quads and rejects named-graph embedded quads', () => {
    const s = namedNode('urn:s')
    const p = namedNode('urn:p')
    const embedded = triple(s, p, literal('value'))
    expect(embedded.graph.termType).toBe('DefaultGraph')
    expect(quad(s, p, embedded).object.equals(embedded)).toBe(true)

    const named = quad(s, p, literal('value'), namedNode('urn:g'))
    expect(() => quad(s, p, named)).toThrow(TypeError)
  })

  it('creates collision-safe semantic keys for nested terms', () => {
    const first = literal('a:1', namedNode('urn:type'))
    const second = literal('a', namedNode('1:urn:type'))
    expect(key(first) === key(second)).toBe(false)

    const embedded = triple(blankNode('s'), namedNode('urn:p'), first)
    expect(key(embedded)).not.toBe(key(triple(blankNode('s'), namedNode('urn:p'), second)))
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
