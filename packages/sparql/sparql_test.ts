import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import {
  SPARQL_PATTERN_BRAND,
  SPARQL_QUERY_BRAND,
  SPARQL_TERM_BRAND,
  triple,
  tripleTerm,
  variable,
} from './mod.ts'

describe('@okikio/sparql term and pattern roles', () => {
  it('preserves RDF named nodes in subject, predicate, and object positions', () => {
    const subject = namedNode('urn:product:1')
    const predicate = namedNode('urn:example:name')
    const object = namedNode('urn:value:1')
    const pattern = triple(subject, predicate, object)

    expect(pattern.value).toBe('<urn:product:1> <urn:example:name> <urn:value:1> .')
    expect(pattern[SPARQL_PATTERN_BRAND]).toBe(true)
  })

  it('keeps explicit object variables as variables rather than string literals', () => {
    expect(triple('?product', 'schema:name', '?name').value).toBe('?product schema:name ?name .')
  })

  it('uses the complete SPARQL 1.2 variable grammar in triple object positions', () => {
    expect(triple('?product', 'schema:value', '?1value').value).toBe(
      '?product schema:value ?1value .',
    )
    expect(triple('?product', 'schema:value', '$élève').value).toBe(
      '?product schema:value ?élève .',
    )
    expect(() => triple('?product', 'schema:value', '?not-valid-name')).toThrow('VARNAME')
  })

  it('accepts the SPARQL VARNAME grammar in variable constructors', () => {
    expect(variable('1value').value).toBe('?1value')
    expect(variable('élève').value).toBe('?élève')
    expect(variable('a\u0301').value).toBe('?a\u0301')
    expect(() => variable('not-valid!')).toThrow('VARNAME')
    expect(() => variable('not-valid-name')).toThrow('VARNAME')
  })

  it('requires explicit subject variables instead of coercing bare strings by position', () => {
    expect(triple('product', 'schema:name', 'product').value).toBe(
      ':product schema:name "product" .',
    )
    expect(triple('?product', 'schema:name', '?name').value).toBe(
      '?product schema:name ?name .',
    )
  })

  it('treats prefixed subject strings as graph terms and predicate variables as variables', () => {
    expect(triple('schema:Product', 'schema:name', '?name').value).toBe(
      'schema:Product schema:name ?name .',
    )
    expect(triple('?subject', '?predicate', '?object').value).toBe('?subject ?predicate ?object .')
  })

  it('creates RDF 1.2 triple-term syntax as a term rather than a graph pattern', () => {
    const value = tripleTerm(
      namedNode('urn:s'),
      namedNode('urn:p'),
      namedNode('urn:o'),
    )
    expect(value.value).toBe('<<( <urn:s> <urn:p> <urn:o> )>>')
    expect(value[SPARQL_TERM_BRAND]).toBe(true)
    expect(SPARQL_QUERY_BRAND in value).toBe(false)
  })
})
