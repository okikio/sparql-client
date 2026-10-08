/** Document-local blank identity for external graph results. @module */
import {
  type BlankNode,
  blankNode,
  type ObjectTermType,
  type Quad,
  quad,
  type SubjectTermType,
} from '@okikio/rdf'

/**
 * Reuses one remote label inside a graph response and isolates it from other
 * responses. The caller creates a fresh map for each RDF document. Nested
 * triple terms share that map with their surrounding graph.
 */
export function relabel(value: Quad, labels: Map<string, BlankNode>): Quad {
  return quad(
    subject(value.subject, labels),
    value.predicate,
    object(value.object, labels),
    value.graph.termType === 'DefaultGraph' ? value.graph : subject(value.graph, labels),
  )
}

/** Keeps named-node identity and replaces a response-local blank label once. */
function subject(value: SubjectTermType, labels: Map<string, BlankNode>): SubjectTermType {
  if (value.termType !== 'BlankNode') return value
  let node = labels.get(value.value)
  if (!node) {
    node = blankNode()
    labels.set(value.value, node)
  }
  return node
}

/** Applies the same identity map recursively without changing literal or IRI spelling. */
function object(value: ObjectTermType, labels: Map<string, BlankNode>): ObjectTermType {
  if (value.termType === 'Quad') return relabel(value, labels)
  if (value.termType === 'Literal') return value
  return subject(value, labels)
}
