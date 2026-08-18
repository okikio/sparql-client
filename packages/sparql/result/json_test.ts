import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '@okikio/rdf'
import { decodeBindings, decodeBoolean, decodeTerm } from './json.ts'

describe('@okikio/sparql JSON results', () => {
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
    ).toThrow('predicate')
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
    expect(rows[0]?.get('price')?.termType).toBe('Literal')
    expect(decodeBoolean({ boolean: true })).toBe(true)
    expect(() => decodeBoolean({ boolean: 'true' })).toThrow()
  })
})
