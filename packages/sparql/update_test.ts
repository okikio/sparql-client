import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import { SPARQL_UPDATE_BRAND, strlit, triple, update, variable } from './mod.ts'
import { query } from '../../conformance/query.ts'

describe('@okikio/sparql update builder', () => {
  const statement = triple(namedNode('urn:s'), namedNode('urn:p'), strlit('value'))

  it('builds a distinct complete update document', () => {
    const document = update().insertData(statement).build()
    expect(document[SPARQL_UPDATE_BRAND]).toBe(true)
    expect(query(document.value)).toEqual(query('INSERT DATA { <urn:s> <urn:p> "value" }'))
  })

  it('rejects variables where INSERT DATA requires a graph IRI', () => {
    expect(() => update().insertData(statement, '?graph')).toThrow()
  })

  it('serializes CLEAR and DROP graph keywords without a GRAPH prefix', () => {
    for (
      const [builder, expected] of [
        [update().clear('DEFAULT'), 'CLEAR DEFAULT'],
        [update().drop('NAMED'), 'DROP NAMED'],
        [update().drop('ALL', true), 'DROP SILENT ALL'],
      ] as const
    ) expect(query(builder.build().value)).toEqual(query(expected))
  })

  it('serializes COPY, MOVE, and ADD with DEFAULT and named graph operands', () => {
    const source = namedNode('urn:graph:source')
    const target = namedNode('urn:graph:target')
    const document = update()
      .copy(source, 'DEFAULT')
      .move('DEFAULT', target)
      .add(source, target, true)
      .build()

    expect(query(document.value)).toEqual(query([
      'COPY <urn:graph:source> TO DEFAULT',
      'MOVE DEFAULT TO <urn:graph:target>',
      'ADD SILENT <urn:graph:source> TO <urn:graph:target>',
    ].join('; ')))
  })

  it('accepts RDF named nodes for CLEAR/DROP and rejects variable terms in strict graph positions', () => {
    const graph = namedNode('urn:graph:products')
    expect(query(update().clear(graph).drop(graph, true).build().value)).toEqual(query([
      'CLEAR GRAPH <urn:graph:products>',
      'DROP SILENT GRAPH <urn:graph:products>',
    ].join('; ')))
    expect(() => update().clear(variable('graph'))).toThrow()
    expect(() => update().create(variable('graph'))).toThrow()
  })

  it('keeps DELETE/INSERT templates separate from WHERE', () => {
    const document = update()
      .modify()
      .delete(triple('?s', 'schema:old', '?old'))
      .insert(triple('?s', 'schema:new', '?new'))
      .where(triple('?s', 'schema:old', '?old'))
      .done()
      .build()

    const prefix = 'PREFIX schema: <https://schema.org/>'
    expect(query(`${prefix} ${document.value}`)).toEqual(query(`${prefix}
      DELETE { ?s schema:old ?old }
      INSERT { ?s schema:new ?new }
      WHERE { ?s schema:old ?old }
    `))
  })
})
