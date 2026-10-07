# `@okikio/vocab`

RDF ontology compiler and generated vocabulary runtime.

## Generated vocabulary

Generated vocabularies expose direct RDF terms, TypeScript types, and Standard Schema validators:

```ts
import { name, Product, ProductSchema, type ProductType } from '@okikio/vocab/schema'
```

Generated terms are `@okikio/rdf` named nodes, so they work directly with datasets and SPARQL builders.

The shipped `schema` subpath contains 14 terms from the repository's authored
bootstrap fixture: four classes, six properties and four datatype aliases. It is
not a complete Schema.org release. Its descriptions and structural validators
exercise the compiler API; they do not establish complete enumeration coverage,
RDF datatype validation or ontology reasoning. See the
[source and coverage policy](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/vocabulary-generation.md#schemaorg-provenance).

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

See [Standard Schema](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/standard-schema.md).

## Compiler

The old format-specific `ttl-to-ts` script is replaced by the reusable `compile()` library API:

```ts
import * as turtle from '@okikio/rdf/turtle'
import { compile } from '@okikio/vocab/compile'

const source = `
  <https://example.com/Product>
    a <http://www.w3.org/2000/01/rdf-schema#Class> .
`
const result = await compile([
  { id: 'example', quads: turtle.parse(source) },
], {
  vocabulary: 'example',
  namespace: 'https://example.com/',
  prefix: 'ex',
})
```

The compiler consumes RDF quad sources through `@okikio/rdf/ontology`; it does not own one serialization parser. `.mise/tasks/vocab.ts` is only the repository file-I/O wrapper.

See [Vocabulary generation](https://github.com/okikio/sparql-client/blob/v0.2.0/docs/vocabulary-generation.md).
