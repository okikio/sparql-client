import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '@okikio/rdf'
import { decodeBindings, decodeBoolean, decodeTerm } from './json.ts'

describe('@okikio/sparql JSON results', () => {
  it('reuses blank labels within one response and isolates independent responses', () => {
    const input = {
      head: { vars: ['x', 'y', 'triple'] },
      results: {
        bindings: [{
          x: { type: 'bnode', value: 'root' },
          y: { type: 'bnode', value: 'root' },
          triple: {
            type: 'triple',
            value: {
              subject: { type: 'bnode', value: 'root' },
              predicate: { type: 'uri', value: 'urn:test:p' },
              object: { type: 'bnode', value: 'root' },
            },
          },
        }],
      },
    }
    const first = decodeBindings(input)[0]!, second = decodeBindings(input)[0]!
    expect(first.get('x')?.equals(first.get('y'))).toBe(true)
    expect(first.get('x')?.equals(second.get('x'))).toBe(false)
    const triple = first.get('triple')
    expect(triple?.termType).toBe('Quad')
    if (triple?.termType === 'Quad') expect(triple.subject.equals(first.get('x'))).toBe(true)
  })

  it('rejects malformed result terms and undeclared or duplicate variables', () => {
    for (
      const value of [
        null,
        [],
        {},
        { type: 'mystery', value: 'x' },
        { type: 'literal', value: 1 },
        { type: 'literal', value: 'x', datatype: 1 },
        { type: 'literal', value: 'x', 'its:dir': 'bad' },
        { type: 'literal', value: 'x', 'its:dir': 'ltr' },
      ]
    ) {
      expect(() => decodeTerm(value)).toThrow(TypeError)
    }
    expect(() => decodeBindings({ head: { vars: ['x', 'x'] }, results: { bindings: [] } }))
      .toThrow()
    expect(() =>
      decodeBindings({
        head: { vars: ['x'] },
        results: { bindings: [{ y: { type: 'uri', value: 'urn:y' } }] },
      })
    ).toThrow()
  })

  it('bounds recursive triple decoding before the JavaScript stack is exhausted', () => {
    let term: unknown = { type: 'uri', value: 'urn:o' }
    for (let depth = 0; depth < 150; depth++) {
      term = {
        type: 'triple',
        value: {
          subject: { type: 'uri', value: 'urn:s' },
          predicate: { type: 'uri', value: 'urn:p' },
          object: term,
        },
      }
    }
    expect(() => decodeTerm(term)).toThrow(TypeError)
  })

  it('preserves RDF literal datatype, language, and RDF 1.2 direction', () => {
    const value = decodeTerm({
      type: 'literal',
      value: 'bonjour',
      'xml:lang': 'fr',
      'its:dir': 'ltr',
    })
    expect(value.termType).toBe('Literal')
    if (value.termType === 'Literal') {
      expect(value.direction).toBe('ltr')
      expect(value.value).toBe('bonjour')
      expect(value.language).toBe('fr')
      expect(value.datatype.value).toBe(RDF.dirLangString)
    }
  })

  it('decodes SPARQL 1.2 triple terms recursively', () => {
    const value = decodeTerm({
      type: 'triple',
      value: {
        subject: { type: 'uri', value: 'urn:s' },
        predicate: { type: 'uri', value: 'urn:p' },
        object: { type: 'literal', value: 'o' },
      },
    })
    expect(value.termType).toBe('Quad')
    expect(value).toMatchObject({
      subject: { termType: 'NamedNode', value: 'urn:s' },
      predicate: { termType: 'NamedNode', value: 'urn:p' },
      object: { termType: 'Literal', value: 'o' },
      graph: { termType: 'DefaultGraph' },
    })
  })

  it('rejects illegal triple predicates instead of coercing them', () => {
    expect(() =>
      decodeTerm({
        type: 'triple',
        value: {
          subject: { type: 'uri', value: 'urn:s' },
          predicate: { type: 'literal', value: 'not-an-iri' },
          object: { type: 'literal', value: 'o' },
        },
      })
    ).toThrow(TypeError)
  })

  it('decodes SELECT and ASK result modes without JavaScript datatype coercion', () => {
    const rows = decodeBindings({
      head: { vars: ['price'] },
      results: {
        bindings: [{
          price: {
            type: 'literal',
            value: '12.50',
            datatype: 'http://www.w3.org/2001/XMLSchema#decimal',
          },
        }],
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('price')).toMatchObject({
      termType: 'Literal',
      value: '12.50',
      datatype: { value: 'http://www.w3.org/2001/XMLSchema#decimal' },
    })
    expect(decodeBoolean({ boolean: true })).toBe(true)
    expect(() => decodeBoolean({ boolean: 'true' })).toThrow()
  })
})
