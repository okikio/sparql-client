/**
 * Serializable RDFS/OWL ontology model.
 *
 * This model represents named ontology declarations and relationships that can
 * be interpreted without OWL reasoning. Anonymous class expressions and other
 * unsupported axioms remain in {@link AssertionType} so later OWL layers do not
 * lose the source graph.
 *
 * @module
 */

/** Localized ontology text. */
export interface TextType {
  readonly value: string
  readonly language?: string
  readonly direction?: 'ltr' | 'rtl'
}

/** Source metadata attached to ontology assertions. */
export interface SourceType {
  readonly id: string
  readonly iri?: string
  readonly version?: string
  readonly hash?: string
}

/** Named ontology class and directly interpretable RDFS/OWL relationships. */
export interface ClassType {
  readonly iri: string
  readonly labels: readonly TextType[]
  readonly comments: readonly TextType[]
  readonly superClasses: readonly string[]
  readonly equivalentClasses: readonly string[]
  readonly disjointClasses: readonly string[]
  readonly deprecated: boolean
}

/** Declared property flavor. A property can have more than one RDF/OWL type. */
export type PropertyKindType = 'rdf' | 'object' | 'data' | 'annotation'

/** OWL characteristics that can be stated directly on a named property. */
export type PropertyCharacteristicType =
  | 'functional'
  | 'inverseFunctional'
  | 'transitive'
  | 'symmetric'
  | 'asymmetric'
  | 'reflexive'
  | 'irreflexive'

/** Named RDF/OWL property. */
export interface PropertyType {
  readonly iri: string
  readonly kinds: readonly PropertyKindType[]
  readonly labels: readonly TextType[]
  readonly comments: readonly TextType[]
  readonly domains: readonly string[]
  readonly ranges: readonly string[]
  readonly superProperties: readonly string[]
  readonly equivalentProperties: readonly string[]
  readonly inverseOf: readonly string[]
  readonly disjointProperties: readonly string[]
  readonly characteristics: readonly PropertyCharacteristicType[]
  readonly deprecated: boolean
}

/** RDF assertion retained when this reader does not interpret it. */
export interface AssertionType {
  readonly sourceId: string
  readonly subject: string
  readonly predicate: string
  readonly object: string
  readonly graph: string
}

/** Ontology-reader problem that does not require discarding the source graph. */
export interface DiagnosticType {
  readonly code: 'unclassified-text' | 'unclassified-deprecation' | 'invalid-deprecation'
  readonly message: string
  readonly sourceId: string
  readonly term?: string
}

/** Stable ontology intermediate representation. */
export interface ModelType {
  readonly sources: readonly SourceType[]
  readonly classes: readonly ClassType[]
  readonly properties: readonly PropertyType[]
  readonly datatypes: readonly string[]
  readonly assertions: readonly AssertionType[]
  readonly diagnostics: readonly DiagnosticType[]
}
