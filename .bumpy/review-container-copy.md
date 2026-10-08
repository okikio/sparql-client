---
'@okikio/rdf': patch
---

Packed Linux validation now copies its installed packages into private containers
instead of mounting a host consumer directory. Nested Docker binds can alter host
ownership metadata and invalidate a release snapshot even when the bind is marked
read-only. These validation tasks no longer bind the source or its installed trees.

Run the existing commands after building the current archives:

```sh
deno task consumer
deno task consumer:linux
OPFS_TARBALL=/absolute/path/to/okikio-opfs.tgz deno task consumer:storage
```

The host consumer checks the actual six archives and their packing receipt.
Storage composition adds the selected OPFS archive. Linux lanes preserve Node 22,
Node 24, Bun and Deno behavior. Host metadata stays explicitly unknown where unavailable.
The private Linux bootstrap establishes actual copied POSIX modes/ownership;
public Windows consumer support and standalone Docker/Linux validation remain available. A private copied manifest checks every admitted
file, directory and contained link before and after that behavior. Source hardlinks
are legitimate byte inputs; copied files must be independent. Escaped aliases,
Git metadata, special files, missing or extra entries, byte substitutions and changed
permissions fail admission. The private Linux bootstrap applies read-only permissions
to its copied files and directories; original inputs remain unchanged. Host staging
directories stay owner-writable, so retirement changes no directory permissions.
On Windows, acquisition clears inherited readonly attributes on newly copied regular
files, including the copied worker. Original bytes and readonly attributes remain
unchanged; cleanup does not change permissions. Linux admitted modes are separate.
Verification, Docker copying, retained evidence reads/writes and cleanup recheck
the acquired root and canonical parent, exact available physical identity and private
nonce before use. Retained report roots and individual observation directories each
have separately acquired ownership; report bytes survive payload retirement. A substituted root, parent or marker rejects and
leaves the original copy for independent investigation. Device/inode observations must be positive safe integers; zero or unavailable values
are explicitly unknown. An identical copied nonce cannot distinguish an otherwise
unobservable replacement. Unknown host metadata stays
unknown; these checks do not claim fd-relative protection against hostile concurrent
path changes.

A bounded root bootstrap owns only the private container copy. The consumer runs
as UID/GID 1000 and checks that it has no effective, permitted or ambient capabilities.
Its temporary directory remains writable. The container root filesystem is not
claimed to be read-only: Docker refuses to populate such a root through its copy API.
CLI diagnostics retain at most 32 MiB of bytes independently per output stream.
Overflow rejects capture and retains its prefix; actual process exit and signal stay
separate from capture failure. This is a maintainer diagnostic limit, not a workload
performance budget. Exact daemon cleanup is separately attempted after a CLI failure.
The private payload shares one cleanup promise, including rejection, and checks both
the private and retained admission receipt bytes.
Every CLI command records actual exit/signal and independent pipe/capture observations
with bounded raw bytes and hashes under the acquired report directory. A failed report
write is retained independently and still permits exact owned-container removal.

Copy, startup, bootstrap, logs and exact-container removal have operational deadlines,
and cleanup failures remain alongside the original failure. The retained admission
receipt under `.tmp/reports/consumer-copy/` includes the actual worker and orchestration
source hashes, selected archives and original versus copied metadata.

Copy preparation and its checks occur outside cold-start measurement intervals.
The existing 36 serial cold samples and byte/RDF recovery oracles remain unchanged;
their report now identifies this preparation authority separately.
