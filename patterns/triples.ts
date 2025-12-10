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

import { isSparqlValue, toVarToken, type SparqlExpr, type SparqlTerm } from '../sparql.ts'
import { raw, toPredicateName, toRawString, type SparqlValue, } from '../sparql.ts'
import { termString, type ExpressionPrimitive } from '../utils.ts'

// ============================================================================
// Triple Component Types
// ============================================================================

/**
 * Subject of a triple pattern.
 * 
 * Can be a variable (?person), an IRI (<http://...>), or a blank node.
 * Most often you'll use variables to match multiple resources.
 */
export type TripleSubject = string | SparqlTerm

/**
 * Predicate of a triple pattern.
 * 
 * Can be a prefixed name (foaf:name), full IRI, or variable. Predicates
 * describe relationships or properties.
 */
export type TriplePredicate = string | SparqlTerm

/**
 * Values that are allowed in the object position of a triple, per SPARQL.
 *
 * Object can be:
 * - a variable
 * - an IRI or prefixed name
 * - a literal
 * - a blank node
 * 
 * (We can later extend this to collections `( ... )` and blank-node property
 * lists `[ ... ]` via additional SparqlValue kinds.)
 */
export type TripleObject =
  | SparqlTerm  // but only certain `kind`s, enforced at runtime
  | ExpressionPrimitive

/**
 * Convert subject to string form.
 * 
 * Handles both raw strings and SparqlValue objects.
 */
export function tripleSubjectString(subject: TripleSubject): string {
  // If it's already a SparqlValue (iri, bnode, literal, raw, etc.)
  if (isSparqlValue(subject)) {
    return subject.value
  }

  // Otherwise, it’s a variable name like "person" or "?person"
  return toVarToken(subject)
}

/**
 * Convert predicate to string form.
 */
export function tripleObjectString(object: TripleObject): string {
  return termString(object, 'object')
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
  subject: TripleSubject,
  predicate: TriplePredicate,
  object: TripleObject,
): SparqlExpr {
  const s = tripleSubjectString(subject)
  const p = toPredicateName(toRawString(predicate))
  const o = tripleObjectString(object)

  return raw(`${s} ${p} ${o} .`)
}

// ============================================================================
// Multiple Triples with Shared Subject
// ============================================================================

/**
 * Array format for predicate-object pairs.
 * 
 * Each entry is [predicate, object]. Use this when you want explicit control
 * over the order of properties.
 */
export type PredicateObjectList = Array<[TriplePredicate, TripleObject]>

/**
 * Object format for predicate-object pairs.
 * 
 * Keys are predicates, values are objects. Values can be single items or arrays
 * for properties with multiple values.
 */
export type PredicateObjectMap = Record<
  string,
  TripleObject | TripleObject[]
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
  subject: TripleSubject,
  predicateObjects: PredicateObjectList | PredicateObjectMap,
): SparqlExpr {
  const subjectTerm = tripleSubjectString(subject)

  // 4 spaces; 2 (block) + 2 (extra)
  const CONTINUATION_INDENT = '    ';

  // Normalize to list format
  const list: PredicateObjectList = Array.isArray(predicateObjects)
    ? predicateObjects
    : Object.entries(predicateObjects).flatMap(([pred, value]) => {
        if (Array.isArray(value)) {
          // Multiple values for same predicate → multiple pairs
          return value.map(
            (v): [TriplePredicate, TripleObject] => [pred, v],
          )
        }
        return [[pred, value]]
    })

  // Build semicolon-separated list
  const lines: string[] = list.map(([p, o], idx) => {
    const pred = toPredicateName(toRawString(p))
    const obj = tripleObjectString(o)
    const suffix = idx < list.length - 1 ? ' ;' : ' .'

    // Continuation lines should be indented one level *beyond* the line
    // where the subject appears. We assume 2-space block indent, so we
    // use 4 spaces here (2 for block + 2 extra).
    return `${CONTINUATION_INDENT}${pred} ${obj}${suffix}`
  })

  const [first, ...rest] = lines
  if (rest.length === 0) {
    // Single predicate-object: everything on a single line
    // `first` currently has leading spaces; strip them on the left.
    return raw(`${subjectTerm} ${first.trimStart()}`)
  }

  // Multiple: first predicate shares the line with the subject,
  // continuation lines keep their internal indentation.
  const firstLine = `${subjectTerm} ${first.trimStart()}`
  const restLines = rest.join('\n')

  return raw(`${firstLine}\n${restLines}`)
}

// ============================================================================
// SPARQL* (RDF-star)
// ============================================================================

/**
 * Quoted triple for SPARQL* (RDF-star).
 * 
 * SPARQL* extends SPARQL to work with quoted triples - statements about statements.
 * This lets you add metadata to edges in your graph (like confidence scores,
 * sources, or timestamps on relationships).
 * 
 * @param subject Subject of quoted triple
 * @param predicate Predicate of quoted triple
 * @param object Object of quoted triple
 * 
 * @example Statement about a relationship
 * ```ts
 * const claim = quotedTriple('?person', 'foaf:knows', '?friend')
 * select(['?person', '?friend', '?source'])
 *   .where(triple(claim, 'dc:source', '?source'))
 * // << ?person foaf:knows ?friend >> dc:source ?source
 * ```
 * 
 * @example Add confidence to statements
 * ```ts
 * construct(triple(
 *   quotedTriple('?person', 'foaf:knows', '?friend'),
 *   'ex:confidence',
 *   num(0.95)
 * ))
 *   .where(triple('?person', 'foaf:knows', '?friend'))
 * // Annotates each friendship with a confidence score
 * ```
 * 
 * @example Query metadata on relationships
 * ```ts
 * const statement = quotedTriple('?s', '?p', '?o')
 * select(['?s', '?p', '?o', '?timestamp'])
 *   .where(triple(statement, 'prov:generatedAtTime', '?timestamp'))
 *   .filter(gte(v('timestamp'), date('2024-01-01')))
 * // Finds recent statements
 * ```
 */
export function quotedTriple(
  subject: TripleSubject,
  predicate: TriplePredicate,
  object: TripleObject,
): SparqlExpr {
  const s = tripleSubjectString(subject)
  const p = toPredicateName(toRawString(predicate))
  const o = tripleObjectString(object)
  
  return raw(`<< ${s} ${p} ${o} >>`)
}