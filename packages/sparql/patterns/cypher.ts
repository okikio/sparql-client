/**
 * Cypher-like visual graph-pattern syntax that compiles to ordinary SPARQL.
 *
 * This is only syntax sugar. Predicates remain RDF/SPARQL terms and the output
 * is a normal graph-pattern fragment.
 *
 * @module
 */

import { isTerm as isRdfTerm, type NamedNode as RdfNamedNode } from '@okikio/rdf'
import { rdfTerm, rawPattern, toPredicateName, type PatternValue, type SparqlTerm } from '../sparql.ts'
import { Node } from './objects.ts'

/** Predicate values accepted inside a cypher relationship placeholder. */
type CypherTermType = SparqlTerm | RdfNamedNode

/**
 * Builds graph patterns from `node-[predicate]->node` visual relationships.
 *
 * Direction is semantic: `a-[p]->b` emits `a p b`, while `a<-[p]-b`
 * emits `b p a`. Interpolated RDF NamedNodes are preserved as full IRIs.
 */
export function cypher(
  strings: TemplateStringsArray,
  ...values: Array<Node | CypherTermType>
): PatternValue {
  let source = strings[0] ?? ''
  const nodes: Node[] = []
  const terms = new Map<string, CypherTermType>()

  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (value instanceof Node) {
      const placeholder = `NODE_${nodes.length}`
      nodes.push(value)
      source += placeholder
    } else {
      const placeholder = `TERM_${index}`
      terms.set(placeholder, value)
      source += placeholder
    }
    source += strings[index + 1] ?? ''
  }

  const triples: string[] = []
  for (const node of nodes) {
    if (node.value.trim()) triples.push(node.value)
  }

  // Keep connector recognition explicit. This prevents a reverse arrow from
  // being normalized to the same edge direction as a forward arrow.
  const edge = /NODE_(\d+)\s*(<-|-)\[([^\]]+)\](->|-)\s*NODE_(\d+)/g
  for (const match of source.matchAll(edge)) {
    const left = nodes[Number(match[1])]
    const leftConnector = match[2]
    const predicateSource = match[3]?.trim()
    const right = nodes[Number(match[5])]
    if (!left || !right || !predicateSource) {
      throw new SyntaxError('Cypher pattern references a missing node or predicate.')
    }

    const predicate = predicateText(predicateSource, terms)
    const reverse = leftConnector === '<-'
    const subject = reverse ? right.getVarName() : left.getVarName()
    const object = reverse ? left.getVarName() : right.getVarName()
    triples.push(`${subject} ${predicate} ${object} .`)
  }

  return rawPattern(triples.join('\n'))
}

/** Serializes a visual-edge predicate without flattening RDF named nodes. */
function predicateText(source: string, terms: ReadonlyMap<string, CypherTermType>): string {
  const term = terms.get(source)
  if (!term) return toPredicateName(source)
  if (isRdfTerm(term)) return rdfTerm(term)
  return term.value
}
