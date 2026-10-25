import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, namespace } from '@okikio/rdf'
import { query } from '../../conformance/query.ts'
import { tokens } from './syntax/mod.ts'
import {
  construct,
  describe as describeQuery,
  select,
  SPARQL_PATTERN_BRAND,
  SPARQL_QUERY_BRAND,
  strlit,
  subquery,
  triple,
  v,
} from './mod.ts'

const PREFIX = 'PREFIX schema: <https://schema.org/>'

describe('@okikio/sparql query builder', () => {
  it('is immutable when clauses are added', () => {
    const base = select(['name']).where(triple('?thing', 'https://schema.org/name', '?name'))
    const before = query(base.build().value)
    const extended = base.where(triple('?thing', 'https://schema.org/sku', '?sku'))
    expect(query(base.build().value)).toEqual(before)
    expect(query(base.build().value)).toEqual(
      query('SELECT ?name WHERE { ?thing <https://schema.org/name> ?name }'),
    )
    expect(query(extended.build().value)).toEqual(
      query(`SELECT ?name WHERE {
        ?thing <https://schema.org/name> ?name .
        ?thing <https://schema.org/sku> ?sku .
      }`),
    )
  })

  it('keeps CONSTRUCT templates separate from WHERE patterns', () => {
    const template = triple('?copy', 'schema:name', '?name')
    const where = triple('?source', 'schema:name', '?name')
    const queryDocument = construct(template).where(where).build()

    expect(query(`${PREFIX} ${queryDocument.value}`)).toEqual(
      query(`${PREFIX} CONSTRUCT { ?copy schema:name ?name } WHERE { ?source schema:name ?name }`),
    )
  })

  it('supports the CONSTRUCT WHERE shorthand without duplicating the pattern', async () => {
    const built = construct().where(triple('?s', '?p', '?o')).build()
    expect(query(built.value)).toEqual(query('CONSTRUCT WHERE { ?s ?p ?o }'))
    // The public construct() contract promises this grammar form, independently of layout.
    const syntax: string[] = []
    for await (const token of tokens(built.value)) {
      if (token.kind !== 'whitespace' && token.kind !== 'comment') {
        syntax.push(token.kind === 'keyword' ? token.value.toUpperCase() : token.value)
      }
    }
    expect(syntax.slice(0, 3)).toEqual(['CONSTRUCT', 'WHERE', '{'])
  })

  it('serializes UNION as disjunctions rather than one conjunction', () => {
    const built = select('*').union(
      triple('?s', 'schema:name', '?name'),
      triple('?s', 'schema:sku', '?sku'),
    ).build()
    expect(query(`${PREFIX} ${built.value}`)).toEqual(
      query(`${PREFIX} SELECT * WHERE { { ?s schema:name ?name } UNION { ?s schema:sku ?sku } }`),
    )
  })

  it('accepts RDF namespace functions and named nodes directly', () => {
    const schema = namespace('https://schema.org/')
    const graph = namedNode('urn:graph:products')
    const built = select('*')
      .prefix('schema', schema)
      .from(graph)
      .where(triple('?product', schema('name'), '?name'))
      .build()

    expect(query(built.value)).toEqual(
      query(`${PREFIX} SELECT * FROM <urn:graph:products> WHERE {
        ?product <https://schema.org/name> ?name
      }`),
    )
  })

  it('accepts harmless formatting and BGP order while rejecting changed or duplicate triples', () => {
    const expected = query(`SELECT ?name WHERE {
      ?thing <https://schema.org/name> ?name .
      ?thing <https://schema.org/sku> ?sku .
    }`)
    expect(query(`select   ?name
      where { # Formatting, keyword case and conjunction order preserve semantics.
        ?thing <https://schema.org/sku> ?sku .
        ?thing <https://schema.org/name> ?name .
      }`)).toEqual(expected)
    expect(query(`SELECT ?name WHERE {
      ?thing <https://schema.org/title> ?name .
      ?thing <https://schema.org/sku> ?sku .
    }`)).not.toEqual(expected)
    expect(query(`SELECT ?name WHERE {
      ?thing <https://schema.org/name> ?name .
      ?thing <https://schema.org/name> ?name .
    }`)).not.toEqual(expected)
  })

  it('rejects non-IRI terms from dataset graph clauses', () => {
    expect(() => select('*').from(strlit('not a graph'))).toThrow()
  })

  it('accepts RDF named nodes in DESCRIBE and keeps full queries distinct from patterns', () => {
    const built = describeQuery([namedNode('urn:product:1')]).build()
    expect(query(built.value)).toEqual(query('DESCRIBE <urn:product:1>'))
    expect(built[SPARQL_QUERY_BRAND]).toBe(true)

    const pattern = subquery(select('*').where(triple('?s', '?p', '?o')))
    expect(pattern[SPARQL_PATTERN_BRAND]).toBe(true)
  })

  it('rejects duplicate SELECT result variables before serialization', () => {
    expect(() => select(['name', '?name']).build()).toThrow(TypeError)
    expect(() => select(['?1value', '$1value']).build()).toThrow(TypeError)
    expect(() => select(['name', '?other']).build()).not.toThrow()
    expect(() => select(['?1value', '$2value']).build()).not.toThrow()
  })

  it('keeps FILTER expressions separate from graph patterns', () => {
    const built = select(['name'])
      .where(triple('?product', 'schema:name', '?name'))
      .filter(v('name').neq(''))
      .build()
    expect(query(`${PREFIX} ${built.value}`)).toEqual(
      query(`${PREFIX} SELECT ?name WHERE { ?product schema:name ?name . FILTER(?name != "") }`),
    )
  })
})
