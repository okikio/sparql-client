import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import { query } from '../../conformance/query.ts'
import {
  SPARQL_PATTERN_BRAND,
  SPARQL_QUERY_BRAND,
  SPARQL_TERM_BRAND,
  triple,
  tripleTerm,
  variable,
} from './mod.ts'

/** A complete independently parsed query makes term roles visible without fixing layout. */
function pattern(value: string): unknown {
  return query(
    `PREFIX schema: <https://schema.org/> PREFIX : <urn:default:> SELECT * WHERE { ${value} }`,
  )
}

describe('@okikio/sparql term and pattern roles', () => {
  it('preserves RDF named nodes in subject, predicate, and object positions', () => {
    const subject = namedNode('urn:product:1')
    const predicate = namedNode('urn:example:name')
    const object = namedNode('urn:value:1')
    const pattern = triple(subject, predicate, object)

    expect(query(`SELECT * WHERE { ${pattern.value} }`)).toEqual(
      query('SELECT * WHERE { <urn:product:1> <urn:example:name> <urn:value:1> }'),
    )
    expect(pattern[SPARQL_PATTERN_BRAND]).toBe(true)
  })

  it('keeps explicit object variables as variables rather than string literals', () => {
    expect(pattern(triple('?product', 'schema:name', '?name').value)).toEqual(
      pattern('?product schema:name ?name .'),
    )
  })

  it('uses the complete SPARQL 1.2 variable grammar in triple object positions', () => {
    expect(pattern(triple('?product', 'schema:value', '?1value').value)).toEqual(
      pattern('?product schema:value ?1value .'),
    )
    expect(pattern(triple('?product', 'schema:value', '$élève').value)).toEqual(
      pattern('?product schema:value ?élève .'),
    )
    expect(() => triple('?product', 'schema:value', '?not-valid-name')).toThrow(Error)
  })

  it('accepts the SPARQL VARNAME grammar in variable constructors', () => {
    expect(variable('1value').value).toBe('?1value')
    expect(variable('élève').value).toBe('?élève')
    expect(variable('a\u0301').value).toBe('?a\u0301')
    expect(() => variable('not-valid!')).toThrow(Error)
    expect(() => variable('not-valid-name')).toThrow(Error)
  })

  it('requires explicit subject variables instead of coercing bare strings by position', () => {
    expect(pattern(triple('product', 'schema:name', 'product').value)).toEqual(
      pattern(':product schema:name "product" .'),
    )
    expect(pattern(triple('?product', 'schema:name', '?name').value)).toEqual(
      pattern('?product schema:name ?name .'),
    )
  })

  it('treats prefixed subject strings as graph terms and predicate variables as variables', () => {
    expect(pattern(triple('schema:Product', 'schema:name', '?name').value)).toEqual(
      pattern('schema:Product schema:name ?name .'),
    )
    expect(pattern(triple('?subject', '?predicate', '?object').value)).toEqual(
      pattern('?subject ?predicate ?object .'),
    )
  })

  it('creates RDF 1.2 triple-term syntax as a term rather than a graph pattern', () => {
    const value = tripleTerm(
      namedNode('urn:s'),
      namedNode('urn:p'),
      namedNode('urn:o'),
    )
    expect(pattern(`?owner <urn:asserts> ${value.value}`)).toEqual(
      pattern('?owner <urn:asserts> <<( <urn:s> <urn:p> <urn:o> )>>'),
    )
    expect(value[SPARQL_TERM_BRAND]).toBe(true)
    expect(SPARQL_QUERY_BRAND in value).toBe(false)
  })
})
