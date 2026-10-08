---
'@okikio/rdf': patch
---

### Turtle and TriG preserve RDF identity at statement boundaries

Importing data from another RDF library should retain its RDF terms. This patch fixes six groups of
Turtle and TriG parsing defects found by adopting pinned upstream regression cases.

The following complete example accepts a boolean beside a statement-ending dot, a literal whose
language tag happens to be `prefix`, and a prefixed name ending in an escaped dot:

```ts
import { parse } from '@okikio/rdf/turtle'

const source = String.raw`@prefix ex: <https://example.org/path/../> .
ex:s ex:p true.
ex:s ex:p "label"@prefix.
ex:s ex:p ex:local\. .`

for await (const quad of parse(source)) {
  console.log(quad.subject.value, quad.object.value)
}
// https://example.org/path/../s true
// https://example.org/path/../s label
// https://example.org/path/../s https://example.org/path/../local.
```

Previously, these statement boundaries could cause valid data to be rejected. Directive-shaped
language tags (`base`, `prefix`, and `version`) now remain language tags after a quoted literal.
Escaped terminal dots remain part of the local name instead of becoming statement delimiters.

Absolute IRI spelling and namespace concatenation now remain intact. An RDF IRI containing
`/path/../` is an identifier with those characters; normalizing it as a navigation URL can change
term equality, joins, and graph lookup. Relative references still resolve against their base.

The parser also rejects invalid prefix/local-name Unicode characters, an empty anonymous subject
with no predicate (`[].`), and a relative path whose first segment contains a colon but is not a
valid scheme. These checks follow the Turtle grammar and RFC 3986 path rules. Applications that
previously imported these invalid forms must correct the data rather than rely on acceptance.

The shared compact parser gives TriG the same fixes. Coverage combines official conformance cases
with upstream acceptance, rejection, and RDF-meaning oracles, including hostile byte boundaries.
The adopted suites cover declared profiles; they do not claim every input, query-engine feature,
or deployment environment.
