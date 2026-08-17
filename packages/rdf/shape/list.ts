/** SHACL list reader with cycle and cardinality diagnostics. @module */

import { key } from '../term.ts'
import type { ObjectTerm, Subject } from '../term.ts'
import { RDF_FIRST, RDF_NIL, RDF_REST, ShapeIndex } from './index.ts'
import type { DiagnosticType, IdType } from './model.ts'

/** Limits for one SHACL list traversal. */
export interface ListOptions {
  readonly maxItems: number
  readonly diagnostics: DiagnosticType[]
  readonly shape?: IdType
  readonly predicate?: string
}

/** Read list from the supplied source while preserving caller ownership. */
export function readList(
  index: ShapeIndex,
  start: ObjectTerm,
  options: ListOptions,
): readonly ObjectTerm[] | undefined {
  if (start.termType === 'NamedNode' && start.value === RDF_NIL) return []
  if (start.termType !== 'NamedNode' && start.termType !== 'BlankNode') {
    addInvalid(options, 'SHACL list head must be an IRI or blank node.')
    return undefined
  }

  const values: ObjectTerm[] = []
  const seen = new Set<string>()
  let cursor: Subject = start

  while (!(cursor.termType === 'NamedNode' && cursor.value === RDF_NIL)) {
    const cursorKey = key(cursor)
    if (seen.has(cursorKey)) {
      options.diagnostics.push(diagnostic('list-cycle', 'SHACL list contains an rdf:rest cycle.', options))
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
      addInvalid(options, 'Each SHACL list cell must have exactly one rdf:first and one rdf:rest value.')
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
function addInvalid(options: ListOptions, message: string): void {
  options.diagnostics.push(diagnostic('invalid-list', message, options))
}

/** Appends one source-aware RDF-list diagnostic to the caller-owned collection. */
function diagnostic(
  code: DiagnosticType['code'],
  message: string,
  options: ListOptions,
): DiagnosticType {
  const value: {
    code: DiagnosticType['code']
    severity: 'error'
    message: string
    shape?: IdType
    predicate?: string
  } = { code, severity: 'error', message }
  if (options.shape) value.shape = options.shape
  if (options.predicate) value.predicate = options.predicate
  return value
}
