# Changelog

## 0.2.0

2026-10-06

### Keep the query engine and its resources under application ownership

The engine adapters translate a supplied Oxigraph store or Comunica query engine into the SPARQL result-mode-specific contract. Importing an adapter does not initialize Wasm, create a store, select a data source, or launch an engine.

SELECT and graph consumers receive asynchronous iterables. The Comunica adapter destroys its upstream stream when a consumer returns early or aborts. Boolean and update operations follow the upstream promise and context capabilities.

Oxigraph's JavaScript store runs synchronous Wasm operations. The adapter checks an AbortSignal before starting and rejects a positive `timeoutMs` because it cannot interrupt a synchronous call truthfully. Put the engine in an owned Worker or process when execution must be interruptible.

**Migration:** inject the engine into `create()` from the selected adapter package. Use `update()` for the public update operation; the Comunica adapter translates that to upstream `queryVoid()`. Dispose the store or engine in the application that created it. The adapter does not adopt it.
