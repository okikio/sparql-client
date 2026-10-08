# Changelog

## 0.2.0

2026-10-06

### Reopen a dataset from committed immutable generations

The triplestore persists RDF changes through a borrowed structural filesystem. Each committed generation references validated N-Quads segments. Reopening selects the newest valid generation; an incomplete commit is not mistaken for a newly empty database.

```text
write immutable segment -> write commit record -> generation becomes recoverable
                                                  |
reopen -> validate newest generation -> reconstruct exact-term indexes
```

This is useful for local knowledge bases that must survive a process or browser restart. The application supplies the filesystem and remains responsible for its lifetime. Disposing the store releases its own state and keeps the borrowed filesystem usable.

**Migration and limits:** use `open()` from `@okikio/triplestore` with the filesystem documented in its README. Use one writer per path. The current implementation rebuilds indexes in memory; it does not provide cross-process writer coordination or a physical garbage-collection contract. A corrupt only-generation is an error, while a corrupt newest generation can fall back to an older validated generation.
