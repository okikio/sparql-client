# Conformance and interoperability

This repository separates package-owned behavior tests from standards evidence. A public standards profile is release-supported only when `support.json` names an official evidence profile and a valid, current report contains passing cases with zero failures and zero skips. Status counts alone do not establish that evidence.

## Standards and capability boundaries

Use this table to choose a capability before interpreting a passing report. **Profile** means the complete pinned manifest is exercised by the official runner; it does not mean every document in that standards family is implemented. **Subset** means a concrete library contract with unit/property/interoperability evidence. **Absent** means the package does not perform that operation.

| Standard or capability                     | Public surface                                     | Implemented scope and evidence                                                                                                                               | Boundary                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RDF 1.2 N-Triples                          | `@okikio/rdf/ntriples`                             | **Profile:** positive/negative syntax plus exact canonical-output vectors, including version announcements, triple terms and directional strings             | Reader and canonical line-output vectors in `support.json`; writer accepts only the default graph.                                                                                                                                                     |
| RDF 1.2 N-Quads                            | `@okikio/rdf/nquads`                               | **Profile:** positive/negative syntax plus exact canonical-output vectors, including RDF 1.2 terms and graph names                                           | Supplied blank labels are retained; callers merging independent documents must provide separate label spaces.                                                                                                                                          |
| RDF 1.2 Turtle                             | `@okikio/rdf/turtle`                               | **Profile:** recursively included syntax/evaluation manifests; bounded incremental semantic output                                                           | Writer uses explicit IRIs rather than prefix or list compaction; named graphs are rejected.                                                                                                                                                            |
| RDF 1.2 TriG                               | `@okikio/rdf/trig`                                 | **Profile:** recursively included syntax/dataset-evaluation manifests; bounded incremental semantic output                                                   | Writer uses separate graph blocks and materializes its returned string.                                                                                                                                                                                |
| RDF/XML 1.1/1.2                            | `@okikio/rdf/xml`                                  | **Profile:** pinned RDF 1.2 manifest and its included older cases; namespace/base/language, collections, XML literals and RDF 1.2 reification/triple terms   | Reader only. Complete bounded markup tree/result materialization; default version is 1.1 unless declared or configured. No external DTD/entity retrieval.                                                                                              |
| RDF syntax writers                         | N-Triples/N-Quads `write`; Turtle/TriG `serialize` | **Subset:** valid explicit-term output, escaping, graph-position rejection and semantic round trips                                                          | N-Triples/N-Quads profiles also compare pinned canonical-output bytes. Turtle/TriG writers use round-trip/property evidence. Input iteration order is retained; line layout alone does not canonicalize a dataset.                                     |
| JSON-LD 1.1 API and Framing                | `@okikio/rdf/jsonld`                               | **Profiles:** expansion, compaction, flattening, to-RDF, from-RDF and framing, including manifest options and loader metadata                                | Batch materialization. Generalized blank predicates require `produceGeneralizedRdf` and a compatible consumer; ordinary RDF datasets/writers reject that wider model.                                                                                  |
| RDFC-1.0                                   | `@okikio/rdf/canon`                                | **Profile:** canonical N-Quads, canonical identifier maps, requested digest algorithms and bounded-work poison vector                                        | RDF 1.1 dataset algorithm: rejects RDF 1.2 triple terms and directional literals. Defaults bound materialized quads and N-degree work; valid costly inputs can require deliberate larger bounds. It does not sign or verify credentials.               |
| RDFa 1.1                                   | `@okikio/rdf/rdfa`                                 | **Profiles:** HTML5, XHTML5, XML and SVG hosts; expected assertions run in an independent SPARQL engine                                                      | Extraction from a bounded markup tree, not a browser DOM or a universal HTML/XML processor. Host selection is explicit.                                                                                                                                |
| Microdata to RDF                           | `@okikio/rdf/microdata`                            | **Profile:** pinned conversion vectors, independently parsed expected Turtle and dataset isomorphism                                                         | This conversion specification is experimental; passing its corpus does not establish a W3C Recommendation or complete HTML browser behavior.                                                                                                           |
| RDF 1.2 term and dataset model             | `@okikio/rdf`                                      | **Subset:** named/blank nodes, literals with direction, object-position triple terms, default/named graphs, term equality and indexed set membership         | No datatype value-space evaluation, RDF entailment, RDFS inference or OWL reasoning. Factory terms do not serve as complete IRI/language validators.                                                                                                   |
| RDF/JS interoperability                    | `@okikio/rdf` factories/conversion and `Dataset`   | **Subset:** structural term interchange and DatasetCore-style `size/add/delete/has/match/iteration`, including legacy literals without direction             | Statement positions are narrower than RDF/JS query-pattern quads: variables are separate terms, not legal stored subject/predicate/object/graph positions. No full RDF/JS DataFactory/Dataset specification certification.                             |
| SPARQL Query/Update construction           | `@okikio/sparql`                                   | **Subset:** SELECT/ASK/CONSTRUCT/DESCRIBE, patterns, expressions, paths and Update builders; independent parser/property checks                              | Builders do not evaluate queries or validate the entire grammar. Raw fragments and caller prefix declarations remain the caller's responsibility. RDF 1.2 triple-term construction is a draft-sensitive feature.                                       |
| SPARQL lexical inspection                  | `@okikio/sparql/syntax`                            | **Subset:** source-ranged tokens, diagnostics and version/feature events                                                                                     | Not a complete grammar parser, algebra compiler, formatter or proof that a query is executable.                                                                                                                                                        |
| SPARQL Results JSON                        | `@okikio/sparql` decoding; `@okikio/sparql/http`   | **Subset:** SELECT bindings and ASK Booleans with RDF term identity, response-scoped blanks, directional literals and nested triple terms                    | JSON only: CSV/TSV/XML decoders are absent. No official complete SPARQL results corpus profile is claimed; endpoints decide which draft features they support.                                                                                         |
| SPARQL HTTP Protocol                       | `@okikio/sparql/http`                              | **Subset:** GET/form POST/direct POST queries, form/direct updates, query/update dataset parameters, headers, deadlines, byte bounds and normalized failures | Client only, with tested server interoperability. No automatic mutation retry, authentication exchange, server, federation planner or SPARQL evaluator. JSON bindings are fully materialized before iteration; graph results use selected RDF readers. |
| SPARQL Graph Store HTTP Protocol           | `@okikio/sparql/graph-store`                       | **Subset:** GET/PUT/POST/DELETE for explicitly selected default/named graphs; N-Triples transfer and response bounds                                         | No HEAD/PATCH, direct graph-resource addressing, unnamed POST graph creation or server implementation. Protocol subset evidence is separate from official RDF reader profiles.                                                                         |
| RDFS/OWL ontology interpretation           | `@okikio/rdf/ontology`                             | **Subset:** named declarations/relationships, diagnostics and retained unsupported assertions                                                                | Interpretation only; no entailment, consistency checking or complete OWL expression evaluation. Domain/range do not imply JSON requiredness.                                                                                                           |
| SHACL Core shape inspection                | `@okikio/rdf/shape`                                | **Subset:** versioned `1.0`/`1.2` IR, targets, constraints, metadata, Core path constructors, RDF lists and retained unknown/malformed assertions            | **Absent:** data-graph validation, conformance reports, SHACL-SPARQL execution, Rules and Node Expressions evaluation. `1.2` selects implemented draft terms, not every latest draft feature.                                                          |
| Standard Typed/Schema/JSON Schema v1       | `@okikio/vocab/standard` and generated schemas     | **Subset:** upstream structural compatibility, runtime validation and `draft-07`/`draft-2020-12` conversion                                                  | Open-world structural range model, not full RDF datatype/OWL/SHACL validation. Other JSON Schema targets fail explicitly. Generated schemas do not run the JSON-LD expansion algorithm.                                                                |
| Engine evaluation                          | `@okikio/oxigraph`, `@okikio/comunica`             | **Subset:** adapters to caller-owned engines with separate binding/graph/Boolean/update modes                                                                | Evaluation and supported language/entailment features belong to the selected engine/version. Oxigraph synchronous calls cannot be interrupted; Comunica cancellation depends on upstream operation/context.                                            |
| Streaming JSON-LD, ShEx, YAML-LD, RDF/JSON | none                                               | **Absent**                                                                                                                                                   | No conformance or processing claim.                                                                                                                                                                                                                    |

