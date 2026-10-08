---
'@okikio/rdf': patch
---

### Preserve predicate identity while inspecting malformed SHACL paths

An IRI in `sh:path` is a predicate path even when that same resource has
`rdf:first`, `rdf:rest`, or a path constructor elsewhere in the shapes graph.
The inspector now keeps that predicate identity rather than interpreting those
other assertions as a compound path.

Compound constructor paths must be blank nodes with exactly one outgoing
constructor statement. A blank-node sequence cannot also carry a constructor,
and `rdf:nil` cannot carry list `rdf:first` or `rdf:rest` statements. Malformed
structures remain inspectable through retained assertions and diagnostics rather
than becoming a falsely accepted normalized constraint.

These rules follow [SHACL Core's path and list definitions](https://www.w3.org/TR/shacl/).
The inspector interprets a shapes graph; it does not validate a data graph or
implement SHACL-SPARQL evaluation.
