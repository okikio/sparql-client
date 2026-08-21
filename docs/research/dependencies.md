# Dependency and differential-oracle register

Research date: 2026-08-18.

This register records how the repository uses important upstream implementations during correctness work. It is intentionally narrower than a dependency inventory. A library belongs here when its behavior is used as a differential baseline, interoperability target, or source of adversarial regression cases.

## Authority

Use evidence in this order:

1. current W3C specifications and official test suites;
2. project-owned unit, property, integration, and conformance tests;
3. current upstream source and upstream test suites;
4. differential agreement with independent implementations;
5. tutorial and secondary documentation.

A comparator bug must never become project behavior only because a differential test matched it. Known upstream defects should instead become named regression fixtures where the same input is relevant to this repository.

## SPARQL parsers

### Traqula

Repository: `comunica/traqula`.

Role: primary independent parser for SPARQL builder property tests.

The current Traqula monorepo provides parser and generator engines for SPARQL 1.1 and SPARQL 1.2. The `@traqula/parser-sparql-1-2` package also runs the W3C SPARQL 1.0, 1.1, and 1.2 parser suites in its own package scripts.

Traqula is not specification authority. Its current issue history includes parser/validation gaps and extension questions, including issue #86 and version-validation issue #90. Those are reasons to keep official W3C suites above differential agreement.

### SPARQL.js

Repository: `RubenVerborgh/SPARQL.js`.

Role: historical regression comparator only when it supplies unique coverage.

The repository is archived. Direct project oracle usage is removed in favor of Traqula 1.2. A transitive dependency may still include SPARQL.js; that does not make it a project correctness authority.

### sparql.dev

Role: tutorial and developer-experience reference.

The site is useful for examples and SPARQL ergonomics. It is not a parser implementation or conformance suite. Grammar and protocol decisions remain grounded in W3C SPARQL specifications and tests.

## RDF syntax and datasets

### N3.js

Repository: `rdfjs/N3.js`.

Role: active RDF differential parser/writer baseline and benchmark competitor.

Current open RDF 1.2 issues include annotation continuation/nesting defects (#677 and #678) and named-graph placement for annotation reification (#673). Differential tests around RDF 1.2 annotations must therefore compare semantic results to the specification, not blindly copy N3 output.

### rdfxml-streaming-parser.js

Repository: `rdfjs/rdfxml-streaming-parser.js`.

Role: streaming RDF/XML comparator.

The issue history contains correctness and lifecycle cases that are useful adversarial inputs, including blank-node identity (#19), invalid/relative IRI handling (#45 and related reports), CDATA/entity handling (#52/#39), parser size limits (#43), and stream backpressure (#44). These issues make the W3C RDF/XML suite the authority for native parser behavior.

## JSON-LD and canonicalization

### jsonld.js

Repository: `digitalbazaar/jsonld.js`.

Role: mature JSON-LD behavior comparator and source of adversarial fixtures.

The project remains active. A current report (#584) describes prototype pollution in `flatten()` when attacker-controlled node identifiers such as `__proto__` enter dynamic object maps. Project-owned JSON-LD dictionaries therefore use prototype-free objects where keys come from documents, and regression tests must protect that invariant.

### rdf-canonize

Repository: `digitalbazaar/rdf-canonize`.

Role: canonicalization comparator.

No current issue matching this repository's control-character escaping defect was found during the 2026-08-18 issue review. That absence is not proof of correctness. RDFC-1.0 official tests remain the release authority, including canonical N-Quads escaping and identifier-map cases.

## HTML semantic extraction

### rdfa-streaming-parser.js

Repository: `rubensworks/rdfa-streaming-parser.js`.

Role: RDFa differential comparator.

Current issues include descendant-text behavior (#58) and `rdf:HTML` descendant markup preservation questions (#63/#67). These are valuable fixtures for native RDFa extraction, but official RDFa processor tests remain authoritative.

### microdata-rdf-streaming-parser.js

Repository: `rubensworks/microdata-rdf-streaming-parser.js`.

Role: Microdata-to-RDF differential comparator.

No active issue matching the searched conformance, `itemref`, base-IRI, registry, or HTML areas was found during this review. The W3C Microdata-to-RDF manifest remains the primary correctness source.

## Query engines

### Comunica

Repository: `comunica/comunica`.

Role: real RDF/JS and federated-query interoperability engine through `@okikio/comunica`.

Comunica is not the parser oracle for project-owned SPARQL construction. Its purpose here is engine interoperability and realistic query execution over RDF/JS sources.

Its current issue tracker also shows why engine agreement is evidence rather than authority. Issue #721 tracks still-unfinished coverage of the complete SPARQL specification tests, while #1736 separately tracks SPARQL 1.0 test execution. Correctness issues include unsafe `GRAPH` rewriting exposed by W3C cases (#1643) and an empty `GRAPH ?g { }` query that returns no graph bindings (#1679). Lifecycle issue #1198 records an unconsumed cached quad stream. These cases are candidates for interoperability regressions when they overlap this repository's supported surface.

### Oxigraph

Repository: `oxigraph/oxigraph`.

Role: in-process and HTTP SPARQL interoperability engine through `@okikio/oxigraph`, and independent ASK evaluator for RDFa conformance assertions.

Oxigraph agreement is useful execution evidence, not a substitute for SPARQL or RDF conformance suites. Current RDF/SPARQL 1.2 issue history includes annotation syntax that produces no query results (#1493) and severe nested/meta-triple query slowdown (#1687). JSON-LD coverage is also explicitly incomplete in open work such as JSON-LD 1.1 support (#1274) and compaction/remote-context support (#1543). Use those cases to qualify differential expectations rather than to weaken the project specification target.

## Regression policy

When an upstream issue applies to a project-owned capability:

```text
upstream issue or differential mismatch
            |
            v
reproduce with a minimal fixture
            |
            v
check current specification/test-suite rule
            |
      +-----+-----+
      |           |
      v           v
project bug   comparator bug
      |           |
      v           v
fix + test    adversarial test
      |           |
      +-----+-----+
            |
            v
keep W3C suite as release authority
```

Do not turn this register into a frozen allowlist. Re-review the upstream repositories when a comparator version changes or when a differential result becomes release-significant.
