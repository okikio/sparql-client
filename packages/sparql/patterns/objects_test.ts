import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '@okikio/rdf'
import { name, offers, Product } from '@okikio/vocab/schema'
import { node, rel, variable } from '../mod.ts'

describe('@okikio/sparql object patterns', () => {
  it('preserves generated RDF class and property terms', () => {
    const product = node('product', Product)
      .prop(name, variable('name'))
      .prop(offers, variable('offer'))

    expect(product.value.includes(`<${RDF.type}> <https://schema.org/Product>`)).toBe(true)
    expect(product.value.includes('<https://schema.org/name> ?name')).toBe(true)
    expect(product.value.includes('<https://schema.org/offers> ?offer')).toBe(true)
  })

  it('uses full RDF reification IRIs without requiring an rdf prefix', () => {
    const pattern = rel('product', offers, 'maker').prop(name, variable('label')).value
    expect(pattern.includes(`<${RDF.type}> <${RDF.statement}>`)).toBe(true)
    expect(pattern.includes(`<${RDF.subject}> ?product`)).toBe(true)
    expect(pattern.includes(`<${RDF.predicate}> <https://schema.org/offers>`)).toBe(true)
    expect(pattern.includes(`<${RDF.object}> ?maker`)).toBe(true)
  })
})
