import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import { emit, inspect } from './mod.ts'
import type { NamedNode } from '@okikio/rdf'
import type { VocabularySchema } from './runtime.ts'
import { toFileUrl } from '@std/path'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class')

describe('@okikio/vocab', () => {
  it('emits deterministic class terms and usable Standard Schema exports', async () => {
    const product = namedNode('https://schema.org/Product')
    const model = await inspect([{ id: 'schema', quads: [quad(product, RDF_TYPE, RDFS_CLASS)] }])
    const result = emit(model, {
      vocabulary: 'Schema.org',
      namespace: 'https://schema.org/',
      prefix: 'schema',
    })
    expect(result).toEqual(emit(model, {
      vocabulary: 'Schema.org',
      namespace: 'https://schema.org/',
      prefix: 'schema',
    }))
    const directory = await Deno.makeTempDir({ prefix: 'emitted-vocabulary-' })
    try {
      const file = `${directory}/vocabulary.ts`
      await Deno.writeTextFile(file, result.source)
      const generated: { Product: NamedNode; ProductSchema: VocabularySchema } = await import(
        toFileUrl(file).href
      )
      expect(generated.Product.equals(product)).toBe(true)
      const value = { '@type': 'Product', extension: 'retained' }
      expect(await generated.ProductSchema['~standard'].validate(value)).toEqual({ value })
      expect(await generated.ProductSchema['~standard'].validate({ '@type': 'Other' }))
        .toMatchObject({ issues: expect.any(Array) })
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
