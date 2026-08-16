import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import { SPARQL_UPDATE_BRAND, strlit, triple, update, variable } from './mod.ts'

describe('@okikio/sparql update builder', () => {
  const statement = triple(namedNode('urn:s'), namedNode('urn:p'), strlit('value'))

  it('builds a distinct complete update document', () => {
    const document = update().insertData(statement).build()
    expect(document[SPARQL_UPDATE_BRAND]).toBe(true)
    expect(document.value).toBe('INSERT DATA { <urn:s> <urn:p> "value" . }')
  })

  it('rejects variables where INSERT DATA requires a graph IRI', () => {
    expect(() => update().insertData(statement, '?graph')).toThrow()
  })

  it('serializes CLEAR and DROP graph keywords without a GRAPH prefix', () => {
    expect(update().clear('DEFAULT').build().value).toBe('CLEAR DEFAULT')
    expect(update().drop('NAMED').build().value).toBe('DROP NAMED')
    expect(update().drop('ALL', true).build().value).toBe('DROP SILENT ALL')
  })

  it('serializes COPY, MOVE, and ADD with DEFAULT and named graph operands', () => {
    const source = namedNode('urn:graph:source')
    const target = namedNode('urn:graph:target')
    const document = update()
      .copy(source, 'DEFAULT')
      .move('DEFAULT', target)
      .add(source, target, true)
      .build()

    expect(document.value).toBe([
      'COPY <urn:graph:source> TO DEFAULT',
      'MOVE DEFAULT TO <urn:graph:target>',
      'ADD SILENT <urn:graph:source> TO <urn:graph:target>',
    ].join(';\n'))
  })


  it('accepts RDF named nodes for CLEAR/DROP and rejects variable terms in strict graph positions', () => {
    const graph = namedNode('urn:graph:products')
    expect(update().clear(graph).drop(graph, true).build().value).toBe([
      'CLEAR GRAPH <urn:graph:products>',
      'DROP SILENT GRAPH <urn:graph:products>',
    ].join(';\n'))
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

    expect(document.value.includes('DELETE { ?s schema:old ?old . }')).toBe(true)
    expect(document.value.includes('INSERT { ?s schema:new ?new . }')).toBe(true)
    expect(document.value.includes('WHERE { ?s schema:old ?old . }')).toBe(true)
  })
})
