/** SHACL Core property-path inspector. @module */

import { key } from '../term.ts'
import type { ObjectTermType, SubjectTermType } from '../term.ts'
import { ShapeIndex } from './index.ts'
import { getList } from './list.ts'
import type { DiagnosticType, IdType, PathType } from './model.ts'
import { term } from './value.ts'

/** SHACL namespace used to recognize Core property-path predicates. */
const SH = 'http://www.w3.org/ns/shacl#'
/** SHACL predicates whose blank-node objects encode compound property-path operators. */
const PATH_PREDICATES = [
  `${SH}alternativePath`,
  `${SH}inversePath`,
  `${SH}zeroOrMorePath`,
  `${SH}oneOrMorePath`,
  `${SH}zeroOrOnePath`,
] as const

/** Limits and diagnostics shared by recursive path parsing. */
export interface PathOptionsType {
  /** Maximum recursive SHACL property-path depth followed before inspection reports a limit. */
  readonly maxDepth: number
  /** Maximum RDF-list members followed from one list before inspection reports a limit. */
  readonly maxListItems: number
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: DiagnosticType[]
  /** Owning shape identifier attached to path diagnostics. */
  readonly shape?: IdType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate?: string
}

/** Parses one RDF term as a SHACL Core property path. */
export function getPath(
  index: ShapeIndex,
  value: ObjectTermType,
  options: PathOptionsType,
): PathType {
  return getPathAt(index, value, options, new Set(), 0)
}

/** Read path at from the supplied source while preserving caller ownership. */
function getPathAt(
  index: ShapeIndex,
  value: ObjectTermType,
  options: PathOptionsType,
  active: Set<string>,
  depth: number,
): PathType {
  if (value.termType === 'NamedNode' && !index.isList(value) && !hasConstructor(index, value)) {
    return { kind: 'predicate', iri: value.value }
  }

  if (value.termType !== 'NamedNode' && value.termType !== 'BlankNode') {
    return unknown(value, options, 'SHACL path must be an IRI or blank node.')
  }
  if (depth >= options.maxDepth) {
    return unknown(
      value,
      options,
      `SHACL path exceeds the configured depth limit of ${options.maxDepth}.`,
    )
  }

  const subject = value as SubjectTermType
  const subjectKey = key(subject)
  if (active.has(subjectKey)) {
    options.diagnostics.push(
      pathDiagnostic('path-cycle', 'SHACL property path contains a cycle.', options),
    )
    return unknownValue(value)
  }
  const nextActive = new Set(active)
  nextActive.add(subjectKey)

  if (index.isList(subject)) {
    const values = getList(index, subject, listOptions(options))
    if (!values || values.length < 2) {
      return unknown(
        value,
        options,
        'A SHACL sequence path must contain at least two path members.',
      )
    }
    return {
      kind: 'sequence',
      items: values.map((item) => getPathAt(index, item, options, nextActive, depth + 1)),
    }
  }

  const constructors = PATH_PREDICATES.flatMap((predicate) =>
    index.get(subject, predicate).map((object) => ({ predicate, object }))
  )
  if (constructors.length !== 1) {
    return unknown(
      value,
      options,
      'A blank-node SHACL path must have exactly one Core path constructor.',
    )
  }
  const constructor = constructors[0]!

  if (constructor.predicate === `${SH}alternativePath`) {
    const values = getList(index, constructor.object, listOptions(options))
    if (!values || values.length < 2) {
      return unknown(
        value,
        options,
        'sh:alternativePath must reference a list with at least two members.',
      )
    }
    return {
      kind: 'alternative',
      items: values.map((item) => getPathAt(index, item, options, nextActive, depth + 1)),
    }
  }

  const child = getPathAt(index, constructor.object, options, nextActive, depth + 1)
  if (constructor.predicate === `${SH}inversePath`) return { kind: 'inverse', path: child }
  if (constructor.predicate === `${SH}zeroOrMorePath`) return { kind: 'zeroOrMore', path: child }
  if (constructor.predicate === `${SH}oneOrMorePath`) return { kind: 'oneOrMore', path: child }
  return { kind: 'zeroOrOne', path: child }
}

/** Detects whether a blank-node path uses one of the SHACL path constructor predicates. */
function hasConstructor(index: ShapeIndex, subject: SubjectTermType): boolean {
  return PATH_PREDICATES.some((predicate) => index.get(subject, predicate).length > 0)
}

/** Retains an unrecognized path node as a loss-preserving unknown path record. */
function unknown(value: ObjectTermType, options: PathOptionsType, message: string): PathType {
  options.diagnostics.push(pathDiagnostic('invalid-path', message, options))
  return unknownValue(value)
}

/** Retains a path assertion whose value cannot be normalized by the current SHACL profile. */
function unknownValue(value: ObjectTermType): PathType {
  const record = term(value)
  if (!record) throw new TypeError('SHACL path term could not be represented.')
  return { kind: 'unknown', value: record }
}

/** Projects property-path inspection state into the shared RDF-list traversal options. */
function listOptions(options: PathOptionsType) {
  const value: {
    /** Maximum RDF-list members traversed while decoding this SHACL property path. */
    maxItems: number
    /** Shared diagnostic sink that receives invalid-list and path-cycle reports. */
    diagnostics: DiagnosticType[]
    /** SHACL shape identifier associated with this constraint or diagnostic. */
    shape?: IdType
    /** RDF predicate IRI represented by this statement or operation filter. */
    predicate?: string
  } = { maxItems: options.maxListItems, diagnostics: options.diagnostics }
  if (options.shape) value.shape = options.shape
  if (options.predicate) value.predicate = options.predicate
  return value
}

/** Records a path-specific diagnostic without discarding the underlying SHACL assertion. */
function pathDiagnostic(
  code: 'invalid-path' | 'path-cycle',
  message: string,
  options: PathOptionsType,
): DiagnosticType {
  const value: {
    /** Stable machine-readable code for this diagnostic or failure. */
    code: 'invalid-path' | 'path-cycle'
    /** Diagnostic severity used to decide whether inspection can continue. */
    severity: 'error'
    /** Human-readable explanation of this SHACL inspection diagnostic. */
    message: string
    /** SHACL shape identifier associated with this constraint or diagnostic. */
    shape?: IdType
    /** RDF predicate IRI represented by this statement or operation filter. */
    predicate?: string
  } = { code, severity: 'error', message }
  if (options.shape) value.shape = options.shape
  if (options.predicate) value.predicate = options.predicate
  return value
}
