# Publish a tested package release

Deno owns repository commands. Bumpy 1.18.1 owns authored bump files, dependency propagation, version selection, and changelog rendering. Mise can install the declared runtimes; running package tests or preparing a release does not require Mise.

```sh
deno task release:plan
deno task release:version
# Review and commit the versioned source before preparation.
deno task release:prepare
deno task release:registry both
deno task release:publish both
```

Run `release:plan` before `release:version`. The plan identifies every affected package, its current and next version, and dependency propagation. Versioning consumes bump files, writes each package changelog, and synchronizes npm and Deno versions. It does not commit, tag, push, or publish. The original authored stories and full Bumpy plan are retained under ignored `.tmp/releases/version-plan.json`.

Review and commit the versioned source before preparation. Individual readiness checks can run against a dirty checkout. `release:prepare` and registry upload require a clean committed revision containing the actual source, manifests, lockfiles, generated modules, release notes, and task definitions. Record that revision with the candidate. Never tag a clean old commit while uploading uncommitted changes.

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

`release:prepare` captures the clean Git revision and creates an owned clone with independent Git objects. It checks out that exact revision, copies installed dependency bytes without hard links, and rebases workspace aliases into the clone. An alias outside the copied dependencies or committed workspace rejects preparation instead of borrowing another mutable checkout. Maintained source symlinks are also rejected; use ordinary committed package inputs.

Every source gate, archive build and artifact check runs in the clone. Downloaded Deno source and registry metadata seed an owned `DENO_DIR`; compiler caches, semantic databases and global mutable cache files are not shared. Missing downloads can still require network access on a cold runner. Copying installed dependencies and downloaded source uses additional disk space and startup time, rather than silently changing the release inputs through another checkout.

On Unix, maintained files and production/task directories are made read-only where task outputs permit it. This prevents accidental edits, not hostile changes by another process running as the same user. Source and revision checks run after each gate and before output copies on every platform. An A→B→A edit in the original checkout cannot influence the archive because the builder reads the clone. An original edit or branch change that remains prevents a new preparation receipt.

Exact archives and artifact inventory receipts are copied into their task-owned package output directories. Generated reports are retained under a unique `.tmp/releases/snapshot-<revision>-<attempt>/reports` directory, with path and source provenance in gate evidence. Existing `.tmp/reports` review evidence and dependency workspaces are preserved. Copied archives are hashed again. `.tmp/releases/prepared.json` binds their SHA-256 identities to the immutable revision, source hash, and independently named gate-evidence receipt. Evidence records each completed task, exit code, start/end time and source hash; upload rejects changed or missing evidence as well as changed source or archive bytes. Snapshot cleanup is awaited before issuing the receipt, with independent gate and cleanup failures retained together. Gate evidence records failure when cleanup fails; a passing gate alone cannot produce a passing preparation receipt. Previously prepared registry receipts remain distinct from each new preparation attempt.

Inspect package names, versions, exports, declarations, license notices, optional integrations, and package contents. Use the clean consumer tests against those exact archives in Deno, Node, Bun, and the applicable browser/Worker contexts.

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

The publishing workflow accepts `prepared_run` to select a retained preparation artifact from another run in the same repository. Supply its exact source `revision` and the remaining registry `target`. This skips preparation and restores the archives and receipts; the upload command still checks source, revision, and archive identities. Verification controls come from the workflow's current commit under ignored `.tmp/release-controls/`, while publication uses the original immutable source checkout. This permits a consumer-check repair after one registry has accepted a release without rebuilding the archive or moving its release tag.

A JSR upload can succeed while a previously cached missing-version API response remains visible. Registry management checks use a fresh query URL to avoid reusing that cached response. A missing JSR receipt still requires independent published-source verification. Do not infer matching source from an upload message alone.

The six packages borrow a caller-supplied filesystem; they do not declare an OPFS package dependency. Their publishing workflow normally obtains the reviewed OPFS version from npm for storage checks. Before direct npm availability, supply `opfs_archive_sha256` from OPFS's retained preparation manifest with its exact `opfs_revision`. The workflow reproduces the archive from that source and refuses a hash mismatch. This tests the same reviewed bytes without treating a local archive check as proof of a public npm installation.

For npm, use existing user authentication locally or trusted publishing in the configured GitHub workflow. For JSR, use the package-linked OIDC workflow or Deno's documented interactive authorization. Keep tokens out of arguments, source manifests, archives, and logs. The Deno release adapter uses Bumpy's public publishing pipeline with custom commands; it disables automatic Git tags and GitHub release creation so source references cannot silently point to the wrong commit.

