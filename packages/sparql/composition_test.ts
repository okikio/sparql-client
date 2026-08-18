import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import * as rdf from '@okikio/rdf'
import { name, offers, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'
import { select, triple, variable } from './mod.ts'

describe('RDF, vocabulary, and SPARQL composition', () => {
  it('uses generated vocabulary values directly as native RDF terms in SPARQL', () => {
    expect(rdf.isTerm(Product)).toBe(true)
    expect(rdf.isTerm(name)).toBe(true)

    const query = select(['product', 'name'])
      .where(
        triple('?product', rdf.namedNode(rdf.RDF.type), Product),
        triple('?product', name, '?name'),
        triple('?product', offers, variable('offer')),
      )
      .build()

    expect(query.value.includes('?product <https://schema.org/name> ?name .')).toBe(true)
    expect(query.value.includes('?product <https://schema.org/offers> ?offer .')).toBe(true)
  })

  it('validates the same vocabulary-shaped data through Standard Schema', async () => {
    const value: ProductType = { '@type': 'Product', name: 'Widget', sku: 'SKU-1' }
    expect(await ProductSchema['~standard'].validate(value)).toEqual({ value })
  })
})
