/** Serializable vocabulary compiler intermediate representation. @module */

import type {
  AssertionType as OntologyAssertionType,
  ClassType as OntologyClassType,
  PropertyType as OntologyPropertyType,
  SourceType as OntologySourceType,
  TextType as OntologyTextType,
} from '@okikio/rdf/ontology'

/** Localized ontology text inherited from the generic RDF ontology model. */
export type LabelType = OntologyTextType

/** One ontology class with generator-facing symbol candidates. */
export interface ClassType extends OntologyClassType {
  /** Localized names retained for display, documentation, or generated symbols. */
  readonly names: readonly string[]
}

/** One ontology property with generator-facing symbol candidates. */
export interface PropertyType extends Omit<OntologyPropertyType, 'characteristics'> {
  /** Localized names retained for display, documentation, or generated symbols. */
  readonly names: readonly string[]
  /** Convenience projection used by current emitters. */
  readonly functional: boolean
  /** OWL property characteristics, such as functional or transitive, retained as normalized identifiers. */
  readonly characteristics: OntologyPropertyType['characteristics']
}

/** Assertion retained when the vocabulary generator does not interpret it. */
export type AssertionType = OntologyAssertionType

/** Source metadata supplied to the ontology compiler. */
export type SourceType = OntologySourceType

/** Stable language-neutral ontology model consumed by emitters. */
export interface VocabularyModelType {
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
  readonly diagnostics: readonly string[]
}

/** Generated symbol mapping retained for collision review and provenance. */
export interface SymbolType {
  /** Vocabulary IRI represented by this generated symbol mapping. */
  readonly iri: string
  /** Vocabulary declaration category used to select the generated TypeScript representation. */
  readonly kind: 'class' | 'property' | 'datatype'
  /** Generated TypeScript export name selected for this vocabulary IRI. */
  readonly name: string
}

/** Machine-readable output manifest. */
export interface ManifestType {
  /** Manifest format revision used to validate generated vocabulary metadata. */
  readonly version: 1
  /** Generator identity and version recorded for reproducible vocabulary output. */
  readonly generator: string
  /** Human-readable vocabulary name recorded in the generated manifest. */
  readonly vocabulary: string
  /** Source provenance records retained by the normalized ontology or vocabulary model. */
  readonly sources: readonly SourceType[]
  /** Generated source symbols indexed by their vocabulary IRIs. */
  readonly symbols: readonly SymbolType[]
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: readonly string[]
}
