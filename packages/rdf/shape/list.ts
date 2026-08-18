/** SHACL list inspector with cycle and cardinality diagnostics. @module */

import { key } from '../term.ts'
import type { ObjectTermType, SubjectTermType } from '../term.ts'
import { RDF_FIRST, RDF_NIL, RDF_REST, ShapeIndex } from './index.ts'
import type { DiagnosticType, IdType } from './model.ts'

/** Limits for one SHACL list traversal. */
export interface ListOptionsType {
  /** Maximum RDF-list members followed before the list helper reports a limit. */
  readonly maxItems: number
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: DiagnosticType[]
  /** Owning shape identifier attached to list diagnostics. */
  readonly shape?: IdType
  /** RDF predicate IRI represented by this statement, pattern, or index entry. */
  readonly predicate?: string
}

/** Read list from the supplied source while preserving caller ownership. */
export function getList(
  index: ShapeIndex,
  start: ObjectTermType,
  options: ListOptionsType,
): readonly ObjectTermType[] | undefined {
  if (start.termType === 'NamedNode' && start.value === RDF_NIL) return []
  if (start.termType !== 'NamedNode' && start.termType !== 'BlankNode') {
    addInvalid(options, 'SHACL list head must be an IRI or blank node.')
    return undefined
  }

  const values: ObjectTermType[] = []
  const seen = new Set<string>()
  let cursor: SubjectTermType = start

  while (!(cursor.termType === 'NamedNode' && cursor.value === RDF_NIL)) {
    const cursorKey = key(cursor)
    if (seen.has(cursorKey)) {
      options.diagnostics.push(
        diagnostic('list-cycle', 'SHACL list contains an rdf:rest cycle.', options),
      )
      return undefined
    }
    seen.add(cursorKey)

    if (values.length >= options.maxItems) {
      addInvalid(options, `SHACL list exceeds the configured ${options.maxItems} item limit.`)
      return undefined
    }

    const first = index.get(cursor, RDF_FIRST)
    const rest = index.get(cursor, RDF_REST)
    if (first.length !== 1 || rest.length !== 1) {
      addInvalid(
        options,
        'Each SHACL list cell must have exactly one rdf:first and one rdf:rest value.',
      )
      return undefined
    }

    values.push(first[0]!)
    const next = rest[0]!
    if (next.termType !== 'NamedNode' && next.termType !== 'BlankNode') {
      addInvalid(options, 'rdf:rest must reference another SHACL list node.')
      return undefined
    }
    cursor = next
  }

  return values
}

/** Records a malformed RDF-list node so shape parsing can continue without silently accepting it. */
function addInvalid(options: ListOptionsType, message: string): void {
  options.diagnostics.push(diagnostic('invalid-list', message, options))
}

/** Appends one source-aware RDF-list diagnostic to the caller-owned collection. */
function diagnostic(
  code: DiagnosticType['code'],
  message: string,
  options: ListOptionsType,
): DiagnosticType {
  const value: {
    /** Stable machine-readable code for this diagnostic or failure. */
    code: DiagnosticType['code']
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
