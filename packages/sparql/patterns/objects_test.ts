import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '@okikio/rdf'
import { name, offers, Product } from '@okikio/vocab/schema'
import { node, rel, variable } from '../mod.ts'
import { Parser } from '@traqula/parser-sparql-1-2'
import { query } from '../../../conformance/query.ts'

describe('@okikio/sparql object patterns', () => {
  it('preserves generated RDF class and property terms', () => {
    const product = node('product', Product)
      .prop(name, variable('name'))
      .prop(offers, variable('offer'))

    expect(query(`SELECT * WHERE { ${product.value} }`)).toEqual(query(`SELECT * WHERE {
      ?product <${RDF.type}> <https://schema.org/Product> .
      ?product <https://schema.org/name> ?name .
      ?product <https://schema.org/offers> ?offer .
    }`))
  })

  it('uses full RDF reification IRIs without requiring an rdf prefix', () => {
    const pattern = rel('product', offers, 'maker').prop(name, variable('label')).value
    const parsed = new Parser().parse(`SELECT * WHERE { ${pattern} }`)
    if (parsed.type !== 'query' || parsed.subType !== 'select') {
      throw new TypeError('Expected SELECT query.')
    }
    expect(parsed.where?.patterns).toHaveLength(1)
    const bgp = parsed.where?.patterns[0]
    if (!bgp || !('triples' in bgp)) throw new TypeError('Expected basic graph pattern.')
    const triples = bgp.triples.map((value) => {
      if (
        value.type !== 'triple' ||
        (!('value' in value.subject) && value.subject.subType !== 'blankNode') ||
        !('value' in value.predicate) || !('value' in value.object)
      ) throw new TypeError('Expected flat triple terms.')
      return { subject: value.subject, predicate: value.predicate, object: value.object }
    })
    expect(triples).toHaveLength(6)
    const metadata = triples.filter((value) => value.subject.subType === 'blankNode')
    expect(metadata).toHaveLength(5)
    // The reifier label is opaque, but every metadata statement must refer to
    // the same node and retain the edge endpoints plus the supplied label.
    expect(
      new Set(metadata.map((value) => {
        if (value.subject.subType !== 'blankNode') throw new TypeError('Expected reifier node.')
        return value.subject.label
      })).size,
    ).toBe(1)
    expect(
      metadata.map((value) => [
        value.predicate.value,
        value.object.subType,
        value.object.value,
      ]).sort(),
    ).toEqual([
      [RDF.type, 'namedNode', RDF.statement],
      [RDF.subject, 'variable', 'product'],
      [RDF.predicate, 'namedNode', 'https://schema.org/offers'],
      [RDF.object, 'variable', 'maker'],
      ['https://schema.org/name', 'variable', 'label'],
    ].sort())
    const edge = triples.find((value) => value.subject.subType === 'variable')
    expect(edge).toMatchObject({
      subject: { subType: 'variable', value: 'product' },
      predicate: { subType: 'namedNode', value: 'https://schema.org/offers' },
      object: { subType: 'variable', value: 'maker' },
    })
  })
})
