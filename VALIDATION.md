# Validation record

This file records executed evidence for the current repository state. It separates canonical Deno
release gates from fallback checks so a partial or host-specific result cannot be mistaken for a
release certification.

## Latest canonical Deno run

A Deno 2.9.5 run on 2026-08-19 exposed failures before this repair pass. The command sequence was:

```text
deno install && pnpm install
deno fmt --check
deno lint
deno check
deno test
deno task conformance
deno task bench
deno task integration
deno task release-check
```

The observed failures were:

| Gate | Result before this repair pass | Verified cause |
| --- | --- | --- |
| `deno fmt --check` | FAIL | Generated `pnpm-lock.yaml` was included in root formatter discovery. |
| `deno lint` | FAIL, 51 findings | Unnecessary `async`, control-character regular expressions, stale imports, an unreachable throw, and one banned open-string type trick. |
| `deno check` | FAIL, 4 errors | Typed-array DOM generic mismatches and a stale SPARQL.js-style assertion against Traqula's AST. |
| `deno test` | FAIL before execution | The Traqula property test failed type checking. |
| `deno task conformance` | FAIL, 0 pass / 6 fail | Standalone conformance execution did not synchronize its pinned external suites first. |
| `deno task bench` | FAIL | The Comunica adapter required a non-standard `entries()` method on RDF/JS bindings. |
| `deno task integration` | FAIL | The same Comunica binding defect plus missing named Deno system permissions required by Testcontainers. |
| `deno task release-check` | FAIL | `verify` stopped at the lint gate before later release gates could run. |

These failures are historical evidence for the input tree. They are not the result of the repaired
source below.

## Repair-pass validation

The current repair pass changed the implementation and release task graph to address the failures
above. The execution host used for this pass does not provide Deno, Docker, or the project registry
cache, so the canonical Deno gates have **not** been rerun here.

The following fallback checks were executed against the repaired source:

| Check | Result |
| --- | --- |
| Strict TypeScript, changed production slice | PASS |
| Strict TypeScript, changed test slice | PASS |
| Strict TypeScript, changed task/conformance slice | PASS |
| Traqula property-test AST shape type check | PASS |
| Focused runtime lane | 57 / 57 PASS |
| Broader package runtime lane | 195 / 195 PASS |

The strict TypeScript checks used `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and `noImplicitOverride`. Runtime fallback tests used the same project
sources but did not substitute for Deno's formatter, linter, permission model, npm/JSR resolution, or
official external conformance corpora.

## Repairs covered by this record

The repair pass addresses these release failures:

- root formatter discovery excludes the generated pnpm lockfile;
- Deno lint findings are fixed without disabling recommended rules;
- Web Crypto and Fetch typed-array call sites provide concrete `ArrayBuffer` values;
- Traqula assertions use its current `type` / `subType` AST contract;
- Comunica bindings are decoded through the RDF/JS iterable contract instead of Map-only APIs;
- Oxigraph and other promise-returning adapters preserve promise rejection semantics without
  unnecessary `async` declarations;
- bare `deno test` discovers package and conformance tests only, while Docker integration remains an
  explicit privileged lane;
- the integration child grants only the named system information Testcontainers currently reads;
- standalone conformance execution synchronizes pinned W3C/upstream suites before running cases;
- `support.json` resides at the repository root used by the support gate and documentation;
- release packaging expands concrete Deno workspace members instead of treating `./packages/*` as a
  literal directory and permits the same dirty-tree dry-run workflow as the JSR publish check.

## Canonical gates still required

Do not call this repository release-validated until the repaired tree passes the following commands
on a host with Deno 2.9.5, the resolved npm/JSR graph, and Docker where required:

```text
deno install
pnpm install
deno fmt --check
deno lint
deno check
deno test
deno task conformance
deno task support
deno task bench
deno task integration
deno task release-check
```

The conformance gate is intentionally strict. Synchronizing the external suites fixes orchestration;
it does **not** turn processor failures or skips into passes. Any remaining official RDF, JSON-LD,
RDFC, RDFa, or Microdata failures must remain visible and continue to block the corresponding public
support claim.

The real Comunica/Oxigraph benchmark and Docker integration paths also remain pending on this host.
Their source contracts and local regression tests were reviewed, but the exact external engines were
not executable here.
