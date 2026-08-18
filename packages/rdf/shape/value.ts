/** Serializable RDF term conversion for the SHACL model. @module */

import type { GraphTermType, Literal, Quad, Term } from '../term.ts'
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
    /** Selects the `literal` variant of record. */
    kind: 'literal'
    /** RDF literal lexical form preserved in the temporary serializable record. */
    value: string
    /** Datatype IRI associated with this RDF literal value. */
    datatype: string
    /** BCP 47 language tag retained for this localized RDF value. */
    language?: string
    /** RDF 1.2 base text direction retained for this localized RDF value. */
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
    /** Literal lexical form preserved as human-facing SHACL text. */
    value: string
    /** Datatype IRI associated with this RDF literal value. */
    datatype: string
    /** BCP 47 language tag retained for this localized RDF value. */
    language?: string
    /** RDF 1.2 base text direction retained for this localized RDF value. */
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
  const record: {
    /** RDF subject term represented by this statement or operation filter. */
    subject: IdType
    /** RDF predicate IRI represented by this statement or operation filter. */
    predicate: string
    /** RDF object term represented by this statement or operation filter. */
    object: TermType
    /** RDF graph that receives quads produced by SHACL inspection. */
    graph?: IdType
  } = {
    subject,
    predicate: quad.predicate.value,
    object,
  }
  const graph = graphId(quad.graph)
  if (graph) record.graph = graph
  return record
}

/** Returns a serializable graph identifier when a quad belongs to a named graph. */
function graphId(graph: GraphTermType): IdType | undefined {
  return graph.termType === 'DefaultGraph' ? undefined : id(graph)
}
