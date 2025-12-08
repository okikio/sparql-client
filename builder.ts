/**
 * Drizzle-like query builder for SPARQL
 * 
 * Provides chainable, type-safe query construction:
 * 
 * @example
 * ```ts
 * const query = select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .filter('?age > 18')
 *   .orderBy('?name')
 *   .limit(10);
 * 
 * const result = await execute(query);
 * ```
 */


import {
  sparql,
  normalizeVariableName,
  type SparqlValue,
} from './sparql.ts'
import {
  bind as bindExpr,
  exprTermString,
  filter as filterExpr,
  optional as optionalExpr,
} from './utils.ts'
import { createExecutor, type ExecutorConfig, type SparqlResult } from './executor.ts'

// ============================================================================
// Core Query Types
// ============================================================================

/**
 * General “pattern-like” input for WHERE/OPTIONAL/UNION.
 *
 * For higher-level patterns:
 * - cypher-style helpers should return SparqlValue
 * - object/nested patterns should usually expose a `.build(): SparqlValue`
 * - if you really need, you can pass raw SPARQL strings
 */
export type PatternLike = string | SparqlValue

/**
 * Query projection (SELECT variables)
 */
export type Projection = PatternLike[] | '*'

/**
 * Sort direction
 */
export type SortDirection = 'ASC' | 'DESC'

/**
 * Sort specification
 */
export interface SortSpec {
  readonly variable: string
  readonly direction?: SortDirection
}

/**
 * SELECT modifier: mutually exclusive
 */
export type SelectModifier = 'none' | 'distinct' | 'reduced'

// ============================================================================
// Query Builder State
// ============================================================================

/**
 * Internal query builder state
 */
interface QueryState {
  readonly type: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE'
  readonly projection: Projection
  readonly from?: string[]
  readonly where: SparqlValue[]
  readonly filters: SparqlValue[]      // each is a FILTER(...) SparqlValue
  readonly optional: SparqlValue[]     // group patterns for OPTIONAL { ... }
  readonly bindings: SparqlValue[]     // BIND(...) SparqlValue
  readonly unions: SparqlValue[][]     // each entry is a UNION branch (group)
  readonly sorts: SortSpec[]
  readonly limit?: number
  readonly offset?: number
  readonly modifier: SelectModifier
}

/**
 * Initial empty state
 */
const initialState: QueryState = {
  type: 'SELECT',
  projection: '*',
  where: [],
  filters: [],
  optional: [],
  bindings: [],
  unions: [],
  sorts: [],
  modifier: 'none',
}

// ============================================================================
// Query Builder
// ============================================================================

/**
 * SPARQL query builder with chainable methods
 */
export class QueryBuilder {
  private constructor(private readonly state: QueryState) { }

