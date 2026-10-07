import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import { query } from '../../../conformance/query.ts'
import { triple, triples, tripleTerm } from './triples.ts'

describe('@okikio/sparql triple patterns', () => {
  it('preserves predicate variables instead of turning them into prefixed names', () => {
    const expected = query('SELECT * WHERE { ?s ?p ?o }')
    expect(query(`SELECT * WHERE { ${triple('?s', '?p', '?o').value} }`)).toEqual(expected)
    // Layout is incidental; variable role and identity are observable semantics.
    expect(query('select * where {\n $s   $p  $o .\n}')).toEqual(expected)
    expect(query('SELECT * WHERE { ?s <urn:p> ?o }')).not.toEqual(expected)
  })

  it('accepts RDF named nodes in every RDF IRI-bearing position', () => {
    const pattern = triple(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o'))
    const expected = query('SELECT * WHERE { <urn:s> <urn:p> <urn:o> }')
    expect(query(`SELECT * WHERE { ${pattern.value} }`)).toEqual(expected)
    for (
      const wrong of [
        '<urn:wrong> <urn:p> <urn:o>',
        '<urn:s> <urn:wrong> <urn:o>',
        '<urn:s> <urn:p> <urn:wrong>',
      ]
    ) {
      expect(query(`SELECT * WHERE { ${wrong} }`)).not.toEqual(expected)
    }
  })

  it('rejects empty grouped predicate-object lists', () => {
    expect(() => triples('?s', [])).toThrow(TypeError)
  })

  it('builds an RDF 1.2 triple term in the object role', () => {
    const term = tripleTerm('?s', namedNode('urn:p'), '?o')
    const expected = query('SELECT * WHERE { ?owner <urn:asserts> <<( ?s <urn:p> ?o )>> }')
    expect(query(`SELECT * WHERE { ?owner <urn:asserts> ${term.value} }`)).toEqual(expected)
    expect(query('SELECT * WHERE { ?owner <urn:asserts> <<( ?s <urn:wrong> ?o )>> }'))
      .not.toEqual(expected)
  })
})
