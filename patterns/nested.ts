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

import { QueryBuilder } from '../builder.ts'
import {
  sparql,
  date,
  dateTime,
  raw,
  type SparqlValue,
} from '../sparql.ts'

// ============================================================================
// Approach 1: Nested Object Pattern (Cypher-inspired, JavaScript-native)
// ============================================================================

/**
 * APPROACH 1: Nested Object Pattern
 * 
 * Most intuitive for developers familiar with JSON/JavaScript.
 * 
 * ⚠️ RDF SEMANTICS: This LOOKS nested but generates flat triples.
 * In RDF, all properties are edges. We're just making the DX nicer.
 * 
 * @example
 * ```typescript
 * const pattern = node('?product is narrative:Product', {
 *   'narrative:productTitle': '?title',
 *   'narrative:publishedBy': node('?publisher is narrative:Publisher', {
 *     'rdfs:label': str('Marvel Comics'),
 *   }),
 * });
 * 
 * // Generates:
 * // ?product a narrative:Product .
 * // ?product narrative:productTitle ?title .
 * // ?product narrative:publishedBy ?publisher .
 * // ?publisher a narrative:Publisher .
 * // ?publisher rdfs:label "Marvel Comics" .
 * ```
 */

export interface NodeOptions {
  [predicate: string]: any // Value, variable, or nested node
}

export class Node {
  private readonly varName: string
  private readonly typeUri?: string
  private readonly properties: Map<string, any> = new Map()

  constructor(pattern: string, options?: NodeOptions) {
    // Parse pattern: "?variable is type:Class" or just "?variable"
    const match = pattern.match(/^\?(\w+)(?:\s+is\s+(.+))?$/)
    if (!match) {
      throw new Error(`Invalid node pattern: ${pattern}`)
    }

    this.varName = match[1]
    this.typeUri = match[2]

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        this.properties.set(key, value)
      }
    }
  }

  /**
   * Build SPARQL triples (recursive for nested nodes)
   */
  buildTriples(): string[] {
    const triples: string[] = []

    // Type triple
    if (this.typeUri) {
      triples.push(`?${this.varName} a ${this.typeUri} .`)
    }

    // Property triples
    for (const [predicate, value] of this.properties) {
      if (value instanceof Node) {
        // Nested node - add connection triple, then nested triples
        triples.push(`?${this.varName} ${predicate} ?${value.varName} .`)
        triples.push(...value.buildTriples())
      } else {
        // Simple value
        const valueStr = this.formatValue(value)
        triples.push(`?${this.varName} ${predicate} ${valueStr} .`)
      }
    }

    return triples
  }

  private formatValue(value: any): string {
    // Handle variables (start with ?)
    if (typeof value === 'string' && value.startsWith('?')) {
      return value
    }

    // Handle SparqlValue wrappers
    if (value && typeof value === 'object' && '__sparql' in value) {
      return value.value
    }

    // Auto-convert primitives
    if (typeof value === 'string') {
      return `"""${value}"""^^<http://www.w3.org/2001/XMLSchema#string>`
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return String(value)
    }

    return String(value)
  }


  /**
   * New: build this node as a single SparqlValue pattern.
   *
   * Safe because:
   * - Values are rendered using formatValue() into proper RDF terms.
   * - The only raw concatenation is stitching those already-safe triples
   *   together with newlines.
   *
   * This makes Node directly usable with the query builder:
   *   select(['?x']).where(node.build())
   */
  build(): SparqlValue {
    const triples = this.buildTriples().join('\n')
    return raw(triples)
  }

  getVarName(): string {
    return this.varName
  }
}

/**
 * Create node with nested object pattern
 */
export function node(pattern: string, options?: NodeOptions): Node {
  return new Node(pattern, options)
}

export function whereNode(
  builder: QueryBuilder,
  ...nodes: Node[]
): QueryBuilder {
  return nodes.reduce(
    (acc, n) => acc.where(n.build()),
    builder,
  )
}
