# Vocabulary generation

`@okikio/vocab` replaces the old `scripts/ttl-to-ts.ts` generator with a reusable, format-neutral compiler.

The old design mixed four responsibilities in one script:

```text
Turtle/N-Triples parsing
      +
ontology interpretation
      +
TypeScript naming/emission
      +
filesystem CLI behavior
```

The replacement separates those responsibilities so a vocabulary can come from Turtle, TriG, N-Quads, JSON-LD, RDF/XML, a triplestore, or another RDF source without changing the compiler.

## Compiler pipeline

```text
serialized RDF / dataset / store
             |
             v
       RDF format parser
             |
             v
       RDF quad sources
             |
             v
 @okikio/rdf/ontology
             |
             v
   @okikio/vocab.inspect()
             |
             v
 naming + collision planning
             |
             v
   @okikio/vocab.emit()
             |
             v
 TypeScript + manifest
```

`@okikio/vocab.compile()` is the normal library entry point for the middle of that pipeline:

```ts
import * as turtle from '@okikio/rdf/turtle'
import { compile } from '@okikio/vocab/compile'

const source = `
  @prefix ex: <https://example.com/> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

  ex:Product a rdfs:Class .
  ex:name a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ;
    rdfs:domain ex:Product .
`

const result = await compile([
  {
    id: 'example',
    quads: turtle.parse(source),
  },
], {
  vocabulary: 'example',
  namespace: 'https://example.com/',
  prefix: 'ex',
})

console.log(result.source)
console.log(result.manifest)
```

The parser remains outside `compile()`. `compile()` accepts ontology sources that expose RDF quads.

## Why parsing is outside the compiler

The old filename `ttl-to-ts` encoded Turtle as if Turtle were the ontology model. It is not. Turtle is one serialization of RDF.

Separating the parser gives the compiler one stable input contract:

```text
Iterable<Quad>
AsyncIterable<Quad>
```

That lets the same compiler consume:

- `@okikio/rdf/turtle`
- `@okikio/rdf/trig`
- `@okikio/rdf/ntriples`
- `@okikio/rdf/nquads`
- `@okikio/rdf/jsonld`
- `@okikio/rdf/xml`
- an in-memory `Dataset`
- `@okikio/triplestore`
- future RDF parsers or databases

A format-specific parser can evolve without changing ontology interpretation or generated symbol policy.

## Library API versus repository task

The library owns compilation:

```ts
import { compile } from '@okikio/vocab'
```

The repository task owns file I/O:

```sh
deno task vocab --input ontology.ttl --out generated --name example --namespace https://example.com/ --prefix ex
```

`.mise/tasks/vocab.ts` selects the parser from the input extension, reads the input files, invokes `compile()`, and writes `mod.ts` and `manifest.json` under `--out`. Repeat `--input` to combine sources; `--format` explicitly selects Turtle, TriG, N-Triples or N-Quads when the extension does not identify one. Other RDF formats use their public parser first and call `compile()` with the resulting quad source.

The task materializes file text and generated output. It has no `--check` or dry-run mode: `--out` is a write target, and existing output files are replaced. Use an isolated output directory to review generated changes before updating a shipped vocabulary. Library callers can inspect `result.source` and `result.manifest` without writing files.

Do not move ontology interpretation or emission rules back into `.mise/tasks/`.

## Generated public surface

Generated vocabularies use direct imports:

```ts
import {
  name,
  offers,
  Product,
  type ProductPropertiesType,
  ProductSchema,
  type ProductType,
} from '@okikio/vocab/schema'
```

The main generated shapes are:

```text
Product                 RDF NamedNode value
ProductPropertiesType   generated property interface
ProductType             open-world JSON-LD node type
ProductSchema           Standard Schema + Standard JSON Schema value
name                    RDF NamedNode property value
```

This keeps common call sites short and tree-shakeable. Consumers do not need a giant runtime vocabulary namespace.

## Ontology ownership

Generic ontology semantics belong to `@okikio/rdf/ontology`, not to the code generator.

`@okikio/rdf/ontology` owns concepts such as:

- classes
- properties
- datatypes
- `rdfs:subClassOf`
- `rdfs:subPropertyOf`
- `rdfs:domain`
- `rdfs:range`
- directly represented OWL class/property characteristics
- retained assertions that are not normalized yet

`@okikio/vocab` adds compiler policy:

- source symbol candidates
- deterministic collision resolution
- TypeScript naming
- Schema.org `domainIncludes` and `rangeIncludes` aliases
- generated runtime range projection
- source emission
- manifest emission

