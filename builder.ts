/**
 * Fluent query builder for SPARQL.
 * 
 * Building SPARQL queries by concatenating strings gets messy fast. You lose type
 * safety, formatting becomes inconsistent, and it's easy to make syntax errors.
 * This builder gives you a chainable API inspired by Drizzle ORM.
 * 
 * ## Security Model
 * 
 * The builder distinguishes between SYNTAX and DATA VALUES:
 * 
 * **Syntax elements** (validated, not escaped):
 * - Variable names: `?name`, `?age`
 * - Prefix names: `foaf`, `schema`
 * - IRIs: `http://xmlns.com/foaf/0.1/`
 * - Prefixed names: `foaf:name`, `rdf:type`
 * 
 * **Data values** (escaped, type-annotated):
 * - Strings passed to filter expressions
 * - Values in BIND expressions
 * - Literal values in patterns
 * 
 * @module
 */

import {
  rawPattern,
  validatePrefixName,
  validateIRI,
  isSparqlValue,
  toRawString,
  toVarToken,
  toVarOrIriRef,
  toGraphRef,
  type SparqlValue,
  type VariableName,
  type PatternValue,
  type SparqlTerm,
  SparqlExpr,
} from './sparql.ts'
import { createExecutor, type BindingMap, type ExecutionConfig, type QueryResult } from './executor.ts'
import { bind, filter, optional } from './utils.ts'

// ============================================================================
// Core Query Types
// ============================================================================

/**
 * Pattern-like input for WHERE/OPTIONAL/UNION clauses.
 */
export type PatternLike = string | SparqlExpr | SparqlTerm

/**
 * Variables to select in query results.
 */
export type Projection = PatternLike[] | '*'

/**
 * Sort order for ORDER BY clauses.
 */
export type SortDirection = 'ASC' | 'DESC'

/**
 * Sort specification combining variable and direction.
 */
export interface SortSpec {
  readonly variable: string
  readonly direction?: SortDirection
}

/**
 * SELECT query modifiers.
 */
export type SelectModifier = 'none' | 'distinct' | 'reduced'

// ============================================================================
// Internal Helpers for Syntax vs Value Handling
// ============================================================================

/**
 * Process a projection variable (for SELECT clause).
 * 
 * Projection items can be:
 * - Variable strings: "?name" or "name" → ?name
 * - SparqlValue objects: passed through
 * - Expressions with AS: already wrapped
 */
function processProjectionItem(item: PatternLike): string {
  if (isSparqlValue(item)) return item.value
  
  // Plain string - treat as variable name
  const str = item.trim()
  
  // Already looks like a variable
  return toVarToken(str)
}

/**
 * Process an DESCRIBE statement.
 */
function processDescribeItem(item: PatternLike): string {
  if (isSparqlValue(item)) return item.value
  return toVarOrIriRef(item) // <- grammar helper
}

// ============================================================================
// Query Builder State
// ============================================================================

interface QueryState {
  readonly type: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE'
  readonly projection: Projection
  readonly prefixes?: Map<string, string>
  readonly from?: string[]
  readonly fromNamed?: string[]
  readonly where: SparqlValue[]
  readonly filters: SparqlValue[]
  readonly optional: SparqlValue[]
  readonly bindings: SparqlValue[]
  readonly unions: SparqlValue[][]
  readonly sorts: SortSpec[]
  readonly limit?: number
  readonly offset?: number
  readonly modifier: SelectModifier
  readonly groupBy?: string[]
  readonly having?: SparqlValue[]
  readonly values?: Map<string, SparqlValue[]>
}

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

export class QueryBuilder {
  private constructor(private readonly state: QueryState) { }

