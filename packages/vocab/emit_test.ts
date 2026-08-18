import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import { emit, inspect } from './mod.ts'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class')

describe('@okikio/vocab', () => {
  it('emits deterministic direct class term/type/schema exports', async () => {
    const product = namedNode('https://schema.org/Product')
    const model = await inspect([{ id: 'schema', quads: [quad(product, RDF_TYPE, RDFS_CLASS)] }])
    const source =
      emit(model, { vocabulary: 'Schema.org', namespace: 'https://schema.org/', prefix: 'schema' })
        .source
    expect(source.includes('export const Product =')).toBe(true)
    expect(source.includes('export type ProductType =')).toBe(true)
    expect(source.includes('export const ProductSchema =')).toBe(true)
  })
})
