/**
 * RDF 1.2-compatible term contracts with RDF/JS interoperability.
 *
 * The public objects stay semantic and immutable. Storage engines may map them
 * to integer IDs or packed records internally, but those representations must
 * not leak through this module.
 *
 * @module
 */

/** Initial text direction attached to an RDF 1.2 directional language string. */
export type DirectionType = 'ltr' | 'rtl'

/** RDF/JS-compatible base term. */
export interface Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'NamedNode' | 'BlankNode' | 'Literal' | 'Variable' | 'DefaultGraph' | 'Quad'
  /** RDF/JS lexical value. DefaultGraph and Quad use the required empty string. */
  readonly value: string
  /** Returns whether the supplied RDF term is term-equal to this term. */
  equals(other?: Term | null): boolean
}

/** An RDF IRI term. */
export interface NamedNode extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'NamedNode'
}

/** An RDF blank node. */
export interface BlankNode extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'BlankNode'
}

/** An RDF query variable used by RDF/JS-compatible query surfaces. */
export interface Variable extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'Variable'
}

/** The default graph name. */
export interface DefaultGraph extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'DefaultGraph'
  /** RDF/JS requires the default graph value to be the empty string. */
  readonly value: ''
}

/** RDF 1.2 literal, including optional language direction. */
export interface Literal extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'Literal'
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction: DirectionType | ''
  /** Datatype IRI that defines how the RDF literal lexical form is interpreted. */
  readonly datatype: NamedNode
}

/** RDF triple subject. RDF 1.2 triple terms are object terms, not graph subjects. */
export type SubjectTermType = NamedNode | BlankNode

/** RDF triple predicate. */
export type PredicateTermType = NamedNode

/** RDF triple object, including RDF 1.2 triple terms. */
export type ObjectTermType = NamedNode | BlankNode | Literal | Quad

/** RDF dataset graph name. */
export type GraphTermType = DefaultGraph | NamedNode | BlankNode

/**
 * RDF/JS-compatible quad.
 *
 * A triple term is represented by a Quad whose graph is the default graph. The
 * factory rejects non-default graphs when a Quad is embedded as another
 * triple's object so the native model remains consistent with RDF 1.2.
 */
export interface Quad extends Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType: 'Quad'
  /** RDF/JS requires a Quad term value to be the empty string. */
  readonly value: ''
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: SubjectTermType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: PredicateTermType
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: ObjectTermType
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph: GraphTermType
}

/** Any public RDF term. */
export type TermType = NamedNode | BlankNode | Literal | Variable | DefaultGraph | Quad

/** RDF/JS-compatible directional-language factory input. */
export interface DirectionalLanguageType {
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction?: DirectionType | null
}

/** RDF namespace constants used by the core term model. */
export const RDF = {
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  statement: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement',
  subject: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#subject',
  predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate',
  object: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#object',
  langString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
  dirLangString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString',
  first: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first',
  rest: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest',
  reifies: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies',
  nil: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil',
} as const

/** XML Schema namespace constants needed by the core literal factory. */
export const XSD = {
  string: 'http://www.w3.org/2001/XMLSchema#string',
  boolean: 'http://www.w3.org/2001/XMLSchema#boolean',
  integer: 'http://www.w3.org/2001/XMLSchema#integer',
  decimal: 'http://www.w3.org/2001/XMLSchema#decimal',
  double: 'http://www.w3.org/2001/XMLSchema#double',
  date: 'http://www.w3.org/2001/XMLSchema#date',
  dateTime: 'http://www.w3.org/2001/XMLSchema#dateTime',
} as const

/** Base immutable term implementation. */
abstract class BaseTerm implements Term {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  abstract readonly termType: Term['termType']

  /** Immutable lexical value used by simple RDF-term equality. */
  readonly value: string

  /** Stores the immutable lexical value shared by concrete RDF term implementations. */
  constructor(value: string) {
    this.value = value
  }

  /** Compares simple RDF terms by term kind and lexical value. */
  equals(other?: Term | null): boolean {
    return other !== null && other !== undefined && this.termType === other.termType &&
      this.value === other.value
  }
}

/** Immutable named-node implementation. */
export class NamedNodeValue extends BaseTerm implements NamedNode {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'NamedNode' as const
}

