# Changelog

## 0.2.1

2026-10-07

### Construct and inspect SHACL paths through public imports

`@okikio/rdf/shape` now exports `ShapeIndex`, the constructor required by its
existing `getPath` operation. Previously, a public-package caller could import
`getPath` but could not construct its index without reaching into an unexported
module. Use the public entry point for both operations; no private import or type
cast is needed.

The following complete example decodes the sequence `urn:name / ^urn:label` from
a small materialized shapes graph:

```ts
import { blankNode, namedNode, quad, RDF } from '@okikio/rdf'
import type { DiagnosticType } from '@okikio/rdf/shape'
import { getPath, ShapeIndex } from '@okikio/rdf/shape'

const head = blankNode()
const tail = blankNode()
const inverse = blankNode()
const index = new ShapeIndex()
for (
  const value of [
    quad(head, namedNode(RDF.first), namedNode('urn:name')),
    quad(head, namedNode(RDF.rest), tail),
    quad(tail, namedNode(RDF.first), inverse),
    quad(tail, namedNode(RDF.rest), namedNode(RDF.nil)),
    quad(inverse, namedNode('http://www.w3.org/ns/shacl#inversePath'), namedNode('urn:label')),
  ]
) index.add(value)

const diagnostics: DiagnosticType[] = []
const path = getPath(index, head, { maxDepth: 4, maxListItems: 2, diagnostics })
console.log(path)
// { kind: 'sequence', items: [
//   { kind: 'predicate', iri: 'urn:name' },
//   { kind: 'inverse', path: { kind: 'predicate', iri: 'urn:label' } },
// ] }
console.log(diagnostics.length) // 0
```

The caller owns the mutable index. It retains added RDF objects without copying
or disposal; do not mutate those objects or readonly lookup results. Add each
quad once, since duplicate additions remain duplicates. Subject/predicate lookups
combine every supplied graph, so select one shapes graph or an intentional union
before populating the index.

`maxDepth` and `maxListItems` must be positive safe integers. They bound path
traversal, not index construction: bound the supplied quad collection yourself,
or use `shape.inspect` for bounded whole-graph ingestion. Malformed, cyclic,
unsupported, or over-limit paths retain unknown records with structured
diagnostics. Read the diagnostics before relying on a compound path. This API
inspects SHACL structure; it does not evaluate paths, validate a data graph, or
perform entailment. Existing `shape.inspect` callers require no changes.

## 0.2.0

2026-10-06

### Spend less time scheduling buffered Turtle and TriG characters

Turtle and TriG now consume an already buffered character synchronously. The scanner awaits the source when it needs more input, while the public parser remains an asynchronous iterator. This removes a promise and microtask cost from repeated character reads without changing the choice between streaming consumption and retaining a complete quad array. Source cancellation, early iterator return, source positions, and token limits remain part of the parser contract.

CPU and allocation profiles identified character scheduling before the change. A frozen comparison changed only `compact.ts` within the executed parser dependency graph. On an Apple M1 Pro with 16 GiB RAM, Deno 2.9.7 and V8 15.0.245.2-rusty, complete parsing and array materialization of synthetic ASCII documents produced these median elapsed times:

| Whole-input workload                      | Previous scanner | Buffered scanner | Observations per side |
| ----------------------------------------- | ---------------: | ---------------: | --------------------: |
| Turtle: 1 million quads, 32,777,816 bytes |    11,188.965 ms |     4,141.121 ms |                     3 |
| TriG: 1 million quads, 42,777,816 bytes   |    15,378.382 ms |     5,881.366 ms |                     3 |

Each statement has a unique subject and plain literal; TriG wraps each statement in one of eight named graphs. Output arrays are retained and their counts consumed. An independent oracle checks every term and graph outside the parse timer. These observations include first-parse JIT work and use fixed serial ordering on a shared host; three observations do not establish production tail latency or a universal speed guarantee.

The warmed Mitata comparison at 100,000 quads also retains complete arrays. Its whole-input native medians were 1,144.153 → 486.976 ms for Turtle and 1,588.594 → 666.385 ms for TriG. The corresponding N3 medians were 88.885 and 160.626 ms, so N3 remains about 5.5 and 4.1 times faster on this particular workload. The comparison preserves Mitata's normal sampling and explicit collection before and after each batch: native rows have 12 raw samples, N3 Turtle has 11, and N3 TriG has 12. Native 4 KiB chunk cases show a similar scanner benefit. N3 uses its whole-document array API and some lazy term accessors; this does not measure every application's downstream field-access cost.