After publication, run `deno task release:consumer both` against exact public versions. The command creates owned fresh consumers and caches. It checks direct npm, native JSR, and JSR npm compatibility separately; `jsr` selects both JSR distribution routes and `jsr-npm` checks only the compatibility route. Runtime executables are selected before entering the fresh project, so a repository-local tool selection does not disappear when the working directory changes. Then use a fresh project and exact public versions. Import every public subpath, type-check the public types, and run meaningful read/write, parse/query, or persistence behavior. For npm, compare the downloaded tarball to the prepared archive. For JSR, verify the published source/dependency graph and package version. Run the changelog examples from the installed packages. Record actual registry and consumer results before calling a release complete.

Immediate native JSR consumer checks set `--minimum-dependency-age=0` only in their owned child processes and select
the exact reviewed package versions. Deno's dependency-age policy can otherwise reject a just-published release before
checking its code. This release check does not change an application's dependency-age policy.

The upload workflow checks the actual checkout revision before npm publication and supplies that revision to npm's
provenance source dependency. The workflow commit can contain newer verification controls; it must not be mistaken for
the source commit that produced the retained archive.

## Standards and resource evidence

Consult the maintained standards matrix and the source-bound conformance report. Official manifests, negative syntax cases, graph-isomorphism oracles, canonical writer byte fixtures, actual engine/provider interoperability, and lifecycle regressions cover distinct behaviors. Profile updates require a fresh report; a green count from stale source is not release evidence.

A performance measurement must name the consumer workload and its correctness oracle. Keep primitive and end-to-end comparisons. Record latency/throughput, CPU time, peak versus sampled/retained memory, logical versus physical bytes, request counts, startup, and cancellation where they apply. Network metrics do not apply to a local parser; process peak RSS does not prove a leak or a parser-only memory footprint. Define regression tolerances from repeated same-machine baselines and scenario requirements, not an arbitrary universal percentage.

Release preparation rejects Unix UID 0 before creating a snapshot. Run it as an ordinary account, including in containers. Root bypasses file permissions and could accidentally replace and restore source bytes between identity checks. Source permissions guard ordinary tool mistakes; they do not isolate a hostile process running as the same user, which can change its own permissions.

On Unix, preparation protects each maintained file and every ancestor directory through the snapshot root. This also rejects atomic replacement of source files. The owned `.tmp`, `.release`, and `node_modules` directories remain writable for task output contents. Dependency installation that removes the root `node_modules` entry runs before source protection.

Maintainer release preparation also refuses Windows because this task cannot establish its physical source-write guard there. Prepare on an ordinary Unix account or the Unix CI runner. This restriction applies to preparing a publishing receipt; it does not change package consumers, library runtime support, or edit-capable release planning/versioning.

Generated gate output stays below the already writable `.tmp` namespace while snapshot root and maintained source ancestors remain readonly. Playwright screenshots, traces and runner artifacts use `.tmp/reports/browser/artifacts`; OPFS browser benchmarks use `.tmp/reports/browser-bench/artifacts`. OPFS coverage samples and `lcov.info` use `.tmp/reports/coverage`. Clean tasks can delete and recreate these leaves without gaining write permission to maintained source directories. Their ignored output bytes are retained as evidence rather than included in source identity.

SPARQL's storage and browser gates also require two independent OPFS inputs.
`OPFS_SOURCE` selects a clean committed OPFS checkout, and `OPFS_TARBALL` selects
its consumer archive. Their existing defaults are `../opfs` and
`../opfs/.release/npm/okikio-opfs-0.0.0-quality.tgz`. Preparation clones the selected
source revision and copies installed dependency bytes and the archive into its
owned `.tmp/release-inputs/` directory. Gate environment paths select those copies.
No OPFS release runs inside SPARQL preparation. A published npm archive remains a
valid input independent of the source lane, provided its package name, version,
public export keys, and regular exported files match the selected OPFS manifest.
The default development archive uses the explicit `0.0.0-quality` version; an
explicit `OPFS_TARBALL` must use the selected manifest's version.

`OPFS_ARCHIVE_SHA256`, when supplied, must contain the exact lowercase SHA-256 of
the selected archive. The publish workflow exports the verified digest to
preparation. Receipts retain separate OPFS source revision/hash and archive
hash/version/export identities. They do not assert that the selected archive was
built from that source revision. Preparation checks both original inputs before
and after each gate and before delivery; a retained edit refuses the receipt.
Later upload jobs use the retained evidence and do not need the original OPFS
checkout. Archive admission accepts a regular file up to 128 MiB, bounds tar
metadata to 16 MiB and its manifest to 1 MiB, and rejects duplicate, escaping,
linked, special, or unsupported export members without extracting paths. Each
direct tar inspector has a 30-second operational admission deadline; this is not
a performance target. Preparation stops and awaits that direct child on failure,
retains independent operation and cleanup errors, and does not claim descendant
process ownership.

