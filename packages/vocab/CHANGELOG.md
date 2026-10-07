# Changelog

## 0.2.0

2026-10-06

### Compile a resource with both class and property roles

One ontology resource can be declared as both a class and a property. The compiler previously assigned both roles the same TypeScript binding, so importing or type-checking the generated module failed with a duplicate declaration. Binding ownership now includes the declaration role and the IRI. The class keeps its ordinary name, and the colliding property receives the deterministic vocabulary-qualified name; both constants retain the original RDF IRI.

```ts
import { namedNode, quad, RDF } from '@okikio/rdf'
import { compile } from '@okikio/vocab/compile'

const shared = namedNode('https://example.com/Shared')
const result = await compile([{
  id: 'example',
  quads: [
    quad(shared, namedNode(RDF.type), namedNode('http://www.w3.org/2000/01/rdf-schema#Class')),
    quad(
      shared,
      namedNode(RDF.type),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'),
    ),
  ],
}], {
  vocabulary: 'Example',
  namespace: 'https://example.com/',
  prefix: 'example',
})

console.log(result.manifest.symbols)
// [
//   { iri: 'https://example.com/Shared', kind: 'class', name: 'Shared' },
//   { iri: 'https://example.com/Shared', kind: 'property', name: 'ExampleSharedProperty' },
// ]
```

**Generated-name change:** ordinary single-role names remain unchanged. Regenerate a vocabulary containing multiple roles for one resource and use its manifest to find the property or datatype's qualified export. No declaration is silently discarded.

The shipped `@okikio/vocab/schema` remains a 14-term bootstrap: four classes, six properties and four datatype aliases. It is not the complete Schema.org vocabulary. Full ontology generation still requires source/license provenance, enumeration coverage review and a deliberate review of datatype behavior; generated structural validators do not provide ontology reasoning, SHACL validation or full RDF datatype checking.

### Record the compiler version that produced a new manifest

New vocabulary manifests derive their default generator label from the package's declared name and version. `@okikio/vocab@0.2.0` therefore records `@okikio/vocab/0.2.0`, rather than the previous hard-coded `0.1.0` label. This makes a saved artifact's producer identity useful when diagnosing or reproducing generation.

JSR's npm compatibility distribution installs a transport name such as `@jsr/okikio__vocab`. Generated manifests retain the canonical producer name `@okikio/vocab` on that route, with the version taken from the installed package metadata. Moving between direct npm and JSR compatibility packages therefore does not change the producer's identity.

An explicit generator override retains its supplied value. Existing manifests are historical records and are not rewritten: the shipped Schema.org bootstrap still identifies the generator that originally produced it. The label names a producer version; it is not a cryptographic attestation of the input corpus or output bytes.

### Use generated RDF terms and open-world validation together

Generated vocabulary modules supply RDF named nodes, TypeScript types, and Standard Schema validators. Applications can use the same vocabulary identity in query construction and validation without confusing RDF domain statements with required form fields.

```ts
import { ProductSchema } from '@okikio/vocab/schema'

const result = await ProductSchema['~standard'].validate({
  '@type': 'Product',
  name: 'Widget',
})
if (result.issues) throw new Error('Product validation failed')
const schema = ProductSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
console.log(typeof schema) // object
```

The ontology compiler consumes RDF quads and emits inspectable artifacts. Unknown vocabulary extensions are accepted by the open-world runtime. RDFS and OWL domain declarations describe relationships; they do not make every property mandatory. Generated validation is not SHACL validation or complete XML Schema datatype value-space checking.

**Migration:** replace format-specific vocabulary scripts with `compile()` from `@okikio/vocab/compile`, and import generated terms and `*Schema` values from the selected vocabulary module. Keep generated schema behavior aligned with the documented open-world policy.
