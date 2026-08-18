import * as rdf from '@okikio/rdf'
import { name, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'

const value: ProductType = {
  '@type': 'Product',
  name: 'Widget',
}

const result = ProductSchema['~standard'].validate(value)
if (result instanceof Promise) {
  throw new TypeError('Generated bootstrap schema is expected to validate synchronously.')
}
if (result.issues) throw new TypeError(result.issues[0]?.message ?? 'Invalid product.')

const subject = rdf.namedNode('https://example.com/products/1')
console.log(rdf.quad(subject, rdf.namedNode(rdf.RDF.type), Product))
console.log(rdf.quad(subject, name, rdf.literal(value.name as string)))
