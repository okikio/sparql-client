import * as rdf from '@okikio/rdf'
import * as nquads from '@okikio/rdf/nquads'

const schema = rdf.namespace('https://schema.org/')
const product = rdf.namedNode('https://example.com/products/1')
const data = rdf.dataset([
  rdf.quad(product, rdf.namedNode(rdf.RDF.type), schema('Product')),
  rdf.quad(product, schema('name'), rdf.literal('Widget')),
])

console.log(nquads.write(data))
