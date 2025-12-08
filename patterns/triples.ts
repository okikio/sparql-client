import { exprTermString, raw, type SparqlValue, type ExpressionPrimitive } from '../sparql.ts'

/**
 * Triple pattern component (subject, predicate, or object)
 */
export type TripleSubject = string | SparqlValue
export type TriplePredicate = string | SparqlValue
export type TripleObject = SparqlValue | ExpressionPrimitive

export function tripleSubjectString(subject: TripleSubject): string {
  if (typeof subject === 'string') return subject
  return subject.value
}

export function triplePredicateString(predicate: TriplePredicate): string {
  if (typeof predicate === 'string') return predicate
  return predicate.value
}

/**
 * Create a triple pattern
 * 
 * @example
 * ```ts
 * triple('?person', 'foaf:name', '?name')
 * triple('?person', 'foaf:age', 30)
 * triple(uri('http://example.org/person/1'), 'foaf:name', 'Alice')
 * ```
 */
export function triple(
  subject: TripleSubject,
  predicate: TriplePredicate,
  object: TripleObject,
): SparqlValue {
  const s = tripleSubjectString(subject)
  const p = triplePredicateString(predicate)
  const o = exprTermString(object)

  return raw(`${s} ${p} ${o} .`)
}

export type PredicateObjectList = Array<[TriplePredicate, TripleObject]>
export type PredicateObjectMap = Record<
  string,
  TripleObject | TripleObject[]
>

/**
 * Multiple triples with a shared subject.
 *
 * Supports:
 *
 * - Array form:
 *   triples('?person', [
 *     ['foaf:name', 'Peter Parker'],
 *     ['foaf:age', 18],
 *   ])
 *
 * - Object form:
 *   triples('?person', {
 *     'foaf:name': 'Peter Parker',
 *     'foaf:age': 18,
 *     'foaf:nick': ['Spidey', 'Friendly Neighborhood Spider-Man'],
 *   })
 */
export function triples(
  subject: TripleSubject,
  predicateObjects: PredicateObjectList | PredicateObjectMap,
): SparqlValue {
  const s = tripleSubjectString(subject)

  const list: PredicateObjectList = Array.isArray(predicateObjects)
    ? predicateObjects
    : Object.entries(predicateObjects).flatMap(([pred, value]) => {
        if (Array.isArray(value)) {
          return value.map(
            (v): [TriplePredicate, TripleObject] => [pred, v],
          )
        }
        return [[pred, value]]
    })
  
  const lines: string[] = list.map(([p, o], idx) => {
    const pred = triplePredicateString(p)
    const obj = exprTermString(o)
    const sep = idx < list.length - 1 ? ' ;' : ' .'
    return `  ${pred} ${obj}${sep}`
  })

  return raw(`${s}\n${lines.join('\n')}`)
}