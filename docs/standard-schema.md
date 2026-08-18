# Standard Schema in generated vocabularies

`@okikio/vocab` exposes generated vocabulary schemas through the Standard Schema family of structural interfaces. A generated class such as `Product` normally has four related public symbols:

```ts
import {
  Product,
  type ProductPropertiesType,
  ProductSchema,
  type ProductType,
} from '@okikio/vocab/schema'
```

- `Product` is the RDF named node for the class IRI.
- `ProductPropertiesType` is the generated TypeScript property map.
- `ProductType` is the open-world JSON-LD object type.
- `ProductSchema` is a runtime validator and JSON Schema converter.

The implementation is dependency-free. `@okikio/vocab/standard` contains structural copies of the Standard Typed v1, Standard Schema v1, and Standard JSON Schema v1 interfaces. Standard Schema explicitly allows implementers to copy those interfaces, so consumers do not need a schema library just to use generated vocabulary validators.

The permanent `standard_test.ts` also imports `@standard-schema/spec`; under the canonical Deno/JSR check that acts as an independent structural compatibility test. Assistant fallback environments that cannot resolve JSR must not count an alias to the local copy as proof of upstream compatibility.

## The three contracts

The names are related but they solve different problems.

| Contract             | Purpose                                    | Generated vocabulary use                                              |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Standard Typed       | common metadata and input/output inference | base shape of the generated `~standard` object                        |
| Standard Schema      | runtime validation                         | `ProductSchema['~standard'].validate(value)`                          |
| Standard JSON Schema | JSON Schema conversion                     | `ProductSchema['~standard'].jsonSchema.input(...)` and `.output(...)` |

One generated schema object implements both Standard Schema and Standard JSON Schema:

```ts
import { ProductSchema } from '@okikio/vocab/schema'

const result = await ProductSchema['~standard'].validate({
  '@type': 'Product',
  name: 'Widget',
})

if ('issues' in result) {
  console.error(result.issues)
} else {
  console.log(result.value)
}
```

Consumers that understand the Standard Schema protocol can accept the same object without importing `@okikio/vocab`-specific adapter code.

## JSON Schema conversion

The same schema can produce a JSON Schema representation:

```ts
const input = ProductSchema['~standard'].jsonSchema.input({
  target: 'draft-2020-12',
})

const output = ProductSchema['~standard'].jsonSchema.output({
  target: 'draft-07',
})
```

The current runtime supports:

- `draft-2020-12`
- `draft-07`

Unsupported targets, including `openapi-3.0`, fail explicitly. The runtime does not silently emit a dialect whose semantics it does not implement.

## Open-world semantics

Generated vocabulary schemas are intentionally open-world.

```ts
const result = ProductSchema['~standard'].validate({
  '@type': 'Product',
  name: 'Widget',
  'https://example.com/custom': 'kept',
})
```

Unknown extension properties are accepted. Generated JSON Schema therefore uses `additionalProperties: true`.

This is important because an RDF vocabulary is not a closed JSON object schema. RDFS and OWL describe semantic relationships. They do not mean that every property whose domain includes `Product` must appear on every product.

For example, this ontology statement:

```text
schema:name rdfs:domain schema:Thing
```

means that using `schema:name` can support an inference about the subject's class. It does **not** mean `name` is required on every `Thing`.

`@okikio/vocab` therefore does not convert ontology domain/range metadata into required-property/cardinality rules.

## Inheritance

Generated child schemas compose parent schemas at runtime instead of copying every inherited property descriptor into every generated class.

Conceptually:

```text
ThingSchema
    ^
    |
ProductSchema
    ^
    |
SoftwareApplicationSchema
```

When `ProductSchema` validates a property, it visits its own generated ranges and then inherited ranges. The runtime tracks visited schema objects and property names so cyclic or redundant superclass graphs cannot recurse forever.

This composition model exists for both semantic and performance reasons. It preserves inherited range validation while avoiding the O(n^2) generated-source growth that occurs when every subclass physically repeats all inherited validators.

## Multi-typed values

RDF and JSON-LD can give one node multiple types. Generated multi-type helpers model that without adding a string index signature that would erase useful property typing.

A schema whose generated `types` list contains several class names requires all of those names to be represented in the JSON-LD `@type` array.

## Range validation

The current generated runtime intentionally uses a small structural range model:

```ts
export type RangeKindType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'node'
  | 'unknown'
```

This is not a claim that every RDF datatype, OWL restriction, or SHACL constraint can be represented by those five values. It is the subset the generated structural validator can enforce without misrepresenting ontology semantics.

Stricter rules belong to shape/profile data. `@okikio/rdf/shape` is the loss-preserving SHACL model used for that separate concern.

```text
RDFS / OWL vocabulary
        |
        +--> generated TypeScript vocabulary types
        +--> permissive structural Standard Schema

SHACL / explicit profile
        |
        +--> requiredness, cardinality, patterns, closedness,
             and other validation constraints
```

The project should not collapse those two paths into one validator.

## Public contracts

Use `@okikio/vocab/standard` when a library needs the structural protocol types directly:

```ts
import type {
  StandardInferInput,
  StandardInferOutput,
  StandardJSONSchemaV1,
  StandardResult,
  StandardSchemaV1,
} from '@okikio/vocab/standard'

type ProductInput = StandardInferInput<typeof ProductSchema>
type ProductOutput = StandardInferOutput<typeof ProductSchema>
```

The module also exposes the direct equivalents of the specification's nested support types, including path segments, validation options, success/failure results, inferred type pairs, and the JSON Schema converter. The names are flat so callers can use either direct imports or `import * as standard` without requiring TypeScript namespaces.

Use `@okikio/vocab/runtime` when implementing or composing generated vocabulary schemas:

```ts
import {
  createSchema,
  type NodeType,
  type ValueType,
  type VocabularySchema,
} from '@okikio/vocab/runtime'
```

Normal vocabulary consumers generally import only the generated vocabulary subpath.

## Validation policy

The package-owned `packages/vocab/standard_test.ts` test imports the official `@standard-schema/spec` type contracts in the canonical Deno configuration. The generated runtime must remain structurally assignable to those contracts.

The production runtime does not depend on that package. The official spec package is a compatibility oracle for tests, not an implementation dependency.