Readonly source permissions prevent ordinary direct writes and replacements
inside protected source directories. They are not protection from deliberate
same-owner permission changes or replacement of an input namespace beneath
writable `.tmp`; that stronger guarantee requires filesystem or container mount
isolation. Original source changes cannot become gate inputs because gates use
independent captured bytes.

OPFS quality has two canonical phases. Ordinary `deno task quality` runs
`deno task deps:ci && deno task quality:source`, preserving the full previous
sequence. The first command runs real `deno ci`: Deno removes and recreates the
root `node_modules` entry even when its contents are writable. Release preparation
therefore runs that dependency phase once in the owned clone before making its
root readonly. It records the actual command status, raw stdout/stderr, and source
hash/revision before and after installation. It checks the original checkout too.
A failed install or a retained source/revision change refuses preparation before
any immutable source gate.

After installation, preparation removes write permissions from every maintained
file and source ancestor through the clone root. It invokes the committed
`quality:source` task, which owns the complete quality remainder, followed by the
existing runtime, browser, provider, Linux, benchmark and package gates. Source
gates never thaw the root or repeat destructive dependency installation. No
environment flag can replace installation proof with a claimed success. The
installation phase has a distinct permission boundary: maintained inputs are
identity-checked there; physical readonly protection begins before source gates.
Same-owner hostile actions remain outside the ordinary-tool guard.

Dependency logs are streamed into a unique
`.tmp/releases/snapshot-<revision>-<attempt>/dependencies/` directory. Their exact
hashes and paths are retained in gate evidence and checked before upload. The
publish workflow carries those raw files into resumed jobs. Capture and SHA-256 verification use streams and a fixed 64 KiB hashing buffer,
so a large dependency log is not loaded as one large in-memory result. Cold preparation can download and install
the full locked graph, and Deno may discard the initial independently copied
dependency tree; this costs disk space and installation time. A failing phase
still retains its raw diagnostic evidence and awaits owned snapshot cleanup.
SPARQL's `deps` task checks its dependency firewall and does not run `deno ci`, so
its canonical verification DAG stays inside the protected source phase.

A dependency log write failure stops the directly owned task CLI and waits for
its reported status and both raw streams. Logging, stop and close failures remain
independent errors and refuse a prepared receipt. Stopping `deno task` does not
prove that every spawned install descendant stopped; a descendant can retain a
pipe. The bounded outer aggregate/container watchdog remains the final process
boundary. Preparation does not claim process-group or daemon-wide ownership.

Raw dependency output is copied as bytes through explicitly owned stream readers and file writes. A short file write
retains the unwritten suffix before the next read; a zero-byte or invalid write refuses preparation instead of losing
output or looping forever. This preserves binary diagnostics and split UTF-8 bytes as well as ordinary console text.
Reader cancellation, lock release, and file close failures remain independent evidence failures. Successful console
output alone cannot prove useful capture: behavioral controls compare the retained bytes through three-byte file writes
and require write rejection or zero progress to block every source gate and prepared receipt.

### Keep gate execution separate from source admission

A task can finish successfully while its subsequent Git identity request fails. Preparation records those two outcomes separately. Each version2 gate journal first checkpoints a pending command with `code:null` and no completion timestamp, then records the actually reported exit code, success and signal before requesting the source hash and revision. Both identity requests are attempted independently. A failed or unknown identity blocks the prepared receipt, even when the task returned zero. A nonzero task remains visible when identity checks also fail; permission restoration and snapshot removal errors remain additional failures.

Git acquisition errors retain their argument vector, checkout path, reported code and signal, and exact stdout/stderr byte arrays in `diagnostics`. Human console errors decode stderr for readability; the retained arrays preserve binary or split UTF-8 diagnostics. If Git output acquisition throws without a reported result, status and byte fields are null rather than a fabricated zero/empty success. Admission failures before an owned snapshot exists use a unique `.tmp/releases/authority-<attempt>.json` record. Snapshot attempts retain the existing `gates-<revision>-<attempt>.json` layout and successful source/code/revision fields. Historical successful journals remain readable; version2 evidence additionally requires successful execution and verified integrity observations before upload.

