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

import { sparql, exprTermString, type SparqlValue, ExpressionPrimitive } from '../sparql.ts'
import { createExecutor, type ExecutorConfig } from '../executor.ts'
import { Node } from './nested.ts'

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
 * Triple pattern component (subject, predicate, or object)
 */
export type TripleSubject = string | SparqlValue
export type TriplePredicate = string | SparqlValue
export type TripleObject = SparqlValue | ExpressionPrimitive

function tripleSubjectString(subject: TripleSubject): string {
  if (typeof subject === 'string') return subject
  return subject.value
}

function triplePredicateString(predicate: TriplePredicate): string {
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

  return sparql`${s} ${p} ${o} .`
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

  return sparql`${s}\n${lines.join('\n')}`
}