/**
 * Versioned, serializable SHACL shape model.
 *
 * The model captures SHACL Core structure without making validation claims.
 * Values that belong to newer extension specifications, such as node
 * expressions, remain lossless RDF term records until a focused evaluator owns
 * their semantics.
 *
 * @module
 */

import type { Direction } from '../term.ts'

/** SHACL language family understood by the reader. */
export type VersionType = '1.0' | '1.2'

/** Stable serializable reference to an RDF IRI. */
export interface IriType {
  readonly kind: 'iri'
  readonly value: string
}

/** Stable serializable reference to an RDF blank node. */
export interface BlankType {
  readonly kind: 'blank'
  readonly value: string
}

/** RDF graph node that can identify a SHACL shape. */
export type IdType = IriType | BlankType

/** Serializable RDF literal retained by the shape model. */
export interface LiteralType {
  readonly kind: 'literal'
  readonly value: string
  readonly datatype: string
  readonly language?: string
  readonly direction?: Direction
}

/** Serializable RDF 1.2 triple term retained by the shape model. */
export interface TripleType {
  readonly kind: 'triple'
  readonly subject: IdType
  readonly predicate: string
  readonly object: TermType
}

/** Serializable RDF term used by constraints, metadata, and extensions. */
export type TermType = IriType | BlankType | LiteralType | TripleType

/** Localized human-facing SHACL text. */
export interface TextType {
  readonly value: string
  readonly language?: string
  readonly direction?: Direction
  readonly datatype: string
}

/** SHACL property path with the complete Core path constructor family. */
export type PathType =
  | { readonly kind: 'predicate'; readonly iri: string }
  | { readonly kind: 'sequence'; readonly items: readonly PathType[] }
  | { readonly kind: 'alternative'; readonly items: readonly PathType[] }
  | { readonly kind: 'inverse'; readonly path: PathType }
  | { readonly kind: 'zeroOrMore'; readonly path: PathType }
  | { readonly kind: 'oneOrMore'; readonly path: PathType }
  | { readonly kind: 'zeroOrOne'; readonly path: PathType }
  | { readonly kind: 'unknown'; readonly value: TermType }

/** Explicit target attached to a shape. */
export type TargetType =
  | { readonly kind: 'node'; readonly value: TermType }
  | { readonly kind: 'class'; readonly iri: string }
  | { readonly kind: 'subjectsOf'; readonly iri: string }
  | { readonly kind: 'objectsOf'; readonly iri: string }
  | { readonly kind: 'where'; readonly expression: TermType }
  | { readonly kind: 'shape'; readonly shape: IdType }

