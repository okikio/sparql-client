import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad, triple } from './mod.ts'
import { writeQuad, writeTerm } from './write.ts'

describe('@okikio/rdf line serializer primitives', () => {
  it('escapes literals and IRIs deterministically', () => {
    expect(writeTerm(literal('a\n"b"'))).toBe('"a\\n\\"b\\""')
    expect(writeTerm(namedNode('urn:a b'))).toBe('<urn:a\\u0020b>')
  })

  it('serializes directional literals and RDF 1.2 triple terms', () => {
    expect(writeTerm(literal('bonjour', { language: 'fr', direction: 'ltr' }))).toBe('"bonjour"@fr--ltr')
    expect(writeTerm(triple(namedNode('urn:s'), namedNode('urn:p'), literal('o')))).toBe('<<( <urn:s> <urn:p> "o" )>>')
  })

  it('includes named graphs only for N-Quads output', () => {
    const value = quad(namedNode('urn:s'), namedNode('urn:p'), literal('o'), namedNode('urn:g'))
    expect(writeQuad(value, false)).toBe('<urn:s> <urn:p> "o" .')
    expect(writeQuad(value, true)).toBe('<urn:s> <urn:p> "o" <urn:g> .')
  })
})
