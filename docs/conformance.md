# Conformance and interoperability

This repository separates package-owned behavior tests from standards evidence. A public standards profile is release-supported only when `support.json` names an official evidence profile and the pinned conformance report contains at least one passing case with zero failures and zero skips for that profile.

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

The RDF syntax runner follows each W3C manifest's recursive `mf:include` graph. It resolves fixture files from the pinned checkout but passes the suite's logical web IRI to the parser as the base IRI. This keeps relative-IRI semantics independent of the checkout path.

Dataset comparisons are graph-isomorphism comparisons. Blank-node labels are not compared lexically. The oracle uses structural refinement and constrained backtracking rather than a small-blank-node shortcut.

JSON-LD comparison follows the test-suite comparison model: arrays are unordered unless the operation requests ordering, `@list` remains ordered, language tags are case-insensitive, and blank-node identifiers are compared through a bijection. Remote-document cases are served by an operation-local loader that reproduces suite redirects, content types, and Link headers without contacting arbitrary hosts.

RDFa assertions are evaluated by an independent Oxigraph SPARQL engine. Microdata expected Turtle is parsed independently and compared as an RDF dataset.

## Interoperability

`deno task integration` owns external service lifecycle through Testcontainers. It exercises:

- Oxigraph 0.5.9 HTTP query, update, and Graph Store endpoints;
- Apache Jena Fuseki 6.1.0 query, update, and Graph Store endpoints;
- RDF4J 5.3.2 with an ephemeral in-memory repository;
- Toxiproxy network failure normalization;
- the in-process Oxigraph adapter against a real `Store`;
- the in-process Comunica adapter against a real RDF/JS query engine.

Injected fake processors remain useful for unit tests, but they are not counted as conformance or interoperability evidence.

## Explicit non-claims

`support.json` is intentionally narrower than the semantic-web ecosystem. The current repository does not claim Streaming JSON-LD conformance, SHACL validation, SHACL Rules or Node Expressions execution, ShEx validation, YAML-LD, RDF/JSON, OWL reasoning, or an in-package SPARQL evaluator. `@okikio/rdf/shape` and `@okikio/rdf/ontology` are loss-preserving interpretation models, not validators/reasoners. `@okikio/sparql/syntax` is source-ranged lexical/feature inspection, not a complete SPARQL AST parser.
