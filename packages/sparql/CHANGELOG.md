# Changelog

## 0.2.0

2026-10-06

### Construct queries separately from their execution engine

SPARQL now exposes branded terms, expressions, fragments, queries, and updates. Builders accept native RDF named nodes, so vocabulary terms and parsed datasets compose without forcing a particular engine or transport into the root package.

```ts
import * as rdf from '@okikio/rdf'
import * as sparql from '@okikio/sparql'

const query = sparql.select(['?name']).where(
  sparql.triple(rdf.namedNode('urn:product'), rdf.namedNode('urn:name'), '?name'),
)
console.log(query.build().value) // SELECT ?name WHERE { <urn:product> <urn:name> ?name . }
```

Pass the query to the HTTP subpath or an explicit engine adapter. SELECT results are bindings, ASK results are booleans, and graph queries yield RDF statements; one generic result shape cannot express those contracts accurately. The HTTP and Graph Store clients own response decoding and cleanup, while applications own endpoints, authentication, and retry policy.

**Migration:** use `@okikio/sparql/http` for remote execution, `@okikio/oxigraph` for a supplied Oxigraph store, or `@okikio/comunica` for a supplied Comunica engine. Lexical inspection is not a complete SPARQL grammar validator or an evaluator. XML, CSV, and TSV result decoding are outside the current HTTP result contract.
