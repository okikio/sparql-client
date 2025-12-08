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
import { createExecutor, type ExecutorConfig } from '../executor.ts'

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
  private varName: string
  private typeUri?: string
  private properties: Map<string, any> = new Map()

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

// ============================================================================
// Approach 2: Explicit Triple Builder (Traditional, RDF-honest)
// ============================================================================

/**
 * APPROACH 2: Explicit Triple Builder
 * 
 * Most RDF-faithful. Every triple is explicit.
 * Best for developers who understand RDF/SPARQL.
 * 
 * @example
 * ```typescript
 * select(['?product', '?title'])
 *   .where(triple('?product', 'a', 'narrative:Product'))
 *   .where(triple('?product', 'narrative:productTitle', '?title'))
 *   .where(triple('?product', 'narrative:publishedBy', '?publisher'))
 * ```
 */

export interface QueryBuilder {
  where(pattern: string | Node | SparqlValue): QueryBuilder
  filter(expr: string | SparqlValue): QueryBuilder
  optional(pattern: string | Node | SparqlValue): QueryBuilder
  orderBy(variable: string, direction?: 'ASC' | 'DESC'): QueryBuilder
  limit(count: number): QueryBuilder
  offset(count: number): QueryBuilder
  build(): SparqlValue
  execute(config: ExecutorConfig): Promise<any>
}

class QueryBuilderImpl implements QueryBuilder {
  private selectVars: string[]
  private wherePatterns: string[] = []
  private filterExprs: string[] = []
  private optionalPatterns: string[] = []
  private orderByExprs: string[] = []
  private limitCount?: number
  private offsetCount?: number

  constructor(selectVars: string[]) {
    this.selectVars = selectVars
  }

  where(pattern: string | Node | SparqlValue): QueryBuilder {
    if (pattern instanceof Node) {
      this.wherePatterns.push(...pattern.buildTriples())
    } else if (typeof pattern === 'string') {
      this.wherePatterns.push(pattern)
    } else {
      this.wherePatterns.push(pattern.value)
    }
    return this
  }

  filter(expr: string | SparqlValue): QueryBuilder {
    const filterStr = typeof expr === 'string' ? expr : expr.value
    this.filterExprs.push(filterStr)
    return this
  }

  optional(pattern: string | Node | SparqlValue): QueryBuilder {
    if (pattern instanceof Node) {
      const triples = pattern.buildTriples().join('\n    ')
      this.optionalPatterns.push(triples)
    } else if (typeof pattern === 'string') {
      this.optionalPatterns.push(pattern)
    } else {
      this.optionalPatterns.push(pattern.value)
    }
    return this
  }

  orderBy(variable: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    this.orderByExprs.push(`${direction}(${variable})`)
    return this
  }

  limit(count: number): QueryBuilder {
    this.limitCount = count
    return this
  }

  offset(count: number): QueryBuilder {
    this.offsetCount = count
    return this
  }

  build(): SparqlValue {
    const parts: string[] = []

    // SELECT clause
    parts.push(`SELECT ${this.selectVars.join(' ')}`)

    // WHERE clause
    if (this.wherePatterns.length > 0 || this.filterExprs.length > 0 || this.optionalPatterns.length > 0) {
      parts.push('WHERE {')

      // WHERE patterns
      for (const pattern of this.wherePatterns) {
        parts.push(`  ${pattern}`)
      }

      // FILTER expressions
      for (const filter of this.filterExprs) {
        parts.push(`  FILTER(${filter})`)
      }

      // OPTIONAL patterns
      for (const optional of this.optionalPatterns) {
        parts.push(`  OPTIONAL { ${optional} }`)
      }

      parts.push('}')
    }

    // ORDER BY
    if (this.orderByExprs.length > 0) {
      parts.push(`ORDER BY ${this.orderByExprs.join(' ')}`)
    }

    // LIMIT
    if (this.limitCount !== undefined) {
      parts.push(`LIMIT ${this.limitCount}`)
    }

    // OFFSET
    if (this.offsetCount !== undefined) {
      parts.push(`OFFSET ${this.offsetCount}`)
    }

    return sparql`${parts.join('\n')}`
  }

  async execute(config: ExecutorConfig): Promise<any> {
    const executor = createExecutor(config)
    return executor(this.build())
  }
}

/**
 * Start SELECT query
 */
export function select(variables: string[]): QueryBuilder {
  return new QueryBuilderImpl(variables)
}

/**
 * Create triple pattern (RDF-honest)
 */
export function triple(subject: string, predicate: string, object: string | SparqlValue): string {
  const objStr = typeof object === 'string' ? object : object.value
  return `${subject} ${predicate} ${objStr} .`
}

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
export function path(strings: TemplateStringsArray, ...values: any[]): SparqlValue {
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

// ============================================================================
// Approach 4: Pure Template Tag (Raw SPARQL with safe interpolation)
// ============================================================================

/**
 * APPROACH 4: Pure Template Tag
 * 
 * Most powerful and flexible. Direct SPARQL control.
 * Use explicit constructors for safety.
 * 
 * Already provided by sparql.ts:
 * - sparql`` - main template tag
 * - sparql.uri() - IRI reference
 * - sparql.date() - date literal
 * - sparql.dateTime() - dateTime literal
 * - etc.
 * 
 * @example
 * ```typescript
 * const query = sparql`
 *   SELECT * WHERE {
 *     ?product narrative:createdBy ${sparql.uri(creatorUri)} ;
 *              narrative:releaseDate ${sparql.date('2025-01-01')} ;
 *              rdfs:label ${title} ;
 *              narrative:issueNumber ${42} .
 *   }
 * `
 * ```
 */

// Re-export from sparql.ts for convenience
export { sparql, uri as iri, variable as v, date, dateTime } from '../sparql.ts'


// ============================================================================
// Value Constructors (for all approaches)
// ============================================================================

/**
 * String literal (explicit)
 */
export function str(value: string): SparqlValue {
  return sparql`"""${value}"""^^<http://www.w3.org/2001/XMLSchema#string>`
}

/**
 * Number literal (explicit)
 */
export function num(value: number): SparqlValue {
  if (Number.isInteger(value)) {
    return sparql`${value}`
  }
  return sparql`"${value}"^^<http://www.w3.org/2001/XMLSchema#decimal>`
}

/**
 * Boolean literal (explicit)
 */
export function bool(value: boolean): SparqlValue {
  return sparql`${value}`
}

// ============================================================================
// Unified Executor
// ============================================================================

/**
 * Execute any query pattern
 */
export async function execute(
  query: QueryBuilder | SparqlValue | Node,
  config: ExecutorConfig
): Promise<any> {
  const executor = createExecutor(config)

  if (query instanceof QueryBuilderImpl) {
    return query.execute(config)
  } else if (query instanceof Node) {
    // Node alone - just triples, no SELECT
    const triples = query.buildTriples()
    return executor(sparql`${triples.join('\n')}`)
  } else {
    return executor(query)
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { ExecutorConfig, SparqlValue }
export { createExecutor } from '../executor.ts'