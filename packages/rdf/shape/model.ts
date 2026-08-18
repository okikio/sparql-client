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

import type { DirectionType } from '../term.ts'

/** SHACL language family understood by the inspector. */
export type VersionType = '1.0' | '1.2'

/** Stable serializable reference to an RDF IRI. */
export interface IriType {
  /** Identifies this shape term as an RDF IRI reference. */
  readonly kind: 'iri'
  /** Absolute RDF IRI preserved for this shape term. */
  readonly value: string
}

/** Stable serializable reference to an RDF blank node. */
export interface BlankType {
  /** Identifies this shape term as an RDF blank-node reference. */
  readonly kind: 'blank'
  /** Blank-node identifier preserved from the source shapes graph. */
  readonly value: string
}

/** RDF graph node that can identify a SHACL shape. */
export type IdType = IriType | BlankType

/** Serializable RDF literal retained by the shape model. */
export interface LiteralType {
  /** Identifies this shape term as an RDF literal. */
  readonly kind: 'literal'
  /** RDF literal lexical form preserved by the shape model. */
  readonly value: string
  /** Datatype IRI that defines how the RDF literal lexical form is interpreted. */
  readonly datatype: string
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language?: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction?: DirectionType
}

/** Serializable RDF 1.2 triple term retained by the shape model. */
export interface TripleType {
  /** Identifies this shape term as an RDF 1.2 triple term. */
  readonly kind: 'triple'
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: IdType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: string
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: TermType
}

/** Serializable RDF term used by constraints, metadata, and extensions. */
export type TermType = IriType | BlankType | LiteralType | TripleType

/** Localized human-facing SHACL text. */
export interface TextType {
  /** Human-readable SHACL text without its optional language metadata. */
  readonly value: string
  /** BCP 47 language tag associated with this localized RDF value. */
  readonly language?: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction?: DirectionType
  /** Datatype IRI that defines how the RDF literal lexical form is interpreted. */
  readonly datatype: string
}

/** SHACL property path with the complete Core path constructor family. */
export type PathType =
  | {
    /** Selects a direct predicate path. */
    readonly kind: 'predicate'
    /** Predicate IRI traversed by the path. */
    readonly iri: string
  }
  | {
    /** Selects an ordered SHACL sequence path. */
    readonly kind: 'sequence'
    /** Path components evaluated from left to right. */
    readonly items: readonly PathType[]
  }
  | {
    /** Selects a SHACL alternative path. */
    readonly kind: 'alternative'
    /** Alternative path branches accepted by the expression. */
    readonly items: readonly PathType[]
  }
  | {
    /** Selects an inverse SHACL path. */
    readonly kind: 'inverse'
    /** Path whose traversal direction is reversed. */
    readonly path: PathType
  }
  | {
    /** Selects a zero-or-more SHACL path. */
    readonly kind: 'zeroOrMore'
    /** Path that can be traversed zero or more times. */
    readonly path: PathType
  }
  | {
    /** Selects a one-or-more SHACL path. */
    readonly kind: 'oneOrMore'
    /** Path that must be traversed at least once. */
    readonly path: PathType
  }
  | {
    /** Selects a zero-or-one SHACL path. */
    readonly kind: 'zeroOrOne'
    /** Optional path that can be traversed at most once. */
    readonly path: PathType
  }
  | {
    /** Retains a path expression the current inspector cannot normalize. */
    readonly kind: 'unknown'
    /** Loss-preserving RDF term that represented the unsupported path expression. */
    readonly value: TermType
  }

/** Explicit target attached to a shape. */
export type TargetType =
  | {
    /** Selects an explicit focus-node target. */
    readonly kind: 'node'
    /** RDF node selected as the focus node. */
    readonly value: TermType
  }
  | {
    /** Selects nodes that are instances of one class. */
    readonly kind: 'class'
    /** Class IRI used by the target. */
    readonly iri: string
  }
  | {
    /** Selects subjects of one predicate. */
    readonly kind: 'subjectsOf'
    /** Predicate whose subjects become focus nodes. */
    readonly iri: string
  }
  | {
    /** Selects objects of one predicate. */
    readonly kind: 'objectsOf'
    /** Predicate whose objects become focus nodes. */
    readonly iri: string
  }
  | {
    /** Retains a SHACL 1.2 `sh:targetWhere` expression. */
    readonly kind: 'where'
    /** RDF expression used to calculate target nodes. */
    readonly expression: TermType
  }
  | {
    /** Selects nodes through another shape target. */
    readonly kind: 'shape'
    /** Referenced shape that defines the target. */
    readonly shape: IdType
  }

/** Known SHACL Core constraint retained in semantic form. */
export type ConstraintType =
  | {
    /** Selects the `sh:class` constraint component. */
    readonly kind: 'class'
    /** Class IRIs accepted for the value node. */
    readonly choices: readonly string[]
  }
  | {
    /** Selects the `sh:datatype` constraint component. */
    readonly kind: 'datatype'
    /** Datatype IRIs accepted for literal value nodes. */
    readonly choices: readonly string[]
  }
  | {
    /** Selects the `sh:nodeKind` constraint component. */
    readonly kind: 'nodeKind'
    /** Node-kind IRIs accepted for the value node. */
    readonly choices: readonly string[]
  }
  | {
    /** Selects a minimum value-count constraint. */
    readonly kind: 'minCount'
    /** Minimum number of values required by the shape. */
    readonly count: number
  }
  | {
    /** Selects a maximum value-count constraint. */
    readonly kind: 'maxCount'
    /** Maximum number of values permitted by the shape. */
    readonly count: number
  }
  | {
    /** Selects an exclusive lower-bound constraint. */
    readonly kind: 'minExclusive'
    /** RDF literal used as the exclusive lower bound. */
    readonly value: LiteralType
  }
  | {
    /** Selects an inclusive lower-bound constraint. */
    readonly kind: 'minInclusive'
    /** RDF literal used as the inclusive lower bound. */
    readonly value: LiteralType
  }
  | {
    /** Selects an exclusive upper-bound constraint. */
    readonly kind: 'maxExclusive'
    /** RDF literal used as the exclusive upper bound. */
    readonly value: LiteralType
  }
  | {
    /** Selects an inclusive upper-bound constraint. */
    readonly kind: 'maxInclusive'
    /** RDF literal used as the inclusive upper bound. */
    readonly value: LiteralType
  }
  | {
    /** Selects a minimum string-length constraint. */
    readonly kind: 'minLength'
    /** Minimum Unicode string length accepted by the constraint. */
    readonly length: number
  }
  | {
    /** Selects a maximum string-length constraint. */
    readonly kind: 'maxLength'
    /** Maximum Unicode string length accepted by the constraint. */
    readonly length: number
  }
  | {
    /** Selects a regular-expression pattern constraint. */
    readonly kind: 'pattern'
    /** Regular-expression pattern supplied by `sh:pattern`. */
    readonly pattern: string
    /** Optional regular-expression flags supplied by `sh:flags`. */
    readonly flags?: string
  }
  | {
    /** Selects the SHACL 1.2 single-line string constraint. */
    readonly kind: 'singleLine'
    /** Whether line-break characters are disallowed. */
    readonly value: boolean
  }
  | {
    /** Selects an allowed-language constraint. */
    readonly kind: 'languageIn'
    /** Language ranges accepted by the constraint. */
    readonly languages: readonly string[]
  }
  | {
    /** Selects the unique-language constraint. */
    readonly kind: 'uniqueLang'
    /** Whether at most one value per language is required. */
    readonly value: boolean
  }
  | {
    /** Selects the SHACL 1.2 member-shape constraint. */
    readonly kind: 'memberShape'
    /** Shape that every list member must satisfy. */
    readonly shape: IdType
  }
  | {
    /** Selects a minimum RDF-list length constraint. */
    readonly kind: 'minListLength'
    /** Minimum number of list members required. */
    readonly length: number
  }
  | {
    /** Selects a maximum RDF-list length constraint. */
    readonly kind: 'maxListLength'
    /** Maximum number of list members permitted. */
    readonly length: number
  }
  | {
    /** Selects the unique-list-members constraint. */
    readonly kind: 'uniqueMembers'
    /** Whether duplicate RDF list members are disallowed. */
    readonly value: boolean
  }
  | {
    /** Selects an equality constraint against another property path. */
    readonly kind: 'equals'
    /** Path whose values must equal the current value set. */
    readonly path: PathType
  }
  | {
    /** Selects a disjoint-value constraint against another property path. */
    readonly kind: 'disjoint'
    /** Path whose values must not overlap the current value set. */
    readonly path: PathType
  }
  | {
    /** Selects a subset constraint against another property path. */
    readonly kind: 'subsetOf'
    /** Path whose values must contain the current value set. */
    readonly path: PathType
  }
  | {
    /** Selects a strict ordering constraint against another property path. */
    readonly kind: 'lessThan'
    /** Path whose values provide the strict comparison target. */
    readonly path: PathType
  }
  | {
    /** Selects a non-strict ordering constraint against another property path. */
    readonly kind: 'lessThanOrEquals'
    /** Path whose values provide the comparison target. */
    readonly path: PathType
  }
  | {
    /** Selects logical negation of another shape. */
    readonly kind: 'not'
    /** Shape that the focus/value node must not satisfy. */
    readonly shape: IdType
  }
  | {
    /** Selects logical conjunction of several shapes. */
    readonly kind: 'and'
    /** Shapes that must all be satisfied. */
    readonly shapes: readonly IdType[]
  }
  | {
    /** Selects logical disjunction of several shapes. */
    readonly kind: 'or'
    /** Shapes of which at least one must be satisfied. */
    readonly shapes: readonly IdType[]
  }
  | {
    /** Selects exclusive disjunction of several shapes. */
    readonly kind: 'xone'
    /** Shapes of which exactly one must be satisfied. */
    readonly shapes: readonly IdType[]
  }
  | {
    /** Selects the `sh:node` constraint component. */
    readonly kind: 'node'
    /** Shape that each value node must satisfy. */
    readonly shape: IdType
  }
  | {
    /** Selects the `sh:property` constraint component. */
    readonly kind: 'property'
    /** Property shape applied to the current focus node. */
    readonly shape: IdType
  }
  | {
    /** Selects the SHACL 1.2 some-value constraint. */
    readonly kind: 'someValue'
    /** Shape that at least one value node must satisfy. */
    readonly shape: IdType
  }
  | {
    /** Selects qualified value-shape cardinality. */
    readonly kind: 'qualified'
    /** Shape used to classify qualified values. */
    readonly shape: IdType
    /** Minimum qualified value count, when declared. */
    readonly minCount?: number
    /** Maximum qualified value count, when declared. */
    readonly maxCount?: number
    /** Whether sibling qualified shapes must be disjoint. */
    readonly disjoint?: boolean
  }
  | {
    /** Selects the RDF 1.2 reifier-shape constraint. */
    readonly kind: 'reifierShape'
    /** Shape applied to reifiers of the value statement. */
    readonly shape: IdType
  }
  | {
    /** Selects the RDF 1.2 reification-required constraint. */
    readonly kind: 'reificationRequired'
    /** Whether a matching reifier is required. */
    readonly value: boolean
  }
  | {
    /** Selects a closed-shape constraint. */
    readonly kind: 'closed'
    /** Closed-mode flag or SHACL 1.2 type-derived mode. */
    readonly mode: boolean | 'byTypes'
    /** Predicate IRIs ignored when checking undeclared properties. */
    readonly ignoredProperties: readonly string[]
  }
  | {
    /** Selects a required-value constraint. */
    readonly kind: 'hasValue'
    /** RDF value that must be present. */
    readonly value: TermType
  }
  | {
    /** Selects an enumeration constraint. */
    readonly kind: 'in'
    /** RDF values accepted by the enumeration. */
    readonly values: readonly TermType[]
  }
  | {
    /** Selects the SHACL 1.2 root-class constraint. */
    readonly kind: 'rootClass'
    /** Root class IRI used for hierarchy membership. */
    readonly iri: string
  }
  | {
    /** Selects the SHACL 1.2 unique-values-for constraint. */
    readonly kind: 'uniqueValuesFor'
    /** Property paths whose combined values must remain unique. */
    readonly paths: readonly PathType[]
  }

