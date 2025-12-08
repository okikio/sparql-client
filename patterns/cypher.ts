/**
 * Unified SPARQL API - Supporting 4 DX Patterns
 * 
 * This module provides 4 different ways to write SPARQL queries,
 * each optimized for different use cases and developer preferences.
 * 
 * IMPORTANT: RDF vs Cypher
 * - RDF is a graph of statements (triples), not a property graph
 * - Relationships in RDF are triples, not edges with properties
 * - "Nesting" in RDF requires blank nodes or multiple triples
 * - Type in RDF (rdf:type / 'a') is just another predicate
 */

import { sparql, uri, variable, date, dateTime, type SparqlValue } from '../sparql.ts'
import { Node } from './nested.ts'

// ============================================================================
// Approach 3: ASCII Art Pattern (Cypher-like visual)
// ============================================================================

/**
 * APPROACH 3: ASCII Art Pattern
 * 
 * Cypher-inspired visual representation.
 * ⚠️ RDF SEMANTICS: This is syntactic sugar. Arrows show triple direction.
 * 
 * @example
 * ```typescript
 * const product = node('?product is narrative:Product', {
 *   'narrative:releaseDate': '?releaseDate',
 * });
 * 
 * const publisher = node('?publisher is narrative:Publisher', {
 *   'rdfs:label': str('Marvel'),
 * });
 * 
 * const pattern = path`${product}-[narrative:publishedBy]->${publisher}`;
 * ```
 */

/**
 * Create path pattern with ASCII art
 * 
 * Supported patterns:
 * - `${node1}-[predicate]->${node2}` - directed edge
 * - `${node1}<-[predicate]-${node2}` - reverse direction
 * - `${node1}-[predicate]-${node2}` - undirected (generates forward)
 */
export function cypher(
  strings: TemplateStringsArray,
  ...values: Array<Node | SparqlValue>
): SparqlValue {
  let result = strings[0]
  const nodes: Node[] = []

  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    
    if (value instanceof Node) {
      nodes.push(value)
      result += `NODE_${nodes.length - 1}`
    } else {
      result += String(value)
    }

    result += strings[i + 1]
  }

  // Parse ASCII art pattern
  // Pattern: NODE_0-[predicate]->NODE_1
  const edgePattern = /NODE_(\d+)\s*<?-\[([^\]]+)\]->?\s*NODE_(\d+)/g
  const triples: string[] = []

  // Add all node triples first
  for (const node of nodes) {
    triples.push(...node.buildTriples())
  }

  // Parse edges
  let match
  while ((match = edgePattern.exec(result)) !== null) {
    const fromIdx = parseInt(match[1])
    const predicate = match[2]
    const toIdx = parseInt(match[3])

    const fromVar = nodes[fromIdx].getVarName()
    const toVar = nodes[toIdx].getVarName()

    triples.push(`?${fromVar} ${predicate} ?${toVar} .`)
  }

  return sparql`${triples.join('\n')}`
}

