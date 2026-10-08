---
'@okikio/rdf': patch
---

### Prepare one committed source snapshot, even while the original checkout changes

Checking a working-tree hash before and after release gates did not prove that
all gates saw the same code. A gate could observe version A, a builder could pack
version B, and an editor could restore A before the final hash. Those bytes could
receive a source receipt for code they did not contain.

`release:prepare` now requires a clean committed revision and runs gates and
packing in an owned clone of that exact revision. Installed dependency bytes are
copied independently; workspace aliases point into the clone. A restored edit in
the original checkout cannot enter the tarball. A retained original edit refuses
preparation. Planning and versioning remain available while editing.

```sh
deno task release:plan
deno task release:version
# Review the generated versions, changelogs and source; commit that reviewed state.
deno task release:prepare
# Inspect .tmp/releases/prepared.json and its gate evidence before publication.
deno task release:registry both
deno task release:publish both
```

Each gate checks source identity before and after execution. Snapshot reports are
retained with source provenance under a unique release evidence directory; existing
local reports and dependency workspaces are preserved. Copied archives are
hashed again, and the receipt binds them to revision, source and durable gate
evidence. Registry upload rejects a changed archive, source or evidence receipt.
An independent regression edits the original A→B→A between gates, extracts the
actual tarball member and compares it with authored expected bytes from A.

This uses additional disk space for owned dependency and downloaded-source copies.
Downloaded Deno source metadata can seed a cold owned cache; compiler state and
semantic databases are not shared. External source aliases reject rather than
borrow another checkout. Unix read-only permissions prevent accidental mutation,
not hostile same-user tasks. Snapshot cleanup settles before a receipt is issued,
and a gate failure remains distinct from a cleanup failure. Failed cleanup is
recorded as failure even when the preceding gate passed.

These are release-input guarantees, not evidence that a package version is
published. Existing registry and fresh public consumer checks remain necessary.

Preparation also rejects Unix UID 0 with an instruction to use an ordinary account. Root bypasses readonly source permissions, so ordinary-account execution is part of this release contract. Same-user hostile tools that deliberately change permissions remain outside the accidental-write guard.

Maintainer preparation also refuses Windows, where this task has no proven physical source-write guard. Use the ordinary-account Unix CI runner to prepare a release. Library consumer runtime support is unchanged.

Task output paths follow the same ownership boundary: coverage cleanup and Playwright traces/screenshots recreate leaves under writable `.tmp/reports/`, while maintained source and its ancestors remain readonly. This lets a release gate clean its previous output without granting it permission to replace source files.

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

Browser fixture servers load their TypeScript configuration natively in Deno. The bundled loader
can emit a temporary module beside a maintained configuration file; protected source correctly
refuses that write. Native loading keeps fixture startup inside the same readonly contract as
the rest of preparation, without relaxing permissions or enabling live source changes.

### Retain browser-profile diagnostics without borrowing their targets

Release preparation now distinguishes executable input admission from diagnostic report capture. A retained Firefox
profile lock could be dangling after the browser closed, causing report copying to stop at `realpath` and discard later
independent reports. Report links now remain inert metadata with their exact raw target bytes; contained, escaped,
absolute, cyclic and dangling targets are never followed or recreated. Native sockets, FIFOs and devices likewise remain
metadata. Strict source, dependency and cache copying is unchanged.

Each attempt exclusively acquires `.tmp/releases/reports-<revision>-<attempt>/reports` and a uniquely named sibling
JSON-lines catalog. Inspect the actual paths and catalog SHA in the gate journal's `reports` fields; previous journals
remain readable, and dependency logs retain their existing snapshot namespace. Regular binary files copy independently.
One file failure retains its original cause and partial observation while sibling reports continue. Catalog-write,
handle-close, hashing and cleanup failures remain distinct. The original failed gate still fails preparation, and
partial diagnostics do not authorize publication. Root/parent alias and destination collision guards remain mandatory.
There is no change to browser assertions, profile ownership, library APIs or public task commands.
