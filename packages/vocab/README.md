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

## Compiler graph and validation boundaries

Naming reserves each class's term, type, schema and property-interface family,
each datatype's term/type pair, and module-owned imports/types before allocating
another binding. The manifest's `symbols[].exports` records the whole family;
colliding source names receive a deterministic qualified name. Consumers should
read that manifest rather than reconstruct an export name from the source IRI.

Inheritance uses strongly connected components. A cycle contributes its
structural properties to every member, then inherits through the acyclic
component graph. The emitted property interfaces and runtime configurations use
the same resolved property sets; cyclic interface `extends` clauses and deferred
runtime parent chains are removed from generated output. This projection is not
RDFS/OWL entailment or SHACL validation. It keeps unknown ranges open instead of
guessing a node-only constraint. Named-node ranges accept strings and structural
objects; they do not recursively validate another generated class.

Generated `NodeType`, runtime validation and JSON Schema derive reserved fields
from one descriptor: `@id` is an optional string and `@context` remains open.
Multi-type schemas require every named type in an array. Unknown extension fields
remain accepted. Schema creation snapshots supplied type/range data, and JSON
Schema exports are independent values; mutating caller-owned configuration or
an exported schema cannot change later validation.

`emit` and `compile` accept `maxTerms` (default 100,000 classes, properties,
datatypes and inheritance/domain/range edges), `maxBytes` (default 32 MiB of
emitted TypeScript) and `signal`. They reject limits instead of returning a
partial module. Flattened inheritance can increase output size; its cost includes
the properties materialized for each class. No compiler/RSS performance budget
is claimed without a measured baseline. Ingestion remains separately bounded
by `inspect.maxQuads`. `maxProperties` (default 1,000,000) bounds effective
property references materialized while resolving the inheritance DAG, before
the output byte cap can apply.

Ontology inspection preserves full input assertion evidence, including source
and graph keys for normalized declarations, and treats class/property/datatype
roles independently. `rdf:type xsd:integer` remains an instance assertion.
`inspect().problems` retains machine-readable source diagnostics; the manifest
carries these when available, alongside display-oriented `diagnostics` for
historical manifest readers. Neither projection is a reasoner.
