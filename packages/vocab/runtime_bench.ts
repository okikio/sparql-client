/** Decision benchmark for generated Standard Schema runtime validation. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { report } from '../../bench/report.ts'
import { ProductSchema, type ProductType } from './schema/mod.ts'

const PRODUCTS = 10_000
const valid: ProductType[] = Array.from({ length: PRODUCTS }, (_, index) => ({
  '@type': 'Product',
  name: `Product ${index}`,
  sku: `SKU-${index}`,
}))
const invalid = valid.map((value, index) => ({ ...value, name: index }))

const validate = (values: readonly unknown[]): number => {
  let issues = 0
  for (const value of values) {
    const result = ProductSchema['~standard'].validate(value)
    if (result instanceof Promise) {
      throw new Error('Generated bootstrap schema unexpectedly became async.')
    }
    if ('issues' in result) issues += result.issues?.length ?? 0
  }
  return issues
}

/** Inspect every result independently: issue multiplicity and prose are not the validation contract. */
for (let index = 0; index < PRODUCTS; index++) {
  const positive = ProductSchema['~standard'].validate(valid[index]!)
  const negative = ProductSchema['~standard'].validate(invalid[index])
  if (positive instanceof Promise || negative instanceof Promise) {
    throw new Error('Generated bootstrap schema unexpectedly became async.')
  }
  if (positive.issues !== undefined || positive.value.name !== valid[index]!.name) {
    throw new Error(`Vocabulary runtime benchmark valid Product ${index} differs.`)
  }
  if (!negative.issues?.some((issue) => issue.path?.includes('name'))) {
    throw new Error(`Vocabulary runtime benchmark invalid Product ${index} lost its name issue.`)
  }
}

group('vocab generated Standard Schema: 10k Product objects', () => {
  bench('valid objects', () => {
    do_not_optimize(validate(valid))
  })

  bench('invalid inherited property', () => {
    do_not_optimize(validate(invalid))
  })
})

await report()