  /**
   * Start building a SELECT query
   */
  static select(projection: Projection = '*'): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'SELECT',
      projection,
    })
  }

  /**
   * Start building an ASK query
   */
  static ask(): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'ASK',
      projection: [],
    })
  }

  /**
   * Start building a CONSTRUCT query.
   *
   * NOTE: `template` is the construct template; you still add WHERE patterns
   * with .where().
   */
  static construct(template: SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'CONSTRUCT',
      projection: [],
      where: [template],
    })
  }

  /**
   * Start building a DESCRIBE query
   */
  static describe(resources: string[]): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'DESCRIBE',
      projection: resources,
    })
  }

  // --------------------------------------------------------------------------
  // Clause builders
  // --------------------------------------------------------------------------

  /**
   * Add FROM clause (graph IRI)
   */
  from(graphIRI: string): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      from: [...(this.state.from || []), graphIRI],
    })
  }

  /**
   * Add a WHERE pattern.
   *
   * You pass a SparqlValue that represents one or more triple patterns.
   * Typically created with:
   * - triple()
   * - triples()
   * - Node.build()
   * - match(), path(), etc.
   */
  where(pattern: SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      where: [...this.state.where, pattern],
    })
  }

  /**
   * Add a FILTER expression.
   *
   * You pass a SparqlValue representing the *condition*, and this will wrap
   * it using the filter(...) helper from sparql.ts.
   *
   * @example
   * ```ts
   * import { variable, gte, and } from './sparql.ts'
   *
   * const condition = and(
   *   gte(variable('age'), 18),
   *   regex(variable('name'), '^Spidey', 'i'),
   * )
   *
   * builder.filter(condition)
   * ```
   */
  filter(condition: SparqlValue): QueryBuilder {
    const filterValue = filterExpr(condition)

    return new QueryBuilder({
      ...this.state,
      filters: [...this.state.filters, filterValue],
    })
  }

  /**
   * Add an OPTIONAL block.
   *
   * The pattern is a SparqlValue representing the contents of the OPTIONAL
   * block. For example:
   *
   * ```ts
   * const opt = triples('?person', [
   *   ['foaf:mbox', '?email'],
   * ])
   *
   * builder.optional(opt)
   * ```
   */
  optional(pattern: SparqlValue): QueryBuilder {
    const optionalPattern = optionalExpr(pattern)

    return new QueryBuilder({
      ...this.state,
      optional: [...this.state.optional, optionalPattern],
    })
  }

  /**
   * Add a BIND expression.
   *
   * You pass a SparqlValue representing the expression to compute, and a
   * variable name (with or without leading '?').
   *
   * @example
   * ```ts
   * const fullNameExpr = concat(variable('firstName'), ' ', variable('lastName'))
   *
   * builder.bind(fullNameExpr, 'fullName') // or '?fullName'
   * ```
   */
  bind(expression: SparqlValue, asVariable: string): QueryBuilder {
    const varName = normalizeVariableName(asVariable)
    const bindValue = bindExpr(expression, varName)

    return new QueryBuilder({
      ...this.state,
      bindings: [...this.state.bindings, bindValue],
    })
  }

  /**
   * Add a UNION group.
   *
   * Each argument is a SparqlValue representing one branch of the UNION.
   *
   * @example
   * ```ts
   * builder.union(
   *   triples('?item', [['rdf:type', 'ex:Comic']]),
   *   triples('?item', [['rdf:type', 'ex:GraphicNovel']]),
   * )
   * ```
   */
  union(...branches: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      unions: [...this.state.unions, branches],
    })
  }

  /**
   * Add ORDER BY clause.
   *
   * `variable` should include the leading ?, e.g. '?name'.
   */
  orderBy(variable: string, direction?: SortDirection): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      sorts: [...this.state.sorts, { variable, direction }],
    })
  }

  /**
   * Add LIMIT clause
   */
  limit(count: number): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      limit: count,
    })
  }

  /**
   * Add OFFSET clause
   */
  offset(count: number): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      offset: count,
    })
  }

  /**
   * Use DISTINCT modifier on SELECT.
   */
  distinct(): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      modifier: 'distinct',
    })
  }

  /**
   * Use REDUCED modifier on SELECT.
   */
  reduced(): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      modifier: 'reduced',
    })
  }

  // --------------------------------------------------------------------------
  // Build & execute
  // --------------------------------------------------------------------------

  /**
   * Build the final SPARQL query as a SparqlValue.
   */
  build(): SparqlValue {
    const parts: string[] = []

    // Query type and projection
    if (this.state.type === 'SELECT') {
      let modifier = ''
      if (this.state.modifier === 'distinct') {
        modifier = 'DISTINCT '
      } else if (this.state.modifier === 'reduced') {
        modifier = 'REDUCED '
      }

      const proj = this.state.projection === '*'
        ? '*'
        : this.state.projection.map(x => exprTermString(x))?.join(' ')
      parts.push(`SELECT ${modifier}${proj}`)
    } else if (this.state.type === 'ASK') {
      parts.push('ASK')
    } else if (this.state.type === 'CONSTRUCT') {
      parts.push('CONSTRUCT')
    } else if (this.state.type === 'DESCRIBE') {
      const projection = Array.isArray(this.state.projection)
        ? this.state.projection.map(x => exprTermString(x)).join(' ')
        : exprTermString(this.state.projection);
      parts.push(`DESCRIBE ${projection}`)
    }

    // FROM clauses
    if (this.state.from) {
      for (const graph of this.state.from) {
        parts.push(`FROM <${graph}>`)
      }
    }

    // WHERE clause
    if (
      this.state.where.length > 0 ||
      this.state.filters.length > 0 ||
      this.state.optional.length > 0 ||
      this.state.bindings.length > 0 ||
      this.state.unions.length > 0
    ) {
      parts.push('WHERE {')

      // WHERE patterns
      for (const pattern of this.state.where) {
        parts.push(`  ${pattern.value}`)
      }

      // FILTER expressions (already include FILTER(...))
      for (const filter of this.state.filters) {
        parts.push(`  ${filter.value}`)
      }

      // OPTIONAL blocks
      for (const optional of this.state.optional) {
        parts.push(`  ${optional.value}`)
      }

      // BIND expressions (already BIND(...))
      for (const bind of this.state.bindings) {
        parts.push(`  ${bind.value}`)
      }

      // UNION blocks
      for (let i = 0; i < this.state.unions.length; i++) {
        if (i > 0) parts.push('  UNION')
        parts.push('  {')
        for (const pattern of this.state.unions[i]) {
          parts.push(`    ${pattern.value}`)
        }
        parts.push('  }')
      }

      parts.push('}')
    }

    // ORDER BY clause
    if (this.state.sorts.length > 0) {
      const sorts = this.state.sorts.map((sort) => {
        const dir = sort.direction ? ` ${sort.direction}` : ''
        return `${sort.variable}${dir}`
      })
      parts.push(`ORDER BY ${sorts.join(' ')}`)
    }

    // LIMIT clause
    if (this.state.limit !== undefined) {
      parts.push(`LIMIT ${this.state.limit}`)
    }

    // OFFSET clause
    if (this.state.offset !== undefined) {
      parts.push(`OFFSET ${this.state.offset}`)
    }

    return sparql`${parts.join('\n')}`
  }

  /**
   * Execute query using the configured executor.
   */
  execute(config: ExecutorConfig): Promise<SparqlResult> {
    const executor = createExecutor(config)
    return executor(this.build())
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

export const select = QueryBuilder.select;
export const ask = QueryBuilder.ask;
export const construct = QueryBuilder.construct;
export const describe = QueryBuilder.describe;

/**
 * Quick executor shorthand
 * 
 * @example
 * ```ts
 * const result = await execute(
 *   select(['?name']).where(triple('?person', 'foaf:name', '?name')),
 *   { endpoint: 'http://localhost:9999/blazegraph/sparql' }
 * );
 * ```
 */
export function execute(
  builder: QueryBuilder,
  config: ExecutorConfig
): Promise<SparqlResult> {
  return builder.execute(config)
}