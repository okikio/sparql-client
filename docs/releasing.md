# Publish a tested package release

Deno owns repository commands. Bumpy 1.18.1 owns authored bump files, dependency propagation, version selection, and changelog rendering. Mise can install the declared runtimes; running package tests or preparing a release does not require Mise.

```sh
deno task release:plan
deno task release:version
deno task release:prepare
deno task release:registry both
deno task release:publish both
```

Run `release:plan` before `release:version`. The plan identifies every affected package, its current and next version, and dependency propagation. Versioning consumes bump files, writes each package changelog, and synchronizes npm and Deno versions. It does not commit, tag, push, or publish. The original authored stories and full Bumpy plan are retained under ignored `.tmp/releases/version-plan.json`.

Review and commit the versioned source before publication. Readiness checks can run against a dirty checkout, but the immutable publishing revision must contain the actual source, manifests, lockfiles, generated modules, release notes, and task definitions. Record that revision with the candidate. Never tag a clean old commit while uploading uncommitted changes.

## Write release notes that teach

A bump file tells a consumer what changed, why it matters, and how to use or migrate it. Use a complete example for a changed API. Explain a failure scenario, resource owner, or compatibility constraint when it affects adoption. Use diagrams, tables, and before/after output when they make the change clearer. The explanatory quality of esbuild's changelogs is the standard; a list of commit subjects is insufficient.

Create bump files through the pinned tool, then expand their Markdown bodies:

```sh
deno task bumpy add --packages '@okikio/rdf:patch' --name pending-read-abort --message 'Stop pending source reads when shape inspection is cancelled.'
deno task release:plan
```

Use the actual package name for this repository. Keep one story per consumer behavior. The formatter preserves authored paragraphs, code blocks, and diagrams. Breaking changes need explicit migration instructions. Performance claims need the workload, runtime, input size, units, baseline, variability, and correctness evidence. Do not promise every specification in a standards family because one profile passed.

For these pre-1.0 packages, compatible repairs are patch releases; new capabilities and intentional programming-model replacements use a minor increment with an explicit migration note. The selected versions must be free on every requested registry. No tool is permitted to overwrite an immutable version or force-move a public release tag.

## Freeze and inspect the actual artifacts

`release:prepare` runs the repository release gates, creates the real npm archives, and records source and archive SHA-256 identities in `.tmp/releases/prepared.json`. Inspect package names, versions, exports, declarations, license notices, optional integrations, and package contents. Use the clean consumer tests against those exact archives in Deno, Node, Bun, and the applicable browser/Worker contexts.

OPFS uses its dnt ESM compiler and preserves Drizzle as an optional peer. Its package output must be a descendant of `.release/` or `.tmp/`; `RELEASE_DIR` cannot delete an arbitrary directory. The workspace package family uses Deno's ESM packing path and resolves development `workspace:` dependencies to concrete versions in npm artifacts. Development source keeps workspace references.

Publish the package dependency graph in topological order. Check each dependency is available on the selected registry before publishing a dependent. `@okikio/rdf` precedes SPARQL, vocab, and triplestore; SPARQL precedes the two engine adapters. The triplestore borrows its filesystem and has no direct OPFS package dependency.

```text
bump stories -> Bumpy plan -> synchronized versions and changelogs
                                |
                     immutable source revision
                                |
                     source gates and exact archives
                                |
                JSR receipt      +      npm receipt
                                |
                   fresh public consumer behavior
```

Source tests prove source behavior. Archive consumers prove packaging. Public installs prove publication. Retain these distinct proof levels.

## JSR constraints

JSR publishes ESM TypeScript source and generates npm compatibility artifacts. Direct npm packages built here are a separate distribution path; `@jsr/okikio__...` compatibility names are not the direct npm package names.

Before upload, `deno publish --dry-run` must pass without `--allow-slow-types` or `--no-check`. Public exports need explicit, portable types. Exclude tests, benchmarks, downloaded suites, reports, caches, temporary fixtures, and release credentials from the publish set. Confirm imports resolve inside each package or through declared JSR/npm dependencies; an undeclared workspace alias is not a public dependency.

[JSR limits](https://jsr.io/docs/quotas-and-limits) require each source file, total uncompressed package, and uploaded gzip archive to be under 20 MB. The default scope quotas are 100 packages, 20 package creations per rolling week, and 1,000 publishing attempts per rolling week. Those defaults do not establish this account's remaining quota. Check scope usage before a release; repeated failed upload attempts are not a testing strategy.

[JSR publishing](https://jsr.io/docs/publishing-packages) supports GitHub OIDC for a package linked to the correct repository. Repository linkage, package ownership, current source revision, and the exact publishing workflow are part of authentication. Registry version immutability means repair by publishing a new version, not overwriting an old one.

## Publish, resume, and verify

Use `both`, `jsr`, or `npm` explicitly. Read-only registry checks distinguish a missing exact version from authentication failures, network failures, and malformed responses. A successful upload is independently checked in registry metadata before its receipt is written.

Retain the candidate archives and `.tmp/releases/` receipts after any failure. Retry only the failed registry with the same source and artifact identities. Do not rerun preparation and replace an already approved archive during a partial release. Existing versions must match retained release evidence; a matching version string alone cannot prove matching bytes.

For npm, use existing user authentication locally or trusted publishing in the configured GitHub workflow. For JSR, use the package-linked OIDC workflow or Deno's documented interactive authorization. Keep tokens out of arguments, source manifests, archives, and logs. The Deno release adapter uses Bumpy's public publishing pipeline with custom commands; it disables automatic Git tags and GitHub release creation so source references cannot silently point to the wrong commit.

After publication, run `deno task release:consumer both` against exact public versions. The command creates owned fresh consumers and caches. It checks direct npm, native JSR, and JSR npm compatibility separately; `jsr` selects both JSR distribution routes and `jsr-npm` checks only the compatibility route. Runtime executables are selected before entering the fresh project, so a repository-local tool selection does not disappear when the working directory changes. Then use a fresh project and exact public versions. Import every public subpath, type-check the public types, and run meaningful read/write, parse/query, or persistence behavior. For npm, compare the downloaded tarball to the prepared archive. For JSR, verify the published source/dependency graph and package version. Run the changelog examples from the installed packages. Record actual registry and consumer results before calling a release complete.

## Standards and resource evidence

Consult the maintained standards matrix and the source-bound conformance report. Official manifests, negative syntax cases, graph-isomorphism oracles, canonical writer byte fixtures, actual engine/provider interoperability, and lifecycle regressions cover distinct behaviors. Profile updates require a fresh report; a green count from stale source is not release evidence.

A performance measurement must name the consumer workload and its correctness oracle. Keep primitive and end-to-end comparisons. Record latency/throughput, CPU time, peak versus sampled/retained memory, logical versus physical bytes, request counts, startup, and cancellation where they apply. Network metrics do not apply to a local parser; process peak RSS does not prove a leak or a parser-only memory footprint. Define regression tolerances from repeated same-machine baselines and scenario requirements, not an arbitrary universal percentage.
