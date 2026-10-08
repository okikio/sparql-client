---
'@okikio/vocab': minor
---

### Inspect the vocabulary schema contract without exposing validators

`NODE_FIELDS` and `RANGE_KINDS` are now frozen public metadata, available from
both `@okikio/vocab` and `@okikio/vocab/runtime`. Schema editors can inspect the
accepted configuration labels without importing implementation predicates.
`NodeType` and `RangeKindType` derive from this public data, so their documentation
and emitted declarations no longer depend on inaccessible private tables.

```ts
import { createSchema, NODE_FIELDS, RANGE_KINDS } from '@okikio/vocab/runtime'
import type { NodeType, RangeKindType } from '@okikio/vocab/runtime'

type ItemType = NodeType<'Item', { readonly name?: string }>
const nameRange: RangeKindType = 'string'
const schema = createSchema<ItemType>({ types: ['Item'], properties: { name: nameRange } })
const item: ItemType = { '@type': 'Item', '@id': 'urn:item', name: 'Widget', '@context': null }
const result = await schema['~standard'].validate(item)
if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join('; '))
console.log(result.value)
console.log(NODE_FIELDS['@id']) // string
console.log(RANGE_KINDS) // string, number, boolean, node, unknown
```

The reserved identifier remains an optional string. The context field remains
opaque: this structural validator accepts it without interpreting JSON-LD
contexts, and its JSON Schema projection is still `{}`. The private range
predicates remain responsible for actual value checks. These labels do not add
OWL inference, SHACL constraints, IRI validation, or required vocabulary
properties. Unknown extension properties are still accepted.

A compiled manifest records each symbol's complete `exports` family. A class
named `Item` reserves `Item`, `ItemType`, `ItemSchema`, and
`ItemPropertiesType`; a property reserves its term binding. Readers comparing a
manifest should include this family instead of expecting only `iri`, `kind`, and
`name` or silently discarding export collision information.
