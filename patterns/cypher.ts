/**
 * Neo4J like Cypher syntax for graph patterns.
 * 
 * Visual representation of relationships makes queries more intuitive. Instead of
 * writing separate node and relationship definitions, you can draw the connections
 * with ASCII art arrows. This is inspired by Cypher's visual syntax.
 * 
 * The cypher template tag parses patterns like `node1-[predicate]->node2` and
 * generates the appropriate SPARQL triples. It's syntactic sugar - the RDF semantics
 * are unchanged, but the code reads more like a diagram of your graph.
 * 
 * ⚠️ Note: This generates standard SPARQL triples. The arrows are just a visual
 * aid for writing patterns - they get compiled to subject-predicate-object triples.
 * 
 * @module
 */

import { raw, type SparqlValue } from '../sparql.ts'
import { Node } from './objects.ts'

/**
 * Create graph patterns using ASCII art syntax.
 * 
 * Draw your graph with arrows and brackets. The cypher template tag parses this
 * visual representation and generates SPARQL triples. Node objects get substituted
 * in and connected according to the arrows.
 * 
 * The syntax supports:
 * - `node1-[predicate]->node2` - directed edge from node1 to node2
 * - `node1<-[predicate]-node2` - directed edge from node2 to node1
 * - `node1-[predicate]-node2` - undirected (generates forward direction)
 * 
 * Under the hood, this extracts the node patterns and creates additional triples
 * for the relationships. It's a more readable way to write what would otherwise
 * be multiple triple() or rel() calls.
 * 
 * @example Simple connection
 * ```ts
 * const product = node('product', 'schema:Product', {
 *   'schema:name': v('title')
 * })
 * 
 * const publisher = node('publisher', 'schema:Organization', {
 *   'rdfs:label': str('Marvel Comics')
 * })
 * 
 * const pattern = cypher`${product}-[schema:publisher]->${publisher}`
 * ```
 * 
 * Generates:
 * ```sparql
 * ?product a schema:Product .
 * ?product schema:name ?title .
 * ?publisher a schema:Organization .
 * ?publisher rdfs:label "Marvel Comics" .
 * ?product schema:publisher ?publisher .
 * ```
 * 
 * @example Multiple connections
 * ```ts
 * const person = node('person', 'foaf:Person')
 * const friend = node('friend', 'foaf:Person')
 * const group = node('group', 'foaf:Group')
 * 
 * const pattern = cypher`
 *   ${person}-[foaf:knows]->${friend}
 *   ${person}-[foaf:member]->${group}
 * `
 * ```
 * 
 * @example Reverse direction
 * ```ts
 * // These are equivalent:
 * cypher`${person}-[foaf:knows]->${friend}`
 * cypher`${friend}<-[foaf:knows]-${person}`
 * ```
 */
export function cypher(
  strings: TemplateStringsArray,
  ...values: Array<Node | SparqlValue>
): SparqlValue {
  let result = strings[0]
  const nodes: Node[] = []

  // Substitute node placeholders
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

  // Parse ASCII art patterns
  const edgePattern = /NODE_(\d+)\s*<?-\[([^\]]+)\]->?\s*NODE_(\d+)/g
  const triples: string[] = []

  // First, add all node patterns
  for (const node of nodes) {
    triples.push(...node.value.split('\n'))
  }

  // Then parse and add edge patterns
  let match
  while ((match = edgePattern.exec(result)) !== null) {
    const fromIdx = parseInt(match[1])
    const predicate = match[2]
    const toIdx = parseInt(match[3])

    const fromVar = nodes[fromIdx].getVarName()
    const toVar = nodes[toIdx].getVarName()

    triples.push(`?${fromVar} ${predicate} ?${toVar} .`)
  }

  return raw(`${triples.join('\n')}`)
}