---
'@okikio/triplestore': patch
'@okikio/oxigraph': patch
---

### Reject an inadmissible mutation before borrowing input or dispatching it

A closed or read-only triplestore now rejects `import()` before it acquires the
input iterator, including an empty source. Mutation admission also checks caller
abort before queuing and again when the queued operation starts. Adding an
existing quad, deleting a missing quad, importing an empty batch and clearing an
empty dataset no longer turn a pre-aborted request into a successful no-op.

Rejected admission publishes no generation and preserves the caller's abort
reason. Completed import batches still remain committed when a later batch
fails; this does not introduce a whole-stream transaction or rollback.

The Oxigraph adapter checks cancellation again immediately before its deferred
update dispatch. Aborting after `update()` returns its promise but before the
microtask runs now prevents the engine mutation. Once synchronous Wasm evaluation
has started, interruption still requires an application-owned worker. The engine
and injected filesystem remain borrowed resources.
