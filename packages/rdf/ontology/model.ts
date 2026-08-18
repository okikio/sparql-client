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
  /** Human-readable ontology text without its optional language metadata. */
  readonly value: string
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language?: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction?: 'ltr' | 'rtl'
}

/** Source metadata attached to ontology assertions. */
export interface SourceType {
  /** Caller-supplied source identifier retained on derived ontology assertions for provenance. */
  readonly id: string
  /** Absolute IRI represented by this record. */
  readonly iri?: string
  /** Optional source vocabulary or release version retained as provenance; the inspector does not interpret it. */
  readonly version?: string
  /** Stable source-content hash when the caller provides one for provenance or cache identity. */
  readonly hash?: string
}

/** Named ontology class and directly interpretable RDFS/OWL relationships. */
export interface ClassType {
  /** Absolute IRI represented by this record. */
  readonly iri: string
  /** Localized labels retained from the RDF source. */
  readonly labels: readonly TextType[]
  /** Localized descriptive comments retained from the RDF source. */
  readonly comments: readonly TextType[]
  /** Direct superclass IRIs declared for this class. */
  readonly superClasses: readonly string[]
  /** Class IRIs declared equivalent to this class. */
  readonly equivalentClasses: readonly string[]
  /** Class IRIs declared disjoint with this class. */
  readonly disjointClasses: readonly string[]
  /** Whether the source explicitly marks this ontology term as deprecated. */
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
  /** Absolute IRI represented by this record. */
  readonly iri: string
  /** RDF/OWL property kinds observed for this property. */
  readonly kinds: readonly PropertyKindType[]
  /** Localized labels retained from the RDF source. */
  readonly labels: readonly TextType[]
  /** Localized descriptive comments retained from the RDF source. */
  readonly comments: readonly TextType[]
  /** Class IRIs declared as domains of this property. */
  readonly domains: readonly string[]
  /** Class or datatype IRIs declared as ranges of this property. */
  readonly ranges: readonly string[]
  /** Direct super-property IRIs declared for this property. */
  readonly superProperties: readonly string[]
  /** Property IRIs declared equivalent to this property. */
  readonly equivalentProperties: readonly string[]
  /** Property IRIs declared as inverses of this property. */
  readonly inverseOf: readonly string[]
  /** Property IRIs declared disjoint with this property. */
  readonly disjointProperties: readonly string[]
  /** OWL property characteristics, such as functional or transitive, retained as normalized identifiers. */
  readonly characteristics: readonly PropertyCharacteristicType[]
  /** Whether the source explicitly marks this ontology term as deprecated. */
  readonly deprecated: boolean
}

/** RDF assertion retained when the ontology inspector does not interpret it. */
export interface AssertionType {
  /** Stable identifier of the source document that contributed this record. */
  readonly sourceId: string
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: string
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: string
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: string
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph: string
}

/** Ontology-inspection problem that does not require discarding the source graph. */
export interface DiagnosticType {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code: 'unclassified-text' | 'unclassified-deprecation' | 'invalid-deprecation'
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
  /** Stable identifier of the source document that contributed this record. */
  readonly sourceId: string
  /** RDF term associated with this diagnostic. */
  readonly term?: string
}

/** Stable ontology intermediate representation. */
export interface ModelType {
  /** Source provenance records retained by the normalized ontology or vocabulary model. */
  readonly sources: readonly SourceType[]
  /** Normalized RDF/OWL class records discovered across the inspected sources. */
  readonly classes: readonly ClassType[]
  /** Property records or property definitions owned by this model. */
  readonly properties: readonly PropertyType[]
  /** Datatype IRIs discovered or referenced by the inspected ontology sources. */
  readonly datatypes: readonly string[]
  /** RDF assertions retained because the current semantic layer does not interpret them further. */
  readonly assertions: readonly AssertionType[]
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: readonly DiagnosticType[]
}