/** Known SHACL Core constraint retained in semantic form. */
export type ConstraintType =
  | { readonly kind: 'class'; readonly choices: readonly string[] }
  | { readonly kind: 'datatype'; readonly choices: readonly string[] }
  | { readonly kind: 'nodeKind'; readonly choices: readonly string[] }
  | { readonly kind: 'minCount'; readonly count: number }
  | { readonly kind: 'maxCount'; readonly count: number }
  | { readonly kind: 'minExclusive'; readonly value: LiteralType }
  | { readonly kind: 'minInclusive'; readonly value: LiteralType }
  | { readonly kind: 'maxExclusive'; readonly value: LiteralType }
  | { readonly kind: 'maxInclusive'; readonly value: LiteralType }
  | { readonly kind: 'minLength'; readonly length: number }
  | { readonly kind: 'maxLength'; readonly length: number }
  | { readonly kind: 'pattern'; readonly pattern: string; readonly flags?: string }
  | { readonly kind: 'singleLine'; readonly value: boolean }
  | { readonly kind: 'languageIn'; readonly languages: readonly string[] }
  | { readonly kind: 'uniqueLang'; readonly value: boolean }
  | { readonly kind: 'memberShape'; readonly shape: IdType }
  | { readonly kind: 'minListLength'; readonly length: number }
  | { readonly kind: 'maxListLength'; readonly length: number }
  | { readonly kind: 'uniqueMembers'; readonly value: boolean }
  | { readonly kind: 'equals'; readonly path: PathType }
  | { readonly kind: 'disjoint'; readonly path: PathType }
  | { readonly kind: 'subsetOf'; readonly path: PathType }
  | { readonly kind: 'lessThan'; readonly path: PathType }
  | { readonly kind: 'lessThanOrEquals'; readonly path: PathType }
  | { readonly kind: 'not'; readonly shape: IdType }
  | { readonly kind: 'and'; readonly shapes: readonly IdType[] }
  | { readonly kind: 'or'; readonly shapes: readonly IdType[] }
  | { readonly kind: 'xone'; readonly shapes: readonly IdType[] }
  | { readonly kind: 'node'; readonly shape: IdType }
  | { readonly kind: 'property'; readonly shape: IdType }
  | { readonly kind: 'someValue'; readonly shape: IdType }
  | {
      readonly kind: 'qualified'
      readonly shape: IdType
      readonly minCount?: number
      readonly maxCount?: number
      readonly disjoint?: boolean
    }
  | { readonly kind: 'reifierShape'; readonly shape: IdType }
  | { readonly kind: 'reificationRequired'; readonly value: boolean }
  | {
      readonly kind: 'closed'
      readonly mode: boolean | 'byTypes'
      readonly ignoredProperties: readonly string[]
    }
  | { readonly kind: 'hasValue'; readonly value: TermType }
  | { readonly kind: 'in'; readonly values: readonly TermType[] }
  | { readonly kind: 'rootClass'; readonly iri: string }
  | { readonly kind: 'uniqueValuesFor'; readonly paths: readonly PathType[] }

/** Non-validating and extension-facing metadata retained on one shape. */
export interface MetadataType {
  readonly names: readonly TextType[]
  readonly descriptions: readonly TextType[]
  readonly intents: readonly TextType[]
  readonly agentInstructions: readonly TextType[]
  readonly codeIdentifiers: readonly string[]
  readonly units: readonly TermType[]
  readonly order: readonly LiteralType[]
  readonly groups: readonly IdType[]
  readonly values: readonly TermType[]
  readonly defaultValues: readonly TermType[]
}

/** One assertion the current Core reader intentionally does not interpret. */
export interface AssertionType {
  readonly subject: IdType
  readonly predicate: string
  readonly object: TermType
  readonly graph?: IdType
}

/** Structured shape-reader diagnostic. */
export interface DiagnosticType {
  readonly code:
    | 'invalid-shape-id'
    | 'invalid-value'
    | 'invalid-list'
    | 'list-cycle'
    | 'invalid-path'
    | 'path-cycle'
    | 'invalid-cardinality'
    | 'unsupported-version'
  readonly severity: 'warning' | 'error'
  readonly message: string
  readonly shape?: IdType
  readonly predicate?: string
}

/** One node or property shape. */
export interface ShapeType {
  readonly id: IdType
  readonly kind: 'node' | 'property'
  /** Every named rdf:type declared for this shape, including extension types. */
  readonly types: readonly string[]
  readonly path?: PathType
  readonly targets: readonly TargetType[]
  readonly severity?: string
  readonly messages: readonly TextType[]
  /**
   * Raw deactivation expression values.
   *
   * SHACL 1.0 normally uses one boolean. SHACL 1.2 generalizes this field to
   * node-expression machinery, so the reader preserves the RDF values instead
   * of pretending they are all booleans.
   */
  readonly deactivated: readonly TermType[]
  readonly constraints: readonly ConstraintType[]
  readonly metadata: MetadataType
  readonly assertions: readonly AssertionType[]
}

/** Loss-preserving SHACL shapes graph intermediate representation. */
export interface GraphType {
  readonly version: VersionType
  readonly shapes: readonly ShapeType[]
  readonly diagnostics: readonly DiagnosticType[]
  readonly assertions: readonly AssertionType[]
}
