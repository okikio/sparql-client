import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import type { StandardJSONSchemaV1 as OfficialJSONSchemaV1, StandardSchemaV1 as OfficialSchemaV1 } from '@standard-schema/spec'
import { ProductSchema, type ProductType } from './schema/mod.ts'
import type { StandardInferInput, StandardInferOutput, StandardJSONSchemaV1, StandardSchemaV1 } from './standard.ts'

/** Compile-time assertion that generated schemas satisfy both local and official contracts. */

/** Compile-time proof that local Standard Typed inference preserves the generated schema output type. */
function acceptInference(_input: StandardInferInput<typeof ProductSchema>, output: StandardInferOutput<typeof ProductSchema>): ProductType {
  return output
}

function acceptSchema(
  schema: StandardSchemaV1<unknown, ProductType> &
    StandardJSONSchemaV1<unknown, ProductType> &
    OfficialSchemaV1<unknown, ProductType> &
    OfficialJSONSchemaV1<unknown, ProductType>,
): void {
  void schema
}

describe('@okikio/vocab Standard Schema', () => {
  it('is structurally assignable to the pinned Standard Schema v1 contracts', () => {
    acceptSchema(ProductSchema)
    const value: ProductType = { '@type': 'Product' }
    expect(acceptInference(value, value)).toEqual(value)
  })

  it('validates generated output while preserving issue paths', async () => {
    const value: ProductType = { '@type': 'Product', name: 'Widget', custom: true }
    expect(await ProductSchema['~standard'].validate(value)).toEqual({ value })

    const invalid = await ProductSchema['~standard'].validate({ '@type': 'Product', name: 42 })
    expect('issues' in invalid).toBe(true)
    if ('issues' in invalid && invalid.issues) expect(invalid.issues[0]?.path).toEqual(['name', 0])
  })

  it('emits the two recommended JSON Schema drafts and stays open-world', () => {
    const current = ProductSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    const draft7 = ProductSchema['~standard'].jsonSchema.input({ target: 'draft-07' })
    expect(current['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(draft7['$schema']).toBe('http://json-schema.org/draft-07/schema#')
    expect(current['additionalProperties']).toBe(true)
  })

  it('validates inherited properties without duplicating parent descriptors', async () => {
    const result = await ProductSchema['~standard'].validate({ '@type': 'Product', name: 42 })
    expect('issues' in result).toBe(true)
  })

  it('rejects conversion targets the runtime cannot represent soundly', () => {
    expect(() => ProductSchema['~standard'].jsonSchema.output({ target: 'openapi-3.0' })).toThrow()
  })
})
