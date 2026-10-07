# Run the validation lanes

Start with the source contracts before starting services or collecting timings:

```sh
deno task verify
```

This runs formatting, lint, strict types, the core dependency firewall, documentation diagnostics, and package/conformance-oracle unit tests. The [testing guide](docs/testing.md) explains what each suite protects. A successful source gate does not establish service interoperability, browser capability, or installed-package behavior.

## Choose the environment the change affects

| Command                                 | Protected contract and prerequisites                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno task conformance`                 | Download pinned official corpora and run supported native standards profiles. Fixture/setup failures and skipped cases fail the gate.                                   |
| `deno task support`                     | Validate claims, report schema/statuses, source identity and pinned revisions against fresh official evidence. Run conformance first.                                   |
| `deno task integration`                 | Real Oxigraph/Comunica and disposable HTTP engines, Graph Store operations, and transport faults. Requires Docker.                                                      |
| `deno task browser`                     | Actual Window/Worker parsing and cancellation in Chromium, Firefox, and WebKit. Requires installed Playwright browsers.                                                 |
| `OPFS_SOURCE=../opfs deno task browser` | Add browser OPFS persistence through the selected sibling checkout. Probe the API in its actual realm; report absent capabilities explicitly.                           |
| `deno task package`                     | Build all workspace npm archives and check JSR publication without publishing.                                                                                          |
| `deno task distribution`                | Check package/dependency and browser bundle contents. Requires built artifacts.                                                                                         |
| `deno task consumer`                    | Install the exact archives in a clean consumer and check public exports, declarations, RDF/query behavior, and HTTP encodings.                                          |
| `deno task consumer:linux`              | Run that installed consumer in the task's pinned Node, Deno, and Bun Linux images. Requires `consumer` output and Docker.                                               |
| `deno task integration:storage`         | Recovery, interruption, cancellation, and borrowed filesystem behavior with sibling OPFS source across memory, native files, and Deno KV.                               |
| `deno task consumer:storage`            | Install six workspace archives plus the selected OPFS archive; exercise persistence in host and Linux runtimes. Requires Docker and both repositories' built artifacts. |
| `deno task bench:report`                | Collect isolated, serial runtime benchmark samples with semantic preflight and source identities.                                                                       |
| `deno task bench:types`                 | Compile generated vocabulary consumers and record source size, compiler time, memory, and instantiations.                                                               |
| `deno task bench:storage`               | Measure fresh-process recovery through installed OPFS and triplestore artifacts. Prepare with `consumer:storage`.                                                       |

The storage tasks accept `OPFS_SOURCE` or `OPFS_TARBALL` where applicable. The default source is the sibling `../opfs`; the default archive is its `.release/npm/okikio-opfs-0.0.0-quality.tgz`. Missing inputs fail rather than silently substituting another implementation.

`deno task release-check` runs the source, standards, service, browser, artifact, borrowed-storage and benchmark gates in the order defined by `.mise/tasks/release-check.ts`. Supply the exact OPFS source and archive for that composition. The publishing workflow selects a reviewed OPFS revision and its exact public version.

## Read the result at the scope it proves

Standards support requires the pinned applicable cases to pass. An unavailable browser API is an unsupported case, not evidence of byte persistence. A container startup failure is infrastructure evidence, not a parser verdict. Native Windows, other architectures, and deployed cloud services require their own executions.

Benchmark numbers answer the questions in [the benchmark guide](docs/benchmarks.md). Review equivalent output, setup/cache state, retained samples, and run-to-run noise before using a timing to justify a change. Source tests passing does not validate a benchmark's workload.

Generated corpora, packages, consumer installations, screenshots, raw measurements, and one-off investigation reports belong under ignored `.tmp/`. Reports are local or CI artifacts and must record their source identity and environment. Keep reusable fixtures and task definitions visible in version control; preserve dated execution narratives locally rather than presenting them as current guarantees.
