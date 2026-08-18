# `@okikio/vocab`

RDF ontology compiler and generated vocabulary runtime.

## Generated vocabulary

Generated vocabularies expose direct RDF terms, TypeScript types, and Standard Schema validators:

```ts
import { name, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'
```

Generated terms are `@okikio/rdf` named nodes, so they work directly with datasets and SPARQL builders.

```ts
import * as rdf from '@okikio/rdf'
import * as sparql from '@okikio/sparql'
import { name, Product } from '@okikio/vocab/schema'

const query = sparql.select(['?product', '?name']).where(
  sparql.triple('?product', rdf.namedNode(rdf.RDF.type), Product),
  sparql.triple('?product', name, '?name'),
)
```

## Standard Schema

Each generated `*Schema` implements runtime validation and Standard JSON Schema conversion on the same `~standard` object:

```ts
const result = await ProductSchema['~standard'].validate({
  '@type': 'Product',
  name: 'Widget',
})

const jsonSchema = ProductSchema['~standard'].jsonSchema.input({
  target: 'draft-2020-12',
})
```

The runtime is open-world. Unknown vocabulary extensions are accepted, and RDFS/OWL domain statements are not converted into false required-property rules.

See [`../../docs/standard-schema.md`](../../docs/standard-schema.md).

## Compiler

The old format-specific `ttl-to-ts` script is replaced by the reusable `compile()` library API:

```ts
import * as turtle from '@okikio/rdf/turtle'
import { compile } from '@okikio/vocab/compile'

const result = await compile([
  { id: 'example', quads: turtle.parse(source) },
], {
  vocabulary: 'example',
  namespace: 'https://example.com/',
  prefix: 'ex',
})
```

The compiler consumes RDF quad sources through `@okikio/rdf/ontology`; it does not own one serialization parser. `.mise/tasks/vocab.ts` is only the repository file-I/O wrapper.

See [`../../docs/vocabulary-generation.md`](../../docs/vocabulary-generation.md).
