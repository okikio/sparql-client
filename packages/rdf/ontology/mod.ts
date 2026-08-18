/**
 * Generic RDFS and OWL ontology interpretation helpers.
 *
 * The inspector records named declarations and relationships without performing
 * entailment. Anonymous OWL expressions and unsupported axioms are retained as
 * assertions so a reasoner or future processor can interpret them later.
 *
 * @module
 */

export { index, OntologyIndex } from './index.ts'
export { inspect } from './inspect.ts'
export type { InspectOptionsType, OntologySourceType } from './inspect.ts'
export type {
  AssertionType,
  ClassType,
  DiagnosticType,
  ModelType,
  PropertyCharacteristicType,
  PropertyKindType,
  PropertyType,
  SourceType,
  TextType,
} from './model.ts'