Schema.org aliases are therefore not hard-coded into the generic RDF ontology package.

## Loss preservation

The ontology model retains assertions that the current compiler does not interpret. A future compiler can understand more OWL or vocabulary-specific structures without requiring the original RDF input to be re-parsed through an older lossy model.

Generated output should also include source provenance through the manifest. A generated file is derived data and should remain traceable to its source vocabulary and generator version.

## Deterministic naming

Naming is a separate compiler pass. The IRI remains authoritative; the TypeScript symbol is derived.

When several IRIs compete for the same TypeScript symbol, collision resolution must be deterministic and independent of input ordering. This is tested because ontology file order is not a stable naming policy.

## Schema.org generation

The checked-in `@okikio/vocab/schema` module is currently a bootstrap surface used to exercise the API. It is **not** a claim that the complete Schema.org vocabulary is already checked in.

The repository provides a pinned regeneration task:

```sh
deno task vocab:schema
```

`.mise/tasks/schema.ts` selects Schema.org 30.0 from immutable upstream commit `420231f6bfac8372fc564abb121fae57ccb36a0c`. It verifies the N-Quads source's byte length and Git blob SHA, records its SHA-256 in the generated manifest, then emits `mod.ts` and `manifest.json`. Schema.org HTTP/HTTPS domain/range aliases are compiler inspection policy; the generated range model remains the structural subset described in [Standard Schema](./standard-schema.md#range-validation).

Running the command above replaces the shipped `packages/vocab/schema` files. The task has no check-only mode. First produce reviewable output separately:

```sh
deno task vocab:schema --out .tmp/schema-release
deno check .tmp/schema-release/mod.ts
```

Then inspect the source identity, diagnostics, symbols and declarations; compare or deliberately replace the shipped output, run the vocabulary tests and clean installed-package consumers, and retain the generation evidence. A task definition or a generated module that merely type-checks does not establish complete upstream vocabulary coverage.

The compiler models classes, properties and referenced datatypes. It does not emit every named ontology instance as a term. Schema.org enumeration instances such as `Monday` and `ActiveActionStatus` therefore need a separate supported emission policy before advertising complete term coverage. In the pinned ontology, `Text` and `Boolean` are modeled as classes; replacing the bootstrap output changes their generated types and schemas rather than simply adding exports. An IRI with both class and property roles receives distinct TypeScript bindings so neither declaration is dropped.

### Schema.org provenance

The present shipped manifest explicitly identifies a bootstrap slice rather than Schema.org 30.0. Its source is the repository fixture [`fixtures/vocab/schema-bootstrap.json`](../fixtures/vocab/schema-bootstrap.json): four classes, six properties and four datatype aliases, with bootstrap descriptions and structural range definitions. It has no upstream release hash and must not be represented as a verbatim Schema.org release or complete source-term generator output. The fixture and generated module were introduced together in repository commit `1842332f82f2bcdfbc21400be1ae52d51d85e0fc`.

The [Schema.org terms](https://schema.org/docs/terms.html) license upstream schemas under CC BY-SA 3.0. A regenerated module that includes upstream descriptions needs its source identity and applicable attribution/license notices; this repository's MIT license does not replace those upstream terms. Do not ascribe the temporary pinned full-ontology generation's identity to the shipped bootstrap fixture.

Publication that advertises the complete Schema.org release requires actual regeneration, term-role and instance coverage review, and validation of that shipped source. A limited preview can instead describe its bootstrap exports explicitly. Complete source-term generation would still not add OWL reasoning, SHACL validation or full RDF datatype validation to the generated schemas.

## Standard Schema generation

Each generated class schema uses the dependency-free runtime in `@okikio/vocab/runtime`. See [`standard-schema.md`](./standard-schema.md) for validation semantics and why ontology domain/range metadata is not treated as closed JSON requiredness.

## Compiler benchmarks

The compiler has two different performance questions and therefore two benchmark styles.

Package-local runtime benchmark:

```text
packages/vocab/compile_bench.ts
```

It measures a deterministic ontology `inspect -> name plan -> emit` workload.

Cross-process TypeScript benchmark:

```text
bench/vocab/types.ts
```

It measures generated source size and compiler behavior in isolated processes. TypeScript startup, memory, symbol counts, type counts, and type instantiations are not meaningful as an in-process Mitata kernel.

The benchmark suite previously found an O(n^2) generated-source defect in deep inheritance. Parent schema composition replaced inherited-property duplication and materially reduced generated bytes, generation time, and compiler time.
