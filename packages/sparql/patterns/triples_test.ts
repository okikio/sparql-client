import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode } from '@okikio/rdf'
import { triple, triples, tripleTerm } from './triples.ts'

describe('@okikio/sparql triple patterns', () => {
  it('preserves predicate variables instead of turning them into prefixed names', () => {
    expect(triple('?s', '?p', '?o').value).toBe('?s ?p ?o .')
  })

  it('accepts RDF named nodes in every RDF IRI-bearing position', () => {
    expect(triple(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')).value).toBe(
      '<urn:s> <urn:p> <urn:o> .',
    )
  })

  it('rejects empty grouped predicate-object lists', () => {
    expect(() => triples('?s', [])).toThrow('at least one')
  })

  it('builds RDF 1.2 triple-term syntax as a term', () => {
    expect(tripleTerm('?s', namedNode('urn:p'), '?o').value).toBe('<<( ?s <urn:p> ?o )>>')
  })
})