Run preparation from the repository root, then inspect its failed-attempt evidence:

```sh
deno task release:prepare
```

```sh
deno eval '
for await (const entry of Deno.readDir(".tmp/releases")) {
  if (!entry.name.startsWith("gates-") && !entry.name.startsWith("authority-")) continue;
  const journal = JSON.parse(await Deno.readTextFile(`.tmp/releases/${entry.name}`));
  if (journal.passed === false) console.log(JSON.stringify(journal, null, 2));
}
'
```

A Git ownership refusal remains a refusal. Preparation never adds `safe.directory` exceptions or falls back to a directory walk that bypasses Git's source/ignore authority. Diagnose the recorded checkout and repair its owning runner or acquire a fresh correctly owned snapshot. Readonly content mounts alone do not prove stable directory ownership on every Docker Desktop filesystem. These journals are local provenance and failure evidence, not signatures or a promise that an arbitrary supervisor interruption completes cleanup. Pending or partial evidence cannot authorize publication. Git identity requests currently collect their outputs in memory; exact failure byte arrays add diagnostic artifact space. Large dependency logs continue to use their separate streaming capture and fixed-buffer hashing route.

### Admit native Git ceilings without selecting another repository

A damaged snapshot must not borrow an intact ancestor repository. Git commands keep ordinary repository discovery and
its ownership checks, but set `GIT_CEILING_DIRECTORIES` to the canonical parent of the requested checkout. An invalid or
missing local Git repository then fails instead of selecting an original checkout above it. The authority boundary rejects
ambient `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_NAMESPACE` selection overrides. The journal records only the rejected variable
name in `selection.variable`, not its value.

