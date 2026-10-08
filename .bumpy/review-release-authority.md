---
'@okikio/rdf': patch
---

### Preserve the task result when Git refuses its checkout

A completed Linux task could disappear from the preparation journal when a later Git request failed. Its captured stderr was also discarded, leaving a generic source-enumeration error after the owned snapshot had already been removed. That made a task failure, an ownership refusal, and a missing Git repository difficult to distinguish.

Preparation now records the actual task code/signal separately from source-hash and revision admission. Both post-task requests retain their own failures, and a zero exit does not certify unknown source identity. Exact failed Git stdout/stderr bytes, arguments and checkout paths survive in structured journal diagnostics. Cleanup faults remain separate; no ownership exception or weaker source scan replaces the failed Git request.

Use the existing command from the checkout root:

```sh
deno task release:prepare
```

Successful preparation keeps the existing candidate and archive workflow. A failed initial admission writes `.tmp/releases/authority-<attempt>.json`; a failed snapshot keeps its `gates-<revision>-<attempt>.json` record with execution and integrity outcomes. Inspect that evidence before repairing the owning runner. Version2 journals require both successful task execution and verified source identity; older successful receipts retain their existing checks. A supervisor interruption may leave pending or partial evidence, which cannot become publication authority.

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
an outside parent/root alias rejects before capture. Child report aliases retain the existing confined copy rule.
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
