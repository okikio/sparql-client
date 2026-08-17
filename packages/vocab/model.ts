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
  readonly names: readonly string[]
}

/** One ontology property with generator-facing symbol candidates. */
export interface PropertyType extends Omit<OntologyPropertyType, 'characteristics'> {
  readonly names: readonly string[]
  /** Convenience projection used by current emitters. */
  readonly functional: boolean
  readonly characteristics: OntologyPropertyType['characteristics']
}

/** Assertion retained when the vocabulary generator does not interpret it. */
export type AssertionType = OntologyAssertionType

/** Source metadata supplied to the ontology compiler. */
export type SourceType = OntologySourceType

/** Stable language-neutral ontology model consumed by emitters. */
export interface VocabularyModelType {
  readonly sources: readonly SourceType[]
  readonly classes: readonly ClassType[]
  readonly properties: readonly PropertyType[]
  readonly datatypes: readonly string[]
  readonly assertions: readonly AssertionType[]
  readonly diagnostics: readonly string[]
}

/** Generated symbol mapping retained for collision review and provenance. */
export interface SymbolType {
  readonly iri: string
  readonly kind: 'class' | 'property' | 'datatype'
  readonly name: string
}

/** Machine-readable output manifest. */
export interface ManifestType {
  readonly version: 1
  readonly generator: string
  readonly vocabulary: string
  readonly sources: readonly SourceType[]
  readonly symbols: readonly SymbolType[]
  readonly diagnostics: readonly string[]
}
