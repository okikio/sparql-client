# RDF and SPARQL repository guide

Read [`docs/architecture.md`](./docs/architecture.md) before architecture or public API changes.

## Runtime and dependency rules

- Production code targets Deno v2, strict TypeScript, ESM, explicit `.ts` source imports, and JavaScript-native TypeScript.
- The same source should remain usable from Node.js, Bun, browsers, and Workers where the capability applies.
- Importing a package or definition must not start network work, initialize Wasm, open files, configure logging, or acquire unrelated resources.
- Keep `@okikio/rdf` root lightweight. Optional processors and host-specific implementations belong behind explicit subpaths.
- Do not add a dependency only to save a small amount of code. A dependency must materially improve correctness, standards conformance, performance, maintenance, or interoperability.

## Naming

- Prefer one-word names when the package or module supplies enough context.
- Use concrete verbs such as `get`, `create`, `open`, `read`, `write`, `parse`, `inspect`, `select`, `close`, and `cancel`.
- Avoid vague `generate`, `execute`, `handle`, `process`, `manager`, `helper`, `common`, `shared`, and `misc` names unless an external protocol requires them.
- Project-owned runtime schemas end in `Schema`.
- Project-owned data types normally end in `Type`.
- Established RDF/SPARQL protocol nouns such as `Quad`, `Literal`, `Dataset`, and `Queryable` keep their established names.
- Generated vocabulary terms, types, and schemas use direct PascalCase imports when the vocabulary term is PascalCase: `Product`, `ProductType`, `ProductSchema`.
- Namespace imports are preferred for coherent operation families: `import * as rdf` and `import * as sparql`.

## Parsers

- Prefer semantic event streams over compulsory AST construction.
- Use data-oriented scanner state on measured hot paths.
- Do not allocate token/AST objects when the normal consumer only needs quads or semantic records.
- Preserve source ranges and diagnostics when tolerant or tooling-oriented parsing needs them.
- Cancellation must stop pending source reads and upstream parser work.
- Buffer enough semantic work to avoid leaking partial statements before a recoverable syntax error.
- Add a limit before accepting any parser path whose memory or work can grow with untrusted input.

## RDF semantics

- W3C RDF semantics are authoritative. RDF/JS is an interoperability target.
- Do not reinterpret RDFS domain/range as JSON requiredness.
- Preserve unsupported/unknown ontology or SHACL assertions instead of discarding them.
- Keep draft-sensitive RDF/SPARQL/SHACL behavior versioned and documented.
- Do not claim a standards feature until the relevant conformance corpus has passed.

## Lifecycles

- The caller owns injected resources unless an API explicitly transfers ownership.
- Use `AbortSignal` for cooperative cancellation.
- Use `Disposable` / `AsyncDisposable` for owned cleanup where appropriate.
- Returning early from an async iterable must release/cancel upstream work.
- A promise represents terminal authority; event streams are observational.

## Tests and benchmarks

- Co-locate tests as `*_test.ts` and benchmarks as `*_bench.ts`.
- Use `node:test` with `@std/expect` for expectations.
- Test success, failure, cancellation, early return, cleanup, limits, malformed inputs, hostile chunk splits, and recovery.
- Benchmark semantically equivalent work. State the oracle in the benchmark source.
- Construct deterministic fixtures outside timed callbacks.
- Separate cold start from warm throughput.
- Measure memory and compiler cost when those can change an architectural decision.
- Keep durable benchmark definitions in the owning package or `bench/`. Assistant-only raw benchmark captures must stay outside the repository; do not promote one run into a universal claim.
- A surprising benchmark result is a profiling lead. Identify the mechanism, change one thing, and rerun the same oracle.

## Documentation

- Document public APIs and important internal invariants with TSDoc.
- Comments explain why, ownership, limits, standards rules, and non-obvious invariants. Do not narrate obvious syntax.
- Examples must compile against the current public API.
- Distinguish implemented behavior, blocked validation, and proposals.
- Do not preserve obsolete APIs merely for compatibility before the first stable release.

## Validation

Canonical Deno gates:

```sh
deno task fmt --check
deno task lint
deno task check
deno task test
deno task bench
```

When Deno or JSR is unavailable, keep production code Deno-native. Temporary Node validation is assistant-only scratch state and must stay outside the committed repository. `.agents/` is ignored as an additional safeguard.
