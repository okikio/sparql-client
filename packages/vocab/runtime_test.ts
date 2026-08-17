import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { createSchema } from './runtime.ts'

describe('@okikio/vocab runtime', () => {
  it('validates every required multi-type name and accepts extension fields', async () => {
    const schema = createSchema({ types: ['Product', 'SoftwareApplication'] })
    expect(await schema['~standard'].validate({ '@type': ['Product', 'SoftwareApplication'], extension: true })).toEqual({
      value: { '@type': ['Product', 'SoftwareApplication'], extension: true },
    })
    const invalid = await schema['~standard'].validate({ '@type': ['Product'] })
    expect('issues' in invalid).toBe(true)
  })

  it('validates arrays and node references against generated range kinds', async () => {
    const schema = createSchema({
      types: ['Product'],
      properties: {
        price: 'number',
        brand: 'node',
        code: ['string', 'number'],
      },
    })
    expect(await schema['~standard'].validate({
      '@type': 'Product',
      price: [10, 20],
      brand: { '@id': 'urn:brand:1' },
      code: ['A', 2],
    })).toEqual({
      value: {
        '@type': 'Product',
        price: [10, 20],
        brand: { '@id': 'urn:brand:1' },
        code: ['A', 2],
      },
    })
  })

  it('handles cyclic parent schemas without duplicate traversal or recursion', async () => {
    let left = createSchema({ types: ['Left'] })
    let right = createSchema({ types: ['Right'] })
    left = createSchema({ types: ['Left'], properties: { left: 'string' }, parents: () => [right] })
    right = createSchema({ types: ['Right'], properties: { right: 'number' }, parents: () => [left] })

    const invalid = await left['~standard'].validate({ '@type': 'Left', left: 'ok', right: 'bad' })
    expect('issues' in invalid).toBe(true)
  })
})
