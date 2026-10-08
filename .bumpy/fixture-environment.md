---
'@okikio/rdf': patch
---

### Own the release fixture environment

Release tests create private Git repositories, cached dependencies and registry doubles.
Their child commands now start with a cleared environment and explicitly select platform
lookup and locale settings plus fixture inputs. This makes an absent optional input stay
absent: deleting the fixture archive digest can no longer reveal a digest inherited from
an outer OPFS/RDF release run. Git redirection, runtime injection flags, provenance settings
and inherited registry credential variables are also excluded unless a scenario explicitly supplies them.

For example, an outer composed release can select its real OPFS archive while the fixture
selects an intentionally malformed archive. The fixture must reach archive identity or
export validation rather than reject an unrelated outer digest first:

```sh
OPFS_SOURCE=../opfs \
OPFS_TARBALL=../opfs/.release/npm/okikio-opfs-0.1.0.tgz \
OPFS_ARCHIVE_SHA256="$(sha256sum ../opfs/.release/npm/okikio-opfs-0.1.0.tgz | cut -d ' ' -f 1)" \
deno task test:release
```

A real-child control observes both absence and explicit overrides. An owned outer child
receives deliberately foreign variables, then its inner fixture command must remove them.
The test never changes the parent operating-system environment. Nested authored gates inherit the fixture's
already-selected environment so they keep its registry doubles and owned temporary/cache
paths. Production release selection, archive validation and upload guards are unchanged.
The command above is a Unix example; the release fixture suite already excludes Windows
because it uses POSIX tools. It tests release tooling rather than certifying provider behavior.