RDF 1.2, SPARQL 1.2 and SHACL 1.2 evolve independently. For example, the checked publications of [N-Triples 1.2 (24 September 2026)](https://www.w3.org/TR/2026/WD-rdf12-n-triples-20260924/), [SPARQL Query 1.2 (4 October 2026)](https://www.w3.org/TR/2026/WD-sparql12-query-20261004/) and [SHACL Core 1.2 (18 September 2026)](https://www.w3.org/TR/2026/WD-shacl12-core-20260918/) are Working Drafts. The pinned suite commits below identify the actual exercised profiles. They do not promise compatibility with every subsequent draft. [RDFC-1.0](https://www.w3.org/TR/2024/REC-rdf-canon-20240521/) is a separate Recommendation with a narrower input model. [Microdata to RDF](https://www.w3.org/TR/microdata-rdf/) describes experimental conversion rules.

The [RDF/JS data model](https://rdf.js.org/data-model-spec/) and [Dataset specification](https://rdf.js.org/dataset-spec/) define the interoperability interfaces. The native factory deliberately uses RDF statement positions; applications requiring RDF/JS variable-bearing query-pattern quads need an appropriate external factory.

## Evidence flow

```text
package unit tests
    ↓
fast-check properties
    ↓
pinned official suite
    ↓
real upstream processor / engine
    ↓
Testcontainers protocol interoperability
    ↓
support.json evidence check
    ↓
release-check
```

`deno task conformance:sync` checks out external suites into `.tmp/conformance/`. The external corpora are not copied into package source. `deno task conformance` writes `.tmp/reports/conformance.json`. `deno task support` checks that report against `support.json`.

The pinned sources are defined in `conformance/source.ts`. Each pin is an immutable commit. Updating a pin is a source change that requires a new report.

The schema-v2 report records the content identity of the production implementation, conformance runners and oracles, support claims, and pinned configuration. `support` rejects malformed records, unknown statuses, inconsistent totals, duplicate case identities, missing profiles, mismatched suite revisions, and evidence from different source inputs. Test and benchmark edits do not change this conformance identity.

Synchronization checks each cached checkout's actual Git HEAD and working tree; the owned `.revision` marker alone is insufficient. The runner checks those checkouts before and after its cases, and checks its implementation inputs again before writing the report. A modified cache fails with preservation guidance rather than silently replacing fixture edits. Restore or deliberately resync the cache, then rerun conformance after changing implementation or evidence inputs.

| Suite                            | Revision                                   |
| -------------------------------- | ------------------------------------------ |
| W3C RDF tests                    | `12774b0ebb385d17651b396654b19254d0fefbfa` |
| W3C JSON-LD API                  | `ffdb326121ea89b7b8280e76a5caea923834bcef` |
| W3C JSON-LD Framing              | `3bf782ba9a40dd1b143435abe386d38df64f2b47` |
| W3C RDF Dataset Canonicalization | `15619df2fda7a4ca88308733789b6774517f9638` |
| RDFa processor suite             | `eee51f068df8c650413512d63848e2730b56320b` |
| W3C Microdata to RDF             | `f4162846153dea1351194e338caff086830a7d00` |

## Profiles exercised

The executable runner covers N-Triples 1.2, N-Quads 1.2, Turtle 1.2, TriG 1.2, RDF/XML 1.2, RDFC-1.0, JSON-LD 1.1 expansion/compaction/flattening/to-RDF/from-RDF/framing, RDFa 1.1 host-language processing, and Microdata-to-RDF.

The RDF syntax runner follows each W3C manifest's recursive `mf:include` graph. It dispatches declared positive syntax, negative syntax, evaluation and canonical-output kinds explicitly; unknown kinds fail. Canonical N-Triples/N-Quads vectors compare the public writer's exact bytes against the expected fixture, rather than treating parse acceptance or graph equality as sufficient. It resolves fixture files from the pinned checkout but passes the suite's logical web IRI to the parser as the base IRI. This keeps relative-IRI semantics independent of the checkout path.

Dataset comparisons are graph-isomorphism comparisons. Blank-node labels are not compared lexically. The oracle uses structural refinement and constrained backtracking rather than a small-blank-node shortcut.

JSON-LD comparison follows the test-suite comparison model: arrays are unordered unless the operation requests ordering, `@list` remains ordered, language tags are case-insensitive, and blank-node identifiers are compared through a bijection. Remote-document cases are served by an operation-local loader that reproduces suite redirects, content types, and Link headers without contacting arbitrary hosts.

JSON literals retain their array order, property names, string spelling, and case. Context arrays also retain order. Generalized JSON-LD RDF fixtures use a localized reader and a statement-reification isomorphism oracle that includes blank predicate identities in the same bijection as subjects, objects, and graphs. The standard N-Quads parser still rejects blank predicates.

RDFa assertions are evaluated by an independent Oxigraph SPARQL engine. Microdata expected Turtle is parsed independently and compared as an RDF dataset.

## Interoperability

`deno task integration` owns external service lifecycle through Testcontainers. It exercises:

- Oxigraph 0.5.9 HTTP query, update, and Graph Store endpoints;
- Apache Jena Fuseki 6.1.0 query, update, and Graph Store endpoints;
- RDF4J 5.3.2 with an ephemeral in-memory repository;
- Blazegraph 2.1.5 from its checksum-verified official Maven executable artifact;
- QLever commit `45b05e1` with a real index built in an isolated image;
- OpenLink Virtuoso `7.2.17-r25.1-g2850f18-alpine` with disposable named-graph update permissions;
- Toxiproxy network failure normalization;
- the in-process Oxigraph adapter against a real `Store`;
- the in-process Comunica adapter against a real RDF/JS query engine.

The mutable services run ASK, SELECT, and CONSTRUCT through GET, form POST, and direct POST, after both form and direct updates. QLever exercises the query modes against its prebuilt immutable fixture. Virtuoso explicitly addresses a named graph because its update endpoint requires that graph selection. Oxigraph and Fuseki also run Graph Store replacement, append, read, and deletion for both named and default graphs. Engine-specific service routes and graph policies remain visible in the tests.

`integration/protocol_test.ts` uses a real local HTTP socket to inspect Unicode payloads, dataset parameters, authentication headers, failed mutation request counts, malformed results, bounded graph downloads and error previews, stalled-body cancellation, and thirteen HTTP failure statuses. The generic integration task selects its engine and protocol files explicitly. Browser and optional sibling-storage lanes have separate tasks.

`deno task consumer` installs the emitted npm archives into a fresh directory, type-checks their declarations, imports all public entry points, and runs RDF, vocabulary, canonicalization, JSON-LD, query-building, and HTTP behavior in Node, Deno, and Bun. `deno task consumer:linux` repeats the behavior in isolated Node 22.18, Node 24, Bun 1.3.14, and Deno 2.9 Linux containers. `deno task browser` exercises the public RDF/SPARQL graph in Chromium, Firefox, and WebKit Window and Worker contexts.

The [official Blazegraph distribution notes](https://github.com/blazegraph/database/wiki/MavenNotes), [QLever binaries](https://github.com/ad-freiburg/qlever), and [OpenLink container documentation](https://hub.docker.com/r/openlink/virtuoso-opensource-7) explain their service setup. Each test owns fresh container state and removes its services in `finally`; it attaches no existing database volume.

Injected fake processors remain useful for unit tests, but they are not counted as conformance or interoperability evidence.

## Explicit non-claims

`support.json` is intentionally narrower than the semantic-web ecosystem. The current repository does not claim Streaming JSON-LD conformance, SHACL validation, SHACL Rules or Node Expressions execution, ShEx validation, YAML-LD, RDF/JSON, OWL reasoning, or an in-package SPARQL evaluator. `@okikio/rdf/shape` and `@okikio/rdf/ontology` are loss-preserving interpretation models, not validators/reasoners. `@okikio/sparql/syntax` is source-ranged lexical/feature inspection, not a complete SPARQL AST parser.
