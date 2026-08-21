/** RDF term factories and RDF/JS conversion helpers. @module */

import {
  BlankNodeValue,
  DefaultGraphValue,
  type DirectionalLanguageType,
  type GraphTermType,
  type Literal,
  LiteralValue,
  type NamedNode,
  NamedNodeValue,
  type ObjectTermType,
  type PredicateTermType,
  type Quad,
  QuadValue,
  RDF,
  type SubjectTermType,
  type Term,
  type TermType,
  type Variable,
  VariableValue,
  XSD,
} from './term.ts'

/** Default graph used when the caller does not provide an override. */
const DEFAULT_GRAPH = new DefaultGraphValue()
/** Monotonic suffix used only when the caller requests an anonymous blank-node identifier. */
let blankNodeSequence = 0
/** Random process scope allocated lazily so anonymous labels do not collide after a process restart. */
let blankNodeScope: string | undefined

/** Creates an RDF named node. */
export function namedNode(value: string): NamedNode {
  return new NamedNodeValue(value)
}

/**
 * Creates an RDF blank node.
 *
 * An omitted label receives a process-scoped random prefix plus a monotonic
 * suffix. Persisting an anonymous label and then restarting the process can
 * therefore not make the next anonymous blank node reuse `b1` and silently
 * merge two unrelated RDF resources. A caller-supplied label is preserved.
 */
export function blankNode(value?: string): ReturnType<typeof createBlankNode> {
  return createBlankNode(value ?? anonymousBlankNode())
}

/** Allocates one serialization-safe anonymous blank-node label lazily. */
function anonymousBlankNode(): string {
  blankNodeScope ??= crypto.randomUUID().replaceAll('-', '')
  return `b_${blankNodeScope}_${++blankNodeSequence}`
}

/** Creates one blank-node value without applying anonymous-label policy. */
function createBlankNode(value: string): BlankNodeValue {
  return new BlankNodeValue(value)
}

/** Creates an RDF query variable without a leading `?` or `$`. */
export function variable(value: string): Variable {
  const name = value.replace(/^[?$]/, '')
  if (!name) throw new TypeError('Variable name must not be empty.')
  return new VariableValue(name)
}

/** Returns the immutable default-graph singleton. */
export function defaultGraph(): DefaultGraphValue {
  return DEFAULT_GRAPH
}

/**
 * Creates an RDF literal.
 *
 * A string second argument is interpreted as a language tag. A named node is a
 * datatype. Directional language input uses RDF 1.2 `rdf:dirLangString`.
 */
export function literal(
  value: string,
  languageOrDatatype?: string | NamedNode | DirectionalLanguageType,
): Literal {
  if (typeof languageOrDatatype === 'string') {
    const language = normalizeLanguage(languageOrDatatype)
    return new LiteralValue(value, namedNode(RDF.langString), language)
  }

  if (languageOrDatatype !== undefined && 'termType' in languageOrDatatype) {
    if (languageOrDatatype.termType !== 'NamedNode') {
      throw new TypeError('Literal datatype must be a named node.')
    }
    return new LiteralValue(value, languageOrDatatype)
  }

  if (languageOrDatatype !== undefined) {
    const language = normalizeLanguage(languageOrDatatype.language)
    const direction = languageOrDatatype.direction ?? ''
    if (direction !== '' && direction !== 'ltr' && direction !== 'rtl') {
      throw new TypeError(`Unsupported literal direction '${String(direction)}'.`)
    }
    return new LiteralValue(
      value,
      namedNode(direction === '' ? RDF.langString : RDF.dirLangString),
      language,
      direction,
    )
  }

  return new LiteralValue(value, namedNode(XSD.string))
}

/** Creates a quad or, with the default graph, an RDF 1.2 triple term. */
export function quad(
  subject: SubjectTermType,
  predicate: PredicateTermType,
  object: ObjectTermType,
  graph: GraphTermType = DEFAULT_GRAPH,
): Quad {
  if (object.termType === 'Quad' && object.graph.termType !== 'DefaultGraph') {
    throw new TypeError('An RDF 1.2 triple term cannot contain a named graph.')
  }
  return new QuadValue(subject, predicate, object, graph)
}

/** Creates a triple term explicitly. */
export function triple(
  subject: SubjectTermType,
  predicate: PredicateTermType,
  object: ObjectTermType,
): Quad {
  return quad(subject, predicate, object)
}

/** Copies an RDF/JS-compatible term into this implementation. */
export function fromTerm(original: Term): TermType {
  switch (original.termType) {
    case 'NamedNode':
      return namedNode(original.value)
    case 'BlankNode':
      return blankNode(original.value)
    case 'Variable':
      return variable(original.value)
    case 'DefaultGraph':
      return defaultGraph()
    case 'Literal': {
      const value = original as Literal
      if (value.direction) {
        return literal(value.value, { language: value.language, direction: value.direction })
      }
      if (value.language) return literal(value.value, value.language)
      return literal(value.value, namedNode(value.datatype.value))
    }
    case 'Quad':
      return fromQuad(original as Quad)
  }
}

/** Copies an RDF/JS-compatible quad recursively. */
export function fromQuad(original: Quad): Quad {
  return quad(
    fromTerm(original.subject) as SubjectTermType,
    fromTerm(original.predicate) as PredicateTermType,
    fromTerm(original.object) as ObjectTermType,
    fromTerm(original.graph) as GraphTermType,
  )
}

/** RDF/JS-compatible data factory object for APIs that expect one. */
export const factory = {
  namedNode,
  blankNode,
  literal,
  variable,
  defaultGraph,
  quad,
  fromTerm,
  fromQuad,
} as const

/** Trims and lowercases a required BCP47-style language token without guessing invalid empty values. */
function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) throw new TypeError('Language tag must not be empty.')
  return normalized
}
