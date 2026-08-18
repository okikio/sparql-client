import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, namespace } from '@okikio/rdf'
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

describe('@okikio/sparql query builder', () => {
  it('is immutable when clauses are added', () => {
    const base = select(['name'])
    const filtered = base.where(triple('?thing', 'schema:name', '?name'))
    expect(base.build().value).toBe('SELECT ?name')
    expect(filtered.build().value.includes('?thing schema:name ?name .')).toBe(true)
  })

  it('keeps CONSTRUCT templates separate from WHERE patterns', () => {
    const template = triple('?copy', 'schema:name', '?name')
    const where = triple('?source', 'schema:name', '?name')
    const query = construct(template).where(where).build()

    expect(query.value.includes('CONSTRUCT {\n  ?copy schema:name ?name .\n}')).toBe(true)
    expect(query.value.includes('WHERE {\n  ?source schema:name ?name .\n}')).toBe(true)
  })

  it('supports the CONSTRUCT WHERE shorthand without duplicating the pattern', () => {
    const query = construct().where(triple('?s', '?p', '?o')).build()
    expect(query.value).toBe('CONSTRUCT\nWHERE {\n  ?s ?p ?o .\n}')
  })

  it('serializes UNION as disjunctions rather than one conjunction', () => {
    const query = select('*').union(
      triple('?s', 'schema:name', '?name'),
      triple('?s', 'schema:sku', '?sku'),
    ).build()
    expect(
      query.value.includes(
        '{\n    ?s schema:name ?name .\n  }\n  UNION\n  {\n    ?s schema:sku ?sku .\n  }',
      ),
    ).toBe(true)
  })

  it('accepts RDF namespace functions and named nodes directly', () => {
    const schema = namespace('https://schema.org/')
    const graph = namedNode('urn:graph:products')
    const query = select('*')
      .prefix('schema', schema)
      .from(graph)
      .where(triple('?product', schema('name'), '?name'))
      .build()

    expect(query.value.includes('PREFIX schema: <https://schema.org/>')).toBe(true)
    expect(query.value.includes('FROM <urn:graph:products>')).toBe(true)
    expect(query.value.includes('?product <https://schema.org/name> ?name .')).toBe(true)
  })

  it('rejects non-IRI terms from dataset graph clauses', () => {
    expect(() => select('*').from(strlit('not a graph'))).toThrow()
  })

  it('accepts RDF named nodes in DESCRIBE and keeps full queries distinct from patterns', () => {
    const query = describeQuery([namedNode('urn:product:1')]).build()
    expect(query.value).toBe('DESCRIBE <urn:product:1>')
    expect(query[SPARQL_QUERY_BRAND]).toBe(true)

    const pattern = subquery(select('*').where(triple('?s', '?p', '?o')))
    expect(pattern[SPARQL_PATTERN_BRAND]).toBe(true)
  })

  it('keeps FILTER expressions separate from graph patterns', () => {
    const query = select(['name'])
      .where(triple('?product', 'schema:name', '?name'))
      .filter(v('name').neq(''))
      .build()
    expect(query.value.includes('FILTER(?name != "")')).toBe(true)
  })
})
