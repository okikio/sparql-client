# Implementation boundaries

This guide describes the current package capabilities and their ownership. Execution evidence belongs to a report tied to exact source inputs, not to a permanent test-count snapshot. Start with the [standards matrix](./conformance.md#standards-and-capability-boundaries), the [architecture](./architecture.md), and the [validation runbook](../VALIDATION.md).

## Packages and imports

The six publishable packages separate RDF values, query construction, vocabulary compilation, persistence and external engine adapters:

```text
@okikio/rdf
    +--> @okikio/sparql
    |       +--> @okikio/oxigraph
    |       +--> @okikio/comunica
    +--> @okikio/vocab
    +--> @okikio/triplestore
```

RDF syntax and semantic processors use explicit subpaths: N-Triples, N-Quads, Turtle, TriG, RDF/XML, JSON-LD, RDFC, RDFa, Microdata, ontology inspection and shape inspection. The RDF root exports the semantic model without importing those processors. The four core packages have no third-party runtime implementation dependency. External implementations belong to named engine adapters or to independent test and benchmark oracles.

Importing a package does not acquire a filesystem, run a query, initialize an engine or start network work. The caller supplies engines and filesystems and retains their ownership. See the [lifecycle contracts](./architecture.md#cancellation-and-ownership-flow).

## RDF processing

The public RDF model preserves lexical/datatype/language/direction identity and supports RDF 1.2 triple terms in object positions. Dataset operations use RDF set semantics and exact-term indexes. They do not infer new statements or validate RDF datatype value spaces.

N-Triples, N-Quads, Turtle and TriG yield incremental semantic output. Markup processors first materialize bounded source/tree/result data. JSON-LD operations materialize document structures; accepting a stream does not make the operation a Streaming JSON-LD processor. [The RDF package guide](../packages/rdf/README.md#parser-lifecycle) documents source bounds, blank-node ownership and cancellation.

RDFC-1.0 handles its RDF 1.1 dataset model and rejects RDF 1.2 triple terms/directional literals. Its work bounds protect callers from expensive blank-node graphs. Syntax serializers produce valid RDF representations but do not assign canonical blank-node labels or sort a dataset into RDFC output.

Ontology and SHACL inspectors retain unsupported assertions. They do not reason over ontologies or validate data graphs. Their serializable models let later application processors act without losing the original input. The SHACL version option selects implemented interpretations, not certification against an entire draft family.

## SPARQL construction and execution

The builder distinguishes terms, expressions, graph patterns, complete queries and complete updates. Native RDF named nodes and generated vocabulary nodes compose directly. Query and update state are immutable; CONSTRUCT templates and WHERE patterns remain separate.

`@okikio/sparql/syntax` supplies source-ranged lexical and feature events. It is not a complete AST/algebra parser. Builders and raw fragments are not substitutes for an endpoint's query validator.

`Queryable` separates SELECT bindings, graph results, ASK Booleans and updates. HTTP clients implement concrete protocol modes and result formats. The engine adapters translate that contract to caller-owned Oxigraph/Comunica resources. Query evaluation, federation and entailment belong to those engines, not to the builder. See the [SPARQL mapping](./sparql-mapping.md) and [standards matrix](./conformance.md#standards-and-capability-boundaries) for the implemented subset.

## Vocabularies and validation

The reusable compiler consumes quad sources through ontology inspection. Syntax selection and local file writes belong to repository tasks. Naming and emission are deterministic; generated child validators compose parent descriptors instead of copying every inherited range.

Generated terms remain ordinary RDF named nodes. Generated types and schemas describe open-world JSON-LD-shaped values through Standard Typed, Standard Schema and Standard JSON Schema v1. Range validation uses a documented structural subset; ontology domain/range does not turn into required properties or cardinality. These validators do not replace JSON-LD expansion or SHACL validation. See [Standard Schema](./standard-schema.md) and [vocabulary generation](./vocabulary-generation.md).

Publication of a generated vocabulary needs its authoritative source identity and regeneration check. A bootstrap module must not be advertised as the complete upstream vocabulary.

## Persistent datasets

The persistent store borrows a structural filesystem and publishes immutable segments plus generation records. Reopen chooses the newest fully valid committed generation; incomplete records are ignored, while corruption cannot silently create an empty database. Reopen rebuilds in-memory indexes.

The current path is one-writer-per-path. It does not provide cross-process writer coordination, physical garbage collection, transactions across multiple stores or a SPARQL evaluator. Bounded import batches can commit before a later source failure; applications must account for that documented durability boundary. See the [triplestore guide](../packages/triplestore/README.md).

## Evidence and publication

Permanent tests and properties live with the owning capability. Pinned upstream corpora exercise the named profiles in `support.json`; the current report must match implementation/configuration identities and checked suite content. Neither a test count nor an independent implementation's acceptance proves standards coverage outside those profiles.

Repository tasks also test real HTTP engines, browser Window/Worker behavior, current-source filesystem integration, packed public exports and clean consumers. Benchmark programs state and check their semantic oracles separately from timing. [Testing](./testing.md), [conformance](./conformance.md) and [benchmarks](./benchmarks.md) describe those contracts.

Before publishing, run the [release gates](../VALIDATION.md), review the exact npm/JSR file lists and installed exports, and include the package license notice and required generated-source attribution. Runtime capability exceptions and draft/profile limitations remain part of the public contract. A successful local dry run creates reviewable artifacts; it does not publish them or establish that every future host, server or draft is supported.
