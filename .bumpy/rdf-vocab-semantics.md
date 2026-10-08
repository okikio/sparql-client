---
'@okikio/rdf': minor
'@okikio/vocab': minor
---

### Keep RDF identity at factory and JSON-LD boundaries

Empty optional RDF/JS language and graph arguments now select the plain string
and default graph. Copying an external term rejects contradictory literal
metadata, cycles and nesting beyond 512 rather than silently rewriting its tuple.
Generic datatype literals still retain their lexical form; the factory does not
validate every datatype's value space.

```ts
import * as rdf from '@okikio/rdf'

const subject = rdf.namedNode('urn:person')
const predicate = rdf.namedNode('urn:name')
const statement = rdf.quad(subject, predicate, rdf.literal('Ada', ''), null)
console.log(statement.object.value, statement.graph.termType)
// Ada DefaultGraph
```

JSON-LD 1.1 now rejects native RDF 1.2 directional literals, as it already rejects
triple terms. Previously `fromRdf` could lose direction. Its legacy
`i18n-datatype` and `compound-literal` options continue to round-trip their explicit
JSON-LD 1.1 encodings; the default `toRdf` direction omission remains unchanged.

```ts
import * as jsonld from '@okikio/rdf/jsonld'

const options = { rdfDirection: 'i18n-datatype' } as const
const statements = await jsonld.toRdf({
  '@id': 'urn:person',
  'urn:name': { '@value': 'Ada', '@language': 'en', '@direction': 'ltr' },
}, options)
console.log(JSON.stringify(await jsonld.fromRdf(statements, options)))
// [{"@id":"urn:person","urn:name":[{"@value":"Ada","@direction":"ltr","@language":"en"}]}]
```

### Admit each JSON-LD document once under one operation policy

Shared-cache hits now count toward `maxDocuments`, as custom and network results
do. Input, expansion, framing and compaction share operation admission. Each new
admission checks serialized UTF-8 bytes before exposing frozen JSON data. A later
mutation of a borrowed loader/cache object cannot change an operation's context.
Cycles, accessors, non-JSON values and sparse/extended arrays reject. Cache-hit
admission does not write back to the borrowed cache.

```ts
import { createDocumentLoader } from '@okikio/rdf/jsonld'

const context = { '@context': { name: 'urn:name' } }
const load = createDocumentLoader({
  maxDocuments: 1,
  loadDocument: (url) =>
    Promise.resolve({
      documentUrl: url,
      contextUrl: null,
      document: context,
    }),
})
const admitted = await load('https://example.test/context')
context['@context'].name = 'urn:changed'
console.log(JSON.stringify(admitted.document))
// {"@context":{"name":"urn:name"}}
```

`maxBytes` is per admitted document. It bounds retained processing data, not the
caller-owned input allocation or whole-process RSS. Abort settles pending reads
without waiting for uncooperative borrowed cleanup. The explicit
`@okikio/rdf/stream` subpath exposes `pending` and `consume`; `consume` accepts an
optional cleanup observer so ownership and terminal results can be reconciled
separately. Normal early return without that observer awaits cooperative cleanup.

### Give markup processors distinct, explicit host profiles

XML and HTML now have separate native host authorities. XML line endings and
literal attribute whitespace normalize before entity decoding. Malformed XML,
undefined references and invalid namespace/character input reject. The native
XML host parses standalone DOCTYPE declarations and SYSTEM/PUBLIC identifiers
without fetching external subsets. Order/root agreement and identifier grammar
are checked. It remains an XML 1.0 UTF-8 no-DTD-processing profile; it does not provide complete DTD,
encoding or full RDF/XML conformance.

HTML reference decoding uses the complete normative WHATWG table and the
attribute/text consumption rules. JSON-LD extraction walks actual host elements,
so fake scripts/base elements in comments or raw script text do not enter the
result. XML/XHTML remote media selects XML host semantics.

```ts
import { parse } from '@okikio/rdf/rdfa'

const page =
  '<div about="urn:person"><span property="http://schema.org/name">caf&eacute;</span></div>'
for await (const quad of parse(page)) console.log(quad.object.value)
// café
```

The focused native HTML tree supports ordinary explicitly nested extraction,
raw script/style, title/textarea RCDATA and implemented optional end tags. It
implements table section/row/cell insertion, omitted ends and misplaced-content
foster parenting. Its admitted table cases compare element ancestry, attributes
and text with actual Chromium, Firefox and WebKit trees. It rejects
template/foreign-content/frameset/plaintext construction, formatting
adoption and double-escaped script data. Those rejections prevent misleading
output but do not complete the accepted full-host design. Browser insertion
modes, malformed-markup recovery and official host corpus proof remain pending.
An ordinary page containing those constructs is outside this current slice.

### Plan the complete vocabulary API before emitting it

Vocabulary naming now reserves whole export families and module-owned bindings,
so a property named `ProductSchema` cannot overwrite the schema for `Product`.
`manifest.symbols[].exports` records every allocated term/type/schema/property
interface name. Cyclic inheritance is condensed into components; generated
interfaces and runtime schemas consume the same flattened property plan.

```ts
import { compile } from '@okikio/vocab'
import { parse } from '@okikio/rdf/turtle'

const source = `
@prefix ex: <urn:> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Product a rdfs:Class; rdfs:subClassOf ex:Thing .
ex:Thing a rdfs:Class; rdfs:subClassOf ex:Product .
`
const result = await compile([{ id: 'example', quads: parse(source) }], {
  vocabulary: 'Example',
  namespace: 'urn:',
  prefix: 'Ex',
})
console.log(JSON.stringify(result.manifest.symbols.map((symbol) => symbol.exports.schema)))
// ["ProductSchema", "ThingSchema"]
```

Generated reserved-field types, runtime validation and JSON Schema now share
field/range descriptors. An optional `@id` must be a string; multi-type schemas
require every requested type. Unknown extension fields and unknown ontology
ranges remain open. Borrowed schema configuration and returned JSON Schema
objects cannot mutate later validation.

```ts
import { ProductSchema } from '@okikio/vocab/schema'

console.log(
  'issues' in await ProductSchema['~standard'].validate({
    '@type': 'Product',
    '@id': 2,
  }),
)
// true
```

Ontology inspection now retains source/graph/term evidence even for normalized
declarations. A resource may keep class and property roles simultaneously;
`rdf:type xsd:integer` remains an instance assertion. Structured diagnostics pass
through the vocabulary adapter as `problems`. This remains inspection and
structural validation, not ontology reasoning, closed-world requiredness or SHACL
validation. The shipped authored bootstrap was regenerated with current producer
metadata; it still contains 14 terms and is not complete Schema.org.

`compile`/`emit` now bound model terms/edges and emitted bytes through `maxTerms`
(default 100,000) and `maxBytes` (default 32 MiB), plus caller `signal`. `maxProperties` (default
1,000,000) bounds resolved inheritance references before output is allocated. Flattened
inheritance can increase output size. Runtime fixtures prove representative
behavior; no compiler-speed, RSS or full standards conformance claim is made.
