/**
 * Generic RDFS and OWL ontology interpretation helpers.
 *
 * The reader records named declarations and relationships without performing
 * entailment. Anonymous OWL expressions and unsupported axioms are retained as
 * assertions so a reasoner or future parser can interpret them later.
 *
 * @module
 */

export { index, OntologyIndex } from './index.ts'
export { read } from './read.ts'
export type { OntologySourceType, ReadOptions } from './read.ts'
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
