import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as rdf from '@okikio/rdf'
import { name, offers, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'
import { select, triple, variable } from './mod.ts'
import { query } from '../../conformance/query.ts'

describe('RDF, vocabulary, and SPARQL composition', () => {
  it('uses generated vocabulary values directly as native RDF terms in SPARQL', () => {
    expect(rdf.isTerm(Product)).toBe(true)
    expect(rdf.isTerm(name)).toBe(true)

    const document = select(['product', 'name'])
      .where(
        triple('?product', rdf.namedNode(rdf.RDF.type), Product),
        triple('?product', name, '?name'),
        triple('?product', offers, variable('offer')),
      )
      .build()

    expect(query(document.value)).toEqual(query(`SELECT ?product ?name WHERE {
      ?product <${rdf.RDF.type}> <https://schema.org/Product> .
      ?product <https://schema.org/name> ?name .
      ?product <https://schema.org/offers> ?offer .
    }`))
  })

  it('validates the same vocabulary-shaped data through Standard Schema', async () => {
    const value: ProductType = { '@type': 'Product', name: 'Widget', sku: 'SKU-1' }
    expect(await ProductSchema['~standard'].validate(value)).toEqual({ value })
  })
})
