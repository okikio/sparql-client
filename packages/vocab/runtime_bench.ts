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

if (validate(valid) !== 0) throw new Error('Vocabulary runtime benchmark valid-data oracle failed.')
if (validate(invalid) !== PRODUCTS) {
  throw new Error('Vocabulary runtime benchmark invalid-data oracle failed.')
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