/** Immutable blank-node implementation. */
export class BlankNodeValue extends BaseTerm implements BlankNode {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'BlankNode' as const
}

/** Immutable variable implementation. */
export class VariableValue extends BaseTerm implements Variable {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'Variable' as const
}

/** Immutable default-graph singleton implementation. */
export class DefaultGraphValue extends BaseTerm implements DefaultGraph {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'DefaultGraph' as const
  /** Required empty RDF/JS value for the default graph singleton. */
  override readonly value = '' as const

  /** Creates the RDF default graph singleton value with the required empty lexical form. */
  constructor() {
    super('')
  }

  /** Treats every RDF/JS-compatible DefaultGraph term as term-equal. */
  override equals(other?: Term | null): boolean {
    return other?.termType === 'DefaultGraph'
  }
}

/** Immutable RDF literal implementation. */
export class LiteralValue extends BaseTerm implements Literal {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'Literal' as const
  /** Datatype IRI that defines how the RDF literal lexical form is interpreted. */
  readonly datatype: NamedNode
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction: DirectionType | ''

  /** Stores literal lexical form, datatype, language, and RDF 1.2 base direction without coercion. */
  constructor(
    value: string,
    datatype: NamedNode,
    language = '',
    direction: DirectionType | '' = '',
  ) {
    super(value)
    this.datatype = datatype
    this.language = language
    this.direction = direction
  }

  /** Applies RDF literal term equality, including case-insensitive language tags and exact direction. */
  override equals(other?: Term | null): boolean {
    if (other?.termType !== 'Literal') return false
    const literal = other as Literal
    return this.value === literal.value &&
      this.datatype.equals(literal.datatype) &&
      this.language.toLowerCase() === literal.language.toLowerCase() &&
      this.direction === literal.direction
  }
}

/** Immutable quad and triple-term implementation. */
export class QuadValue extends BaseTerm implements Quad {
  /** RDF/JS term-kind discriminator used for standards-compatible term interoperability. */
  readonly termType = 'Quad' as const
  /** Required empty RDF/JS value for quad and triple-term objects. */
  override readonly value = '' as const
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: SubjectTermType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: PredicateTermType
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: ObjectTermType
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph: GraphTermType

  /** Stores one immutable quad; default-graph quads can also represent RDF 1.2 triple terms. */
  constructor(
    subject: SubjectTermType,
    predicate: PredicateTermType,
    object: ObjectTermType,
    graph: GraphTermType,
  ) {
    super('')
    this.subject = subject
    this.predicate = predicate
    this.object = object
    this.graph = graph
  }

  /** Compares every quad component recursively using RDF term equality. */
  override equals(other?: Term | null): boolean {
    if (other?.termType !== 'Quad') return false
    const quad = other as Quad
    return this.subject.equals(quad.subject) &&
      this.predicate.equals(quad.predicate) &&
      this.object.equals(quad.object) &&
      this.graph.equals(quad.graph)
  }
}

/** Returns whether a value follows the RDF/JS term contract. */
export function isTerm(value: unknown): value is TermType {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Term>
  return typeof candidate.termType === 'string' && typeof candidate.value === 'string' &&
    typeof candidate.equals === 'function'
}

/** Returns whether two RDF terms are term-equal. */
export function equals(left: Term, right: Term): boolean {
  return left.equals(right)
}

/**
 * Returns a collision-safe semantic key for one RDF term.
 *
 * Length prefixes prevent delimiter collisions and make the key suitable for
 * Maps and persistent dictionaries without depending on one serialization.
 */
export function key(term: Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return atom('N', term.value)
    case 'BlankNode':
      return atom('B', term.value)
    case 'Variable':
      return atom('V', term.value)
    case 'DefaultGraph':
      return 'D'
    case 'Literal': {
      const literal = term as Literal
      return `L${atom('', literal.value)}${atom('', literal.datatype.value)}${
        atom('', literal.language.toLowerCase())
      }${atom('', literal.direction)}`
    }
    case 'Quad': {
      const quad = term as Quad
      return `Q${atom('', key(quad.subject))}${atom('', key(quad.predicate))}${
        atom('', key(quad.object))
      }${atom('', key(quad.graph))}`
    }
  }
}

/** Length-prefixes a string so nested term keys remain unambiguous. */
function atom(prefix: string, value: string): string {
  return `${prefix}${value.length}:${value}`
}