/** Non-validating and extension-facing metadata retained on one shape. */
export interface MetadataType {
  /** Localized names retained for display, documentation, or generated symbols. */
  readonly names: readonly TextType[]
  /** Localized descriptive text retained from SHACL metadata. */
  readonly descriptions: readonly TextType[]
  /** Human-facing SHACL intent annotations retained as metadata. */
  readonly intents: readonly TextType[]
  /** Agent instruction annotations retained as data. The library never executes them. */
  readonly agentInstructions: readonly TextType[]
  /** Suggested code identifiers retained from source metadata. */
  readonly codeIdentifiers: readonly string[]
  /** Unit RDF terms associated with the shape metadata. */
  readonly units: readonly TermType[]
  /** Ordering literals retained without coercing provider-specific numeric semantics. */
  readonly order: readonly LiteralType[]
  /** SHACL group identifiers associated with this shape. */
  readonly groups: readonly IdType[]
  /** Value expressions retained from source metadata. */
  readonly values: readonly TermType[]
  /** Default-value expressions retained from source metadata. */
  readonly defaultValues: readonly TermType[]
}

/** One assertion the current Core inspector intentionally does not interpret. */
export interface AssertionType {
  /** RDF subject term represented by this statement, pattern, or index entry. */
  readonly subject: IdType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate: string
  /** RDF object term represented by this statement, pattern, or index entry. */
  readonly object: TermType
  /** RDF graph name represented by this quad, statement, or query target. */
  readonly graph?: IdType
}

