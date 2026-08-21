/**
 * Basic triple pattern construction.
 *
 * SPARQL queries are built from triple patterns (subject-predicate-object). Writing
 * these by hand means lots of repetitive code. These helpers let you construct
 * triples programmatically with less boilerplate.
 *
 * Think of triples as the sentences of your graph query. Each triple makes a statement
 * about a resource. The functions here help you write those statements concisely.
 *
 * @module
 */

import { isTerm as isRdfTerm, type Term as RdfTerm } from '@okikio/rdf'
import type { PatternValueType, PredicateInputType, SparqlTermType } from '../sparql.ts'
import {
  isVariableToken,
  rawPattern,
  rawTerm,
  rdfTerm,
  toPredicateName,
  toPredicateToken,
  toVarToken,
} from '../sparql.ts'
import { type ExpressionPrimitiveType, termString } from '../utils.ts'

// ============================================================================
// Triple Component Types
// ============================================================================

/**
 * Subject of a triple pattern.
 *
 * Can be a variable (?person), an IRI (<http://...>), or a blank node.
 * Most often you'll use variables to match multiple resources.
 */
export type TripleSubjectType = string | SparqlTermType | RdfTerm

/**
 * Predicate of a triple pattern.
 *
 * Can be a prefixed name (foaf:name), full IRI, or variable. Predicates
 * describe relationships or properties.
 */
export type TriplePredicateType = PredicateInputType

/**
 * Values that are allowed in the object position of a triple, per SPARQL.
 *
 * Object can be:
 * - a variable
 * - an IRI or prefixed name
 * - a literal
 * - a blank node
 */
export type TripleObjectType =
  | SparqlTermType
  | RdfTerm
  | ExpressionPrimitiveType

/**
 * Serializes one triple subject without position-dependent variable coercion.
 *
 * A variable must be explicit as `?name`, `$name`, or an RDF/SPARQL variable
 * value. Plain strings are graph terms. A bare local string therefore uses the
 * project's existing default-prefix shorthand (`item` -> `:item`) instead of
 * silently becoming `?item`. This keeps the same string from changing meaning
 * only because it moved between subject and object position.
 */
export function tripleSubjectString(subject: TripleSubjectType): string {
  if (typeof subject === 'string') {
    const value = subject.trim()
    return /^[?$]/.test(value) ? toVarToken(value) : toPredicateName(value)
  }
  if (isRdfTerm(subject)) return rdfTerm(subject)
  return subject.value
}

/**
 * Serializes one triple object.
 *
 * Plain strings remain escaped string literals. Only `?name` and `$name`
 * strings are treated as variables. RDF/SPARQL term values keep their explicit
 * semantics.
 */
export function tripleObjectString(object: TripleObjectType): string {
  if (isRdfTerm(object)) return rdfTerm(object)
  if (typeof object === 'string') {
    const value = object.trim()
    if (isVariableToken(value)) return toVarToken(value)
    // A leading variable sigil is an explicit syntax choice. Reject malformed
    // variables instead of silently changing their meaning to a string literal.
    if (/^[?$]/.test(value)) return toVarToken(value)
  }
  return termString(object as SparqlTermType | ExpressionPrimitiveType, 'object')
}

/** Converts a predicate input without flattening RDF named nodes to strings. */
function predicateString(predicate: TriplePredicateType): string {
  return toPredicateToken(predicate)
}

// ============================================================================
// Triple Construction
// ============================================================================

/**
 * Create a single triple pattern.
 *
 * This is the basic building block of SPARQL queries. A triple makes a statement
 * about a resource - who they are, what properties they have, how they relate
 * to other resources.
 *
 * The pattern will match any data in your graph that fits this structure.
 * Variables (like ?person) will bind to whatever values make the pattern true.
 *
 * @example Match by name
 * ```ts
 * triple('?person', 'foaf:name', '?name')
 * // ?person foaf:name ?name .
 * ```
 *
 * @example Match specific value
 * ```ts
 * triple('?person', 'foaf:age', 30)
 * // ?person foaf:age 30 .
 * ```
 *
 * @example With full IRI
 * ```ts
 * triple(uri('http://example.org/person/1'), 'foaf:name', 'Alice')
 * // <http://example.org/person/1> foaf:name "Alice" .
 * ```
 */
export function triple(
  subject: TripleSubjectType,
  predicate: TriplePredicateType,
  object: TripleObjectType,
): PatternValueType {
  const s = tripleSubjectString(subject)
  const p = predicateString(predicate)
  const o = tripleObjectString(object)

  return rawPattern(`${s} ${p} ${o} .`)
}

// ============================================================================
// Multiple triples with a shared subject
// ============================================================================

/**
 * Array format for predicate-object pairs.
 *
 * Each entry is [predicate, object]. Use this when you want explicit control
 * over the order of properties.
 */
export type PredicateObjectListType = Array<[TriplePredicateType, TripleObjectType]>

/**
 * Object format for predicate-object pairs.
 *
 * Keys are predicates, values are objects. Values can be single items or arrays
 * for properties with multiple values.
 */
