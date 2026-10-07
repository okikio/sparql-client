/** Independent SPARQL document oracle shared by builder and composition tests. @module */
import { Parser } from '@traqula/parser-sparql-1-2'

/**
 * Parses a complete query or update, ignoring layout and basic graph pattern order.
 *
 * Multiplicity, terms, clauses, variable identities and other ordered syntax remain
 * visible. This is a test oracle, not a claim of general SPARQL query equivalence.
 */
export function query(value: string): unknown {
  return semantics(new Parser().parse(value))
}

/** Removes only locations and conjunction order from the independent parser's result. */
function semantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantics)
  if (typeof value !== 'object' || value === null) return value
  const result = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'loc').map((
      [key, item],
    ) => [key, semantics(item)]),
  )
  if (result.type === 'pattern' && result.subType === 'bgp' && Array.isArray(result.triples)) {
    result.triples.sort((left: unknown, right: unknown) => {
      const first = JSON.stringify(left), second = JSON.stringify(right)
      return first < second ? -1 : first > second ? 1 : 0
    })
  }
  return result
}
