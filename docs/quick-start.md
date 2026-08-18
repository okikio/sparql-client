# Quick start

The repository publishes several focused packages. Start with the package that owns the capability you need instead of importing a monolithic runtime.

## RDF values

```ts
import * as rdf from '@okikio/rdf'

const schema = rdf.namespace('https://schema.org/')
const product = rdf.namedNode('https://example.com/products/1')

const data = rdf.dataset([
  rdf.quad(product, rdf.namedNode(rdf.RDF.type), schema('Product')),
  rdf.quad(product, schema('name'), rdf.literal('Widget')),
])
```

Use explicit parser subpaths:

```ts
import * as turtle from '@okikio/rdf/turtle'

for await (
  const quad of turtle.parse(`
  @prefix schema: <https://schema.org/> .
  <https://example.com/products/1> schema:name "Widget" .
`)
) {
  console.log(quad)
}
```

## SPARQL construction

```ts
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?product', '?name'])
  .prefix('schema', 'https://schema.org/')
  .where(sparql.triple('?product', 'schema:name', '?name'))
  .orderBy('?name')
  .limit(25)
```

`query.build()` returns the SPARQL value. It does not perform network work.

## SPARQL endpoint

```ts
import * as http from '@okikio/sparql/http'

const client = http.create({ endpoint: 'https://example.com/sparql' })

for await (const row of await client.queryBindings(query)) {
  console.log(row.get('name')?.value)
}
```

Use the method matching the SPARQL result mode:

```ts
client.queryBindings(query)
client.queryQuads(query)
client.queryBoolean(query)
client.update(update)
```

## Generated vocabulary

Generated vocabulary symbols are direct and tree-shakeable:

```ts
import { name, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'

const product: ProductType = {
  '@type': 'Product',
  name: 'Widget',
}

const result = ProductSchema['~standard'].validate(product)
```

Use a namespace import for operation families such as RDF and SPARQL. Prefer direct imports for generated vocabulary terms, schemas, and types.

## Persistent RDF

```ts
import * as rdf from '@okikio/rdf'
import { open } from '@okikio/triplestore'

await using store = await open(fileSystem, { path: '/knowledge' })
await store.add(rdf.quad(
  rdf.namedNode('https://example.com/products/1'),
  rdf.namedNode('https://schema.org/name'),
  rdf.literal('Widget'),
))
```

The supplied filesystem remains caller-owned.

## Query engines

`@okikio/oxigraph` and `@okikio/comunica` wrap engines that the caller already created. Their imports do not initialize Wasm, create a store, select data sources, or configure global state.