A parent path must fit one native ceiling entry. Unix uses `:` as the list separator and rejects a parent containing a
colon. Git for Windows uses `;`, so a drive-letter path such as `C:\releases` remains one entry, while a parent containing
a semicolon rejects. The pure ceiling admission applies to Git requests on either platform; it does not add Unix
permission requirements to Windows plan or upload commands. Preparation itself still requires the documented ordinary
Unix account. This follows [Git's discovery contract](https://git-scm.com/docs/git#Documentation/git.txt-codeGITCEILINGDIRECTORIEScode),
its [native separator parsing](https://github.com/git/git/blob/v2.51.2/setup.c#L1368-L1374) and
[Windows separator definition](https://github.com/git/git/blob/v2.51.2/compat/mingw.h#L36).
No explicit `--git-dir` selection or ownership exception replaces discovery admission.

### Retain failed report bytes before retiring their owner

Snapshot `.tmp/reports` are copied once into the attempt's outer reports directory before cleanup on both success and
failure. A failed gate does not need a successful fresh Git identity request to retain binary captures and JSON reports.
The journal marks them `outcome:failed` and `sourceIdentity:expected`: source/revision name the admitted attempt inputs,
not a newly verified failed snapshot. A copy that fails keeps `copyState:partial` and its independent diagnostic while
cleanup continues. Only completely successful preparation labels retained reports with verified source identity.

The acquired temporary root and cloned source root must retain their physical identities before any snapshot Git request,
source read, task dispatch, package copy or report read. Replaced owners produce `SnapshotError` with
`snapshot.stage:admission`; this is an admission failure, not an invented Git exit. Both post-task integrity attempts
record their own refusal after the actual task result has been observed. Source files and copied package paths also reject
nested aliases before reading. Canonical OS prefix aliases such as `/var` and `/private/var` are resolved at acquisition;
a later gate-created alias does not acquire the outside tree.

The report root and its `.tmp` parent must be physical directories under that admitted source root. A regular file or
an outside parent/root alias rejects before capture. Child report aliases are inert diagnostic metadata; executable inputs keep their stricter confined copy rule.
Serialized failures use `ReportError` with `report.stage:admission` for owner/root admission, or `report.stage:copy` for
capture after admission. The original cause is retained separately. Consumers can inspect these stable fields without
matching human diagnostic wording.

These illustrative selected fields show why a completed failing task, refused source identity and rejected report root
remain different observations; they are not an actual run receipt:

```json
{
  "passed": false,
  "steps": [{
    "task": "consumer-check",
    "code": 9,
    "execution": { "state": "exited", "success": false, "signal": null },
    "integrity": { "source": { "state": "failed" }, "revision": { "state": "failed" } }
  }],
  "diagnostics": [{ "name": "ReportError", "report": { "stage": "admission" } }]
}
```

Actual journals also retain completion times, independent causes, reported Git status/raw bytes when Git was dispatched,
and cleanup faults. Failed or partial retained reports cannot authorize a prepared receipt or publication. Retention is
local best-effort evidence, not a promise after supervisor interruption or an indefinitely open descendant stream.

### Restore only physical objects inside the acquired owner

Preparation records each protected file/directory's original mode and exact device/inode identity before removing write
permissions. Positive safe integer identities are required; absent, zero or rounded numeric identities cannot distinguish
owned objects reliably. Cleanup walks the acquired physical temporary root without following symbolic links and restores
only identities in that protection record. Renaming a protected subtree inside the owner keeps its identity, so its
permissions can be restored at the new path. Replacing a frozen path with an outside alias never grants permission to
change that target's mode or bytes. Immutable copied OPFS inputs follow this same rule.

An unregistered output directory whose gate removed all permissions remains a real cleanup failure; restoration does not
silently repair arbitrary task output. Descendant restoration errors and the attempted native removal remain independent.
A replaced temporary root blocks both report capture and cleanup there; the tool leaves the unadmitted location alone and
records the refusal. A supervisor must use its own previously acquired namespace to retire any safely displaced private
root. Child-written path markers are observations, never deletion authority.

The restoration scan adds metadata work per owned entry, including private caches. Gates must be settled and quiescent:
[Deno's filesystem API](https://docs.deno.com/api/deno/file-system/) exposes path-based `chmod` and `remove`, not an atomic
handle-based permission-and-deletion transaction. Checks cannot prevent hostile concurrent same-user replacement between
admission and a syscall, nor promise cleanup after abrupt process termination. These limits do not relax source admission,
Git trust checks or successful-receipt requirements.

### Report metadata survives browser-profile aliases

Report retention uses a separate diagnostic copier. A closed Firefox persistent profile can retain a dangling lock
alias under Playwright's artifacts directory. Diagnostics do not require that alias to name a currently existing file.
Internal, escaped, absolute, cyclic and dangling aliases are recorded with their physical metadata and exact raw target
bytes as `rawTargetBase64`. The copier never resolves their target, reads outside bytes or recreates a live alias.
Sockets, FIFOs and devices are also recorded as inert metadata, rather than opened or cloned. An explicit Unix-socket
control requires that host capability; binary, alias, collision and fault-retention controls keep their normal coverage.
Browser fixtures keep their existing profile lifetimes and behavioral oracles.

The journal's `reports.path` names the actual exclusive `.tmp/releases/reports-<revision>-<attempt>/reports` capture.
Its `reports.catalog.path` names a uniquely allocated `report-catalog-<nonce>.ndjson` sibling, with an independently
computed SHA-256 when hashing succeeds. It cannot collide with a report filename. Dependency logs retain their existing
snapshot namespace; older journals and report paths remain readable. Read the catalog as JSON lines. Its header explains
the regular-byte/inert-metadata representation, each entry records original kind and observable metadata, and its
`entries-complete` row records entry capture state. This row is not a successful release or catalog-close certificate.
The enclosing gate journal includes catalog retirement/hash faults and controls overall `copyState`, `outcome` and
source-identity status.

Regular files are independent exclusive copies, read through acquired handles with native no-follow flags where
available. Before reading, their physical kind/device/inode must match the admitted observation; EOF rechecks identity,
size and modification timestamps. Parents and roots retain physical acquired authority before reads or writes. Existing
destination leaves, substituted ancestors and source/destination overlap reject. No chmod or cleanup follows a borrowed
target. These native observations do not promise atomic protection from hostile concurrent same-UID namespace changes;
unobservable native identities refuse admission rather than becoming invented ownership proof.

A failed file or directory records its path, capture phase and original cause and does not stop independent sibling
reports. Rows stream to the separate catalog even when regular-file capture fails. Each file/capture/catalog retirement
fault is retained separately. Failed file hashes are null; observed retained sizes are separate from completed read
bytes. If catalog persistence or hashing itself fails, the release journal retains that independent failure and partial
state. Snapshot retirement continues, and the original gate failure remains a failure. This diagnostic capability does
not weaken dependency/source/cache alias admission or authorize publication.

File and catalog streams use 64 KiB buffers; acquired directory identities, sorted listings and retained failures use
memory proportional to their count. Copying and hashing cost diagnostic disk space and setup time. The outer command
and owned-container deadlines remain the final boundary for a stalled native filesystem. These costs are not timed
library operations or a performance regression budget. The native [readlink API](https://nodejs.org/api/fs.html#fspromisesreadlinkpath-options)
provides raw target bytes without resolving the aliased object.