export type PredicateObjectMapType = Record<
  string,
  TripleObjectType | TripleObjectType[]
>

/**
 * Create multiple triples with the same subject.
 *
 * When you have several facts about one resource, you don't want to repeat the
 * subject for each triple. This helper uses SPARQL's semicolon syntax to share
 * the subject across multiple predicate-object pairs.
 *
 * You can pass properties as an array of [predicate, object] pairs, or as an
 * object where keys are predicates. The object format is more convenient, but
 * the array format gives you control over ordering.
 *
 * @example Array format
 * ```ts
 * triples('?person', [
 *   ['foaf:name', 'Peter Parker'],
 *   ['foaf:age', 18],
 *   ['foaf:nick', 'Spidey']
 * ])
 * ```
 *
 * Generates:
 * ```sparql
 * ?person
 *   foaf:name "Peter Parker" ;
 *   foaf:age 18 ;
 *   foaf:nick "Spidey" .
 * ```
 *
 * @example Object format
 * ```ts
 * triples('?person', {
 *   'foaf:name': 'Peter Parker',
 *   'foaf:age': 18,
 *   'foaf:nick': ['Spidey', 'Spider-Man']
 * })
 * ```
 *
 * When a property has an array value, it creates multiple triples with the
 * same predicate (one for each value).
 */
export function triples(
  subject: TripleSubjectType,
  predicateObjects: PredicateObjectListType | PredicateObjectMapType,
): PatternValueType {
  const subjectTerm = tripleSubjectString(subject)

  // 4 spaces; 2 (block) + 2 (extra)
  const CONTINUATION_INDENT = '    '

  // Normalize to list format
  const list: PredicateObjectListType = Array.isArray(predicateObjects)
    ? predicateObjects
    : Object.entries(predicateObjects).flatMap(([pred, value]) => {
      if (Array.isArray(value)) {
        // Multiple values for same predicate → multiple pairs
        return value.map(
          (v): [TriplePredicateType, TripleObjectType] => [pred, v],
        )
      }
      return [[pred, value]]
    })

  // Build semicolon-separated list
  const lines: string[] = list.map(([p, o], idx) => {
    const pred = predicateString(p)
    const obj = tripleObjectString(o)
    const suffix = idx < list.length - 1 ? ' ;' : ' .'

    // Continuation lines should be indented one level *beyond* the line
    // where the subject appears. We assume 2-space block indent, so we
    // use 4 spaces here (2 for block + 2 extra).
    return `${CONTINUATION_INDENT}${pred} ${obj}${suffix}`
  })

  const [first, ...rest] = lines
  if (first === undefined) {
    throw new TypeError('triples() requires at least one predicate-object pair.')
  }
  if (rest.length === 0) {
    // Single predicate-object: everything on a single line
    // `first` currently has leading spaces; strip them on the left.
    return rawPattern(`${subjectTerm} ${first.trimStart()}`)
  }

  // Multiple: first predicate shares the line with the subject,
  // continuation lines keep their internal indentation.
  const firstLine = `${subjectTerm} ${first.trimStart()}`
  const restLines = rest.join('\n')

  return rawPattern(`${firstLine}\n${restLines}`)
}

// ============================================================================
// SPARQL 1.2 triple-term expressions
// ============================================================================

/**
 * RDF 1.2 triple-term expression for SPARQL 1.2.
 *
 * The `<<( ... )>>` expression denotes an RDF triple term. It is distinct from
 * SPARQL 1.2 reified-triple syntax `<< ... >>`.
 *
 * @param subject Subject of the triple term
 * @param predicate Predicate of the triple term
 * @param object Object of the triple term
 *
 * @example Statement about a relationship
 * ```ts
 * const claim = tripleTerm('?person', 'foaf:knows', '?friend')
 * select(['?person', '?friend', '?source'])
 *   .where(triple(claim, 'dc:source', '?source'))
 * // <<( ?person foaf:knows ?friend )>> dc:source ?source
 * ```
 *
 * @example Add confidence to statements
 * ```ts
 * construct(triple(
 *   tripleTerm('?person', 'foaf:knows', '?friend'),
 *   'ex:confidence',
 *   num(0.95)
 * ))
 *   .where(triple('?person', 'foaf:knows', '?friend'))
 * // Annotates each friendship with a confidence score
 * ```
 *
 * @example Query metadata on relationships
 * ```ts
 * const statement = tripleTerm('?s', '?p', '?o')
 * select(['?s', '?p', '?o', '?timestamp'])
 *   .where(triple(statement, 'prov:generatedAtTime', '?timestamp'))
 *   .filter(gte(v('timestamp'), date('2024-01-01')))
 * // Finds recent statements
 * ```
 */
export function tripleTerm(
  subject: TripleSubjectType,
  predicate: TriplePredicateType,
  object: TripleObjectType,
): SparqlTermType {
  const s = tripleSubjectString(subject)
  const p = predicateString(predicate)
  const o = tripleObjectString(object)

  return rawTerm(`<<( ${s} ${p} ${o} )>>`)
}
