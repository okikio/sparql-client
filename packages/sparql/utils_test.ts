import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as rdf from '@okikio/rdf'
import { name, offers, price } from '@okikio/vocab/schema'
import {
  SPARQL_EXPR_BRAND,
  SPARQL_PATTERN_BRAND,
  SPARQL_TERM_BRAND,
  exists,
  filter,
  definePrefix,
  inverse,
  optional,
  prefixed,
  sequence,
  triple,
  typed,
  uri,
  undef,
  v,
  values,
  zeroOrMore,
} from './mod.ts'

describe('@okikio/sparql grammar-role helpers', () => {
  it('returns graph-pattern values for graph-pattern clauses', () => {
    const pattern = triple('?s', '?p', '?o')
    expect(filter(v('s').eq(v('o')))[SPARQL_PATTERN_BRAND]).toBe(true)
    expect(optional(pattern)[SPARQL_PATTERN_BRAND]).toBe(true)
    expect(values('s', [undef()])[SPARQL_PATTERN_BRAND]).toBe(true)
  })

  it('returns expressions for EXISTS', () => {
    expect(exists(triple('?s', '?p', '?o'))[SPARQL_EXPR_BRAND]).toBe(true)
  })

  it('uses the SPARQL UNDEF token inside VALUES data blocks', () => {
    expect(undef().value).toBe('UNDEF')
  })

  it('returns term syntax for property paths', () => {
    for (const path of [zeroOrMore('schema:parent'), inverse('schema:child'), sequence('schema:a', 'schema:b')]) {
      expect(path[SPARQL_TERM_BRAND]).toBe(true)
    }
  })
  it('uses RDF named nodes directly in property paths', () => {
    expect(zeroOrMore(name).value).toBe('<https://schema.org/name>*')
    expect(sequence(offers, price).value).toBe('<https://schema.org/offers>/<https://schema.org/price>')
    expect(inverse(name).value).toBe('^<https://schema.org/name>')
  })

  it('uses RDF named nodes in datatype, IRI, and prefix constructors', () => {
    const stringDatatype = rdf.namedNode(rdf.XSD.string)
    const schema = rdf.namedNode('https://schema.org/')

    expect(typed('Widget', stringDatatype).value).toBe('"Widget"^^<http://www.w3.org/2001/XMLSchema#string>')
    expect(uri(name).value).toBe('<https://schema.org/name>')
    expect(definePrefix('schema', schema).value).toBe('PREFIX schema: <https://schema.org/>')
    expect(prefixed('schema', 'name')[SPARQL_TERM_BRAND]).toBe(true)
  })

})