  /**
   * Start a SELECT query.
   */
  static select(projection: Projection = '*'): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'SELECT',
      projection,
    })
  }

  /**
   * Start an ASK query.
   */
  static ask(): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'ASK',
      projection: [],
    })
  }

  /**
   * Start a CONSTRUCT query.
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
   * Start a DESCRIBE query.
   */
  static describe(resources: PatternLike[]): QueryBuilder {
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
   * Add a FROM clause to specify a named graph.
   * 
   * @param graphIRI - Full IRI of the graph (validated)
   */
  from(graphIRI: string | SparqlValue): QueryBuilder {
    const graphRef = toGraphRef(graphIRI)
    
    return new QueryBuilder({
      ...this.state,
      from: [...(this.state.from || []), graphRef],
    })
  }

  /**
   * Add FROM NAMED clause for named graph queries.
   * 
   * @param graphIRI - Full IRI of the named graph (validated)
   */
  fromNamed(graphIRI: string | SparqlValue): QueryBuilder {
    const graphRef = toGraphRef(graphIRI)
    
    return new QueryBuilder({
      ...this.state,
      fromNamed: [...(this.state.fromNamed || []), graphRef],
    })
  }

  /**
   * Declare a namespace prefix for abbreviated IRIs.
   * 
   * Both the prefix name and IRI are validated to prevent injection attacks.
   * 
   * @param name - Prefix name (e.g., "foaf", "schema") - validated
   * @param iri - Full namespace IRI (e.g., "http://xmlns.com/foaf/0.1/") - validated
   * 
   * @throws {Error} If prefix name contains invalid characters
   * @throws {Error} If IRI is malformed or contains injection characters
   * 
   * @example
   * ```ts
   * select(['?name'])
   *   .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
   *   .where(triple('?person', 'foaf:name', '?name'))
   * ```
   */
  prefix(name: string | SparqlValue, iri: string | SparqlValue): QueryBuilder {
    const prefixName = toRawString(name)
    const namespaceIRI = toRawString(iri)
    
    // Validate both to prevent injection
    validatePrefixName(prefixName)
    validateIRI(namespaceIRI)
    
    const prefixes = new Map(this.state.prefixes || [])
    prefixes.set(prefixName, namespaceIRI)
    
    return new QueryBuilder({
      ...this.state,
      prefixes,
    })
  }

  /**
   * Add a WHERE pattern.
   * 
   * Patterns should be created using triple(), triples(), node(), or other
   * pattern helpers that return SparqlValue objects.
   */
  where(...patterns: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      where: [...this.state.where, ...patterns],
    })
  }

  /**
   * Add a FILTER constraint.
   * 
   * Conditions should be created using expression helpers (eq, gte, regex, etc.)
   * that properly handle escaping for data values.
   */
  filter(...conditions: SparqlValue[]): QueryBuilder {
    const filterValues = conditions.map(c => filter(c))

    return new QueryBuilder({
      ...this.state,
      filters: [...this.state.filters, ...filterValues],
    })
  }

  /**
   * Add an OPTIONAL pattern.
   */
  optional(...patterns: SparqlValue[]): QueryBuilder {
    const optionalPatterns = patterns.map(p => optional(p))

    return new QueryBuilder({
      ...this.state,
      optional: [...this.state.optional, ...optionalPatterns],
    })
  }

  /**
   * Add a BIND expression to create computed variables.
   * 
   * @param expression - Expression to compute (SparqlValue)
   * @param asVariable - Variable name for the result (validated)
   */
  bind(expression: SparqlValue, asVariable?: VariableName): QueryBuilder {
    const bindValue = asVariable
      ? bind(expression, asVariable)
      : bind(expression)

    return new QueryBuilder({
      ...this.state,
      bindings: [...this.state.bindings, bindValue],
    })
  }

  /**
   * Add a UNION of alternative patterns.
   */
  union(...branches: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      unions: [...this.state.unions, branches],
    })
  }

  /**
   * Add GROUP BY clause for aggregation.
   * 
   * @param variables - Variable names to group by (validated)
   */
  groupBy(...variables: VariableName[]): QueryBuilder {
    const normalized = variables.map(v => toVarToken(v))
    
    return new QueryBuilder({
      ...this.state,
      groupBy: [...(this.state.groupBy || []), ...normalized],
    })
  }

  /**
   * Add HAVING clause to filter grouped results.
   */
  having(...conditions: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      having: [...(this.state.having || []), ...conditions],
    })
  }

  /**
   * Add ORDER BY clause.
   * 
   * @param variable - Variable name to sort by (validated)
   * @param direction - Sort direction (ASC or DESC)
   */
  orderBy(variable: VariableName, direction?: SortDirection): QueryBuilder {
    const varStr = toVarToken(variable)
    
    return new QueryBuilder({
      ...this.state,
      sorts: [...this.state.sorts, { variable: varStr, direction }],
    })
  }

  /**
   * Add LIMIT clause.
   */
  limit(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`LIMIT must be a non-negative integer, got: ${count}`)
    }
    
    return new QueryBuilder({
      ...this.state,
      limit: count,
    })
  }

  /**
   * Add OFFSET clause.
   */
  offset(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`OFFSET must be a non-negative integer, got: ${count}`)
    }
    
    return new QueryBuilder({
      ...this.state,
      offset: count,
    })
  }

  /**
   * Use DISTINCT modifier to remove duplicate rows.
   */
  distinct(): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      modifier: 'distinct',
    })
  }

  /**
   * Use REDUCED modifier as optimization hint.
   */
  reduced(): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      modifier: 'reduced',
    })
  }

  /**
   * Add a VALUES clause for inline data.
   * 
   * @param varName - Variable name (validated)
   * @param vals - Values to match against (should be SparqlValue objects)
   */
  values(varName: VariableName, vals: SparqlTerm[]): QueryBuilder {
    const name = toVarToken(varName)
    const valuesMap = new Map(this.state.values || [])
    valuesMap.set(name, vals)
    
    return new QueryBuilder({
      ...this.state,
      values: valuesMap,
    })
  }

  /**
   * Wrap this query as a subquery for nesting.
   */
  asSubquery(): PatternValue {
    return rawPattern(`{ ${this.build().value} }`)
  }

  // --------------------------------------------------------------------------
  // Build & execute
  // --------------------------------------------------------------------------

  /**
   * Build the final SPARQL query string.
   */
  build(): PatternValue {
    const parts: string[] = []

    // PREFIX declarations
    if (this.state.prefixes && this.state.prefixes.size > 0) {
      for (const [name, iri] of this.state.prefixes) {
        // name and iri are already validated in prefix()
        parts.push(`PREFIX ${name}: <${iri}>`)
      }
      parts.push('')
    }

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
        : (this.state.projection as PatternLike[])
            .map(x => processProjectionItem(x))
            .join(' ')
      
      parts.push(`SELECT ${modifier}${proj}`)
    } else if (this.state.type === 'ASK') {
      parts.push('ASK')
    } else if (this.state.type === 'CONSTRUCT') {
      parts.push('CONSTRUCT')
    } else if (this.state.type === 'DESCRIBE') {
      const projection = Array.isArray(this.state.projection)
        ? (this.state.projection as PatternLike[])
            .map(x => processDescribeItem(x))
            .join(' ')
        : processDescribeItem(this.state.projection as PatternLike)
      parts.push(`DESCRIBE ${projection}`)
    }

    // FROM clauses (IRIs already validated)
    if (this.state.from) {
      for (const graph of this.state.from) {
        parts.push(`FROM ${graph}`)
      }
    }

    // FROM NAMED clauses (IRIs already validated)
    if (this.state.fromNamed) {
      for (const graph of this.state.fromNamed) {
        parts.push(`FROM NAMED ${graph}`)
      }
    }

    // WHERE clause
    if (
      this.state.where.length > 0 ||
      this.state.filters.length > 0 ||
      this.state.optional.length > 0 ||
      this.state.bindings.length > 0 ||
      this.state.unions.length > 0 ||
      this.state.values
    ) {
      parts.push('WHERE {')

      // VALUES clauses
      if (this.state.values) {
        for (const [varName, vals] of this.state.values.entries()) {
          const valueStrs = vals.map(v => v.value).join(' ')
          parts.push(`  VALUES ${varName} { ${valueStrs} }`)
        }
      }

      // WHERE patterns
      for (const pattern of this.state.where) {
        parts.push(`  ${pattern.value}`)
      }

      // FILTER expressions
      for (const f of this.state.filters) {
        parts.push(`  ${f.value}`)
      }

      // OPTIONAL blocks
      for (const opt of this.state.optional) {
        parts.push(`  ${opt.value}`)
      }

      // BIND expressions
      for (const b of this.state.bindings) {
        parts.push(`  ${b.value}`)
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

    // GROUP BY clause
    if (this.state.groupBy && this.state.groupBy.length > 0) {
      parts.push(`GROUP BY ${this.state.groupBy.join(' ')}`)
    }

    // HAVING clause
    if (this.state.having && this.state.having.length > 0) {
      const havingClauses = this.state.having
        .map(h => h.value)
        .join(' && ')
      parts.push(`HAVING(${havingClauses})`)
    }

    // ORDER BY clause
    if (this.state.sorts.length > 0) {
      const sorts = this.state.sorts.map((sort) => {
        if (sort.direction) {
          return `${sort.direction}(${sort.variable})`
        }
        return sort.variable
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

    return rawPattern(parts.join('\n'))
  }

  /**
   * Execute the query against a SPARQL endpoint.
   */
  execute<TBind extends BindingMap = BindingMap>(config: ExecutionConfig): Promise<QueryResult<TBind>> {
    const executor = createExecutor(config)
    return executor.execute<TBind>(this.build())
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

export const select = QueryBuilder.select
export const ask = QueryBuilder.ask
export const construct = QueryBuilder.construct
export const describe = QueryBuilder.describe

export function subquery(builder: QueryBuilder): SparqlValue {
  return builder.asSubquery()
}

export function execute<TBind extends BindingMap = BindingMap>(
  builder: QueryBuilder,
  config: ExecutionConfig
): Promise<QueryResult<TBind>> {
  return builder.execute<TBind>(config)
}