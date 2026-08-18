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

`.mise/tasks/vocab.ts` selects the parser from the input extension, opens files, invokes `compile()`, and writes the source and manifest. It is deliberately a thin executable wrapper around the library API. Its direct file formats are Turtle, TriG, N-Triples, and N-Quads. Other RDF formats use their `@okikio/rdf/*` parser first and call `compile()` with the resulting quad source.

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

`.mise/tasks/schema.ts` downloads the authoritative Schema.org 30.0 N-Quads release, verifies the expected source identity before generation, then emits the module and provenance manifest.

The execution host used for this implementation could not retrieve that full release. Complete Schema.org generation remains a release gate.

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
