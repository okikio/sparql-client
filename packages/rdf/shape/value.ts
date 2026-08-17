/** Serializable RDF term conversion for the SHACL model. @module */

import type { Graph, Literal, Quad, Term } from '../term.ts'
import type { AssertionType, IdType, LiteralType, TermType, TextType } from './model.ts'

/** Converts an RDF graph node into a serializable SHACL identifier. */
export function id(term: Term): IdType | undefined {
  if (term.termType === 'NamedNode') return { kind: 'iri', value: term.value }
  if (term.termType === 'BlankNode') return { kind: 'blank', value: term.value }
  return undefined
}

/** Converts an RDF term into the serializable shape representation. */
export function term(value: Term): TermType | undefined {
  switch (value.termType) {
    case 'NamedNode':
      return { kind: 'iri', value: value.value }
    case 'BlankNode':
      return { kind: 'blank', value: value.value }
    case 'Literal':
      return literal(value as Literal)
    case 'Quad': {
      const triple = value as Quad
      const subject = id(triple.subject)
      const object = term(triple.object)
      if (!subject || !object) return undefined
      return { kind: 'triple', subject, predicate: triple.predicate.value, object }
    }
    case 'Variable':
    case 'DefaultGraph':
      return undefined
  }
}

/** Converts an RDF literal into a serializable SHACL literal. */
export function literal(value: Literal): LiteralType {
  const record: {
    kind: 'literal'
    value: string
    datatype: string
    language?: string
    direction?: Literal['direction'] extends '' ? never : 'ltr' | 'rtl'
  } = {
    kind: 'literal',
    value: value.value,
    datatype: value.datatype.value,
  }
  if (value.language) record.language = value.language
  if (value.direction) record.direction = value.direction
  return record
}

/** Converts an RDF literal into localized human-facing text. */
export function text(value: Literal): TextType {
  const record: {
    value: string
    datatype: string
    language?: string
    direction?: 'ltr' | 'rtl'
  } = { value: value.value, datatype: value.datatype.value }
  if (value.language) record.language = value.language
  if (value.direction) record.direction = value.direction
  return record
}

/** Converts an unhandled quad into a loss-preserving assertion record. */
export function assertion(quad: Quad): AssertionType | undefined {
  const object = term(quad.object)
  if (!object) return undefined
  const subject = id(quad.subject)
  if (!subject) return undefined
  const record: { subject: IdType; predicate: string; object: TermType; graph?: IdType } = {
    subject,
    predicate: quad.predicate.value,
    object,
  }
  const graph = graphId(quad.graph)
  if (graph) record.graph = graph
  return record
}

/** Returns a serializable graph identifier when a quad belongs to a named graph. */
function graphId(graph: Graph): IdType | undefined {
  return graph.termType === 'DefaultGraph' ? undefined : id(graph)
}
