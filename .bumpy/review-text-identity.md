---
'@okikio/sparql': patch
---

### Reject damaged response bytes before they change an RDF value

An endpoint can return syntactically valid JSON or N-Triples containing invalid
UTF-8 bytes inside a literal. Replacing those bytes with `�` makes a different
RDF term appear successful. Materialized HTTP query and Graph Store responses
now decode successful payloads strictly and reject malformed or truncated UTF-8
as `QueryError` with `kind: 'protocol'`. A character split across byte chunks
continues to decode correctly.

Rejected acquired bodies are retired and their reader locks released. Network
read failures remain network errors. Bounded diagnostic previews of failed HTTP
responses remain tolerant so damaged error text can still help explain the
server failure. This change does not introduce mutation retries.