/** Structured shape-inspection diagnostic. */
export interface DiagnosticType {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code:
    | 'invalid-shape-id'
    | 'invalid-value'
    | 'invalid-list'
    | 'list-cycle'
    | 'invalid-path'
    | 'path-cycle'
    | 'invalid-cardinality'
    | 'unsupported-version'
  /** Whether this inspection diagnostic is recoverable (`warning`) or invalidates the affected construct (`error`). */
  readonly severity: 'warning' | 'error'
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
  /** Shape identifier associated with this diagnostic when one is known. */
  readonly shape?: IdType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate?: string
}

/** One node or property shape. */
export interface ShapeType {
  /** RDF node that identifies this SHACL shape in the source graph. */
  readonly id: IdType
  /** Selects node-shape or property-shape semantics for this normalized record. */
  readonly kind: 'node' | 'property'
  /** Every named rdf:type declared for this shape, including extension types. */
  readonly types: readonly string[]
  /** SHACL property path evaluated by this property shape. Node shapes normally omit it. */
  readonly path?: PathType
  /** Explicit SHACL targets that select focus nodes for this shape. */
  readonly targets: readonly TargetType[]
  /** Explicit `sh:severity` IRI attached to this shape, when present. */
  readonly severity?: string
  /** Localized SHACL validation messages attached to this shape. */
  readonly messages: readonly TextType[]
  /**
   * Raw deactivation expression values.
   *
   * SHACL 1.0 normally uses one boolean. SHACL 1.2 generalizes this field to
   * node-expression machinery, so the inspector preserves the RDF values instead
   * of pretending they are all booleans.
   */
  readonly deactivated: readonly TermType[]
  /** SHACL Core constraints normalized for this shape. */
  readonly constraints: readonly ConstraintType[]
  /** Non-validating SHACL metadata retained for this shape. */
  readonly metadata: MetadataType
  /** RDF assertions retained because the current semantic layer does not interpret them further. */
  readonly assertions: readonly AssertionType[]
}

/** Loss-preserving SHACL shapes graph intermediate representation. */
export interface GraphType {
  /** SHACL Core version used while interpreting the source shapes graph. */
  readonly version: VersionType
  /** Shapes discovered and normalized from the materialized SHACL graph. */
  readonly shapes: readonly ShapeType[]
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: readonly DiagnosticType[]
  /** RDF assertions retained because the current semantic layer does not interpret them further. */
  readonly assertions: readonly AssertionType[]
}
