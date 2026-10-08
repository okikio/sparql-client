import * as structure from '../structure.ts'
import { triple } from './triples.ts'
/**
 * Cypher-like visual graph-pattern syntax that compiles to ordinary SPARQL.
 *
 * This is only syntax sugar. Predicates remain RDF/SPARQL terms and the output
 * is a normal graph-pattern fragment.
 *
 * @module
 */

import { type NamedNode as RdfNamedNode } from '@okikio/rdf'
import {
  type PatternValueType,
  rawPattern,
  rawTerm,
  type SparqlTermType,
  toPredicateName,
  toPredicateToken,
} from '../sparql.ts'
import { Node } from './objects.ts'

/** Predicate values accepted inside a cypher relationship placeholder. */
export type CypherTermType = SparqlTermType | RdfNamedNode

/**
 * Builds graph patterns from `node-[predicate]->node` visual relationships.
 *
 * DirectionType is semantic: `a-[p]->b` emits `a p b`, while `a<-[p]-b`
 * emits `b p a`. Interpolated RDF NamedNodes are preserved as full IRIs.
 */
export function cypher(
  strings: TemplateStringsArray,
  ...values: Array<Node | CypherTermType>
): PatternValueType {
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

  const patterns: PatternValueType[] = []
  for (const node of nodes) {
    if (node.value.trim()) patterns.push(node.pattern())
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
    patterns.push(triple(subject, rawTerm(predicate), object))
  }

  return structure.pattern(rawPattern(patterns.map((value) => value.value).join('\n')), {
    kind: 'group',
    bindings: [...structure.scope(patterns)],
    children: patterns,
  })
}

/** Serializes a visual-edge predicate without flattening RDF named nodes. */
function predicateText(source: string, terms: ReadonlyMap<string, CypherTermType>): string {
  const term = terms.get(source)
  if (!term) return toPredicateName(source)
  return toPredicateToken(term)
}