At 100,000 quads, V8's sampled cumulative allocation attribution decreased by about 73%. This is an estimate that includes collected objects, not an exact allocation count or retained-memory measurement. Turtle's million-quad process high-water RSS stayed approximately 723 → 724 MiB. That process measurement includes setup and materialized results, so faster parsing does not imply a memory cap or prove absence of leaks. This local input workload does not use a network source.

These numbers belong to the frozen scanner experiment. The subsequent escaped-token guards and option validation described below were not timed in that experiment. Use the reproduction and workload-budget procedure in the [parser benchmark guide](https://github.com/okikio/sparql-client/blob/v0.2.0/bench/parser/README.md) to assess your own document sizes, chunk sources, output consumption, runtime, and machine baseline.

### Count encoded tokens and reject invalid resource limits

`maxTokenLength` measures the token's raw source spelling in UTF-16 code units, including delimiters and escape spelling. It does not measure the decoded literal length or UTF-8 byte count. Unicode escapes, ordinary string escapes, and escaped or percent-encoded prefixed-name characters now enforce that cap as the token grows. An over-limit escaped token can fail before acquiring another source chunk instead of bypassing the bound until a later parser step.

**Upgrade behavior:** `maxTokenLength`, `maxDepth`, and `maxStatementEvents` require nonnegative safe integers. `NaN`, infinity, negative values, fractions, and unsafe integers now throw `TypeError` before source acquisition. Zero remains a valid configured bound, including the existing empty-input behavior. Replace invalid values with an explicit finite bound; omitting an option selects its documented default: 8,388,608 source code units per token, depth 128, and 1,000,000 buffered semantic events per tolerant statement. Account for the encoded token spelling when selecting a token cap. These record limits do not bound the total size of a quad array that the caller elects to retain.

### Read RDF through independently useful streaming syntax modules

The RDF package now supplies terms, DatasetCore-style set operations, and native syntax readers through explicit subpaths. A consumer can parse N-Triples, N-Quads, Turtle, TriG, or RDF/XML without installing a query engine. JSON-LD, RDFa, Microdata, canonicalization, ontology inspection, and shape inspection remain separate capabilities.

```ts
import * as rdf from '@okikio/rdf'
import * as turtle from '@okikio/rdf/turtle'
import * as nquads from '@okikio/rdf/nquads'

const values = []
for await (const value of turtle.parse('@prefix ex: <urn:> . ex:product ex:name "Widget" .')) {
  values.push(value)
}
const data = rdf.dataset(values)
console.log(data.size) // 1
console.log(nquads.write(data)) // <urn:product> <urn:name> "Widget" .
```

Readers expose asynchronous iteration so consumers can stop early, use an AbortSignal, and retain backpressure instead of materializing an entire document. The array above is an explicit small-document materialization point. Set the reader's documented limits for untrusted inputs; byte, statement, nesting, list, and remote-document policies belong to their respective capabilities.

**Migration:** import RDF values and datasets from `@okikio/rdf`; choose syntax through its published subpaths. RDF statement quads are distinct from variable-bearing RDF/JS query patterns. RDFC-1.0 canonicalization targets its documented RDF 1.1 domain. A SHACL shape model does not evaluate a shapes graph, and the package does not perform RDFS or OWL entailment. The standards matrix identifies each pinned test profile and each unsupported capability.

### Cancel a pending inspection read and preserve canonical output

Shape and ontology inspection now forwards the caller's AbortSignal to source iteration. Cancellation can settle an inspection while the source's next read is pending, rather than waiting for another quad to arrive. A source that is never acquired stays unacquired; an acquired iterator is released through the documented cleanup contract.

Inspection limits now require positive safe integers. `NaN`, infinity, fractional values, and zero fail before source acquisition instead of disabling a supposed bound. The quad limit applies across all ontology sources. Shape-list and path limits remain separate, so applications can bound each form of expansion deliberately.

RDF/JS interoperability also treats an absent or null literal direction as the same nondirectional literal as an empty direction string. Equality and dataset keys now agree, so a valid legacy RDF/JS literal does not create a duplicate statement merely because its implementation predates directional strings.

N-Triples and N-Quads canonical writers escape `U+FFFE` and `U+FFFF` as Unicode escapes. These characters are outside the XML 1.1 character production used by the canonical serialization rules. Ordinary C1 characters and supplementary characters retain their allowed native representation. The official canonical fixtures are checked against exact expected output bytes, separately from parse/evaluation tests.

**Upgrade behavior:** invalid inspection bounds now throw a RangeError immediately. Supply an explicit positive integer bound, and await the inspection result when using cancellation. These are resource-policy and interoperability repairs; shape inspection remains a model-building operation, not SHACL data-graph validation.
