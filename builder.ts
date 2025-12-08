/**
 * Fluent query builder for SPARQL.
 * 
 * Building SPARQL queries by concatenating strings gets messy fast. You lose type
 * safety, formatting becomes inconsistent, and it's easy to make syntax errors.
 * This builder gives you a chainable API inspired by Drizzle ORM - each method
 * adds a clause to your query and returns a new builder.
 * 
 * The pattern is simple: start with a query type (select, ask, construct), add
 * clauses (where, filter, optional), then build or execute. Each step is type-safe
 * and the final query is properly formatted.
 * 
 * Think of it like building a sentence. You start with the verb (SELECT), add the
 * details (WHERE patterns, FILTER conditions), and finish with modifiers (ORDER BY,
 * LIMIT). The builder handles all the SPARQL syntax so you can focus on expressing
 * your query logic.
 * 
 * @example Basic SELECT query
 * ```ts
 * const query = select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .filter(gte(v('age'), 18))
 *   .orderBy('?name')
 *   .limit(10)
 * 
 * const result = await query.execute(config)
 * ```
 * 
 * @example Using with node patterns
 * ```ts
 * const person = node('person', 'foaf:Person')
 *   .prop('foaf:name', v('name'))
 *   .prop('foaf:age', v('age'))
 * 
 * const query = select(['?name', '?age'])
 *   .where(person)
 *   .filter(gte(v('age'), 21))
 *   .distinct()
 * ```
 * 
 * @module
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
 * Pattern-like input for WHERE/OPTIONAL/UNION clauses.
 * 
 * Most helpers (triple, triples, node, rel, match) return SparqlValue. You can
 * also pass raw strings if needed, though the type-safe helpers are preferred.
 */
export type PatternLike = string | SparqlValue

/**
 * Variables to select in query results.
 * 
 * Can be an array of variable names (with or without ? prefix), or the wildcard
 * '*' to select all variables.
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
 * 
 * These are mutually exclusive - you can only have one per query:
 * - none: No modifier (default)
 * - distinct: Remove duplicate rows
 * - reduced: Allow implementation to remove some duplicates (optimization hint)
 */
export type SelectModifier = 'none' | 'distinct' | 'reduced'

// ============================================================================
// Query Builder State
// ============================================================================

/**
 * Internal state for the query builder.
 * 
 * This is immutable - each builder method creates a new state object rather
 * than modifying the existing one. This makes the builder safe to reuse and
 * compose.
 */
interface QueryState {
  readonly type: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE'
  readonly projection: Projection
  readonly from?: string[]
  readonly where: SparqlValue[]
  readonly filters: SparqlValue[]
  readonly optional: SparqlValue[]
  readonly bindings: SparqlValue[]
  readonly unions: SparqlValue[][]
  readonly sorts: SortSpec[]
  readonly limit?: number
  readonly offset?: number
  readonly modifier: SelectModifier
}

/**
 * Initial empty state for new queries.
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
 * Fluent query builder for SPARQL.
 * 
 * Each method returns a new QueryBuilder with updated state. This immutability
 * means you can safely store intermediate builders and branch from them without
 * worrying about shared state.
 * 
 * The builder compiles to standard SPARQL 1.1 queries. All the syntax details
 * (clause ordering, indentation, punctuation) are handled automatically.
 * 
 * @example Building incrementally
 * ```ts
 * const baseQuery = select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 * 
 * // Branch for adults
 * const adults = baseQuery
 *   .filter(gte(v('age'), 18))
 *   .orderBy('?age', 'DESC')
 * 
 * // Branch for children (baseQuery unchanged)
 * const children = baseQuery
 *   .filter(lt(v('age'), 18))
 *   .orderBy('?age', 'ASC')
 * ```
 */
export class QueryBuilder {
  private constructor(private readonly state: QueryState) { }

  /**
   * Start a SELECT query.
   * 
   * SELECT queries retrieve data from your graph. Specify which variables you
   * want in the results, or use '*' to get all variables that appear in your
   * WHERE patterns.
   * 
   * @param projection Variables to select, or '*' for all
   * 
   * @example Select specific variables
   * ```ts
   * select(['?name', '?age'])
   * ```
   * 
   * @example Select all
   * ```ts
   * select('*')
   * select() // defaults to '*'
   * ```
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
   * 
   * ASK queries return a boolean - does the pattern exist in the data? Use this
   * when you just need to check for the presence of certain patterns without
   * retrieving actual data.
   * 
   * @example Check if person exists
   * ```ts
   * ask()
   *   .where(triple('?person', 'foaf:name', 'Peter Parker'))
   * ```
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
   * 
   * CONSTRUCT queries create new RDF triples based on your pattern matches.
   * The template you provide defines what triples to output. Variables from
   * your WHERE patterns get filled in to create the constructed triples.
   * 
   * @param template Triple pattern to construct
   * 
   * @example Transform data shape
   * ```ts
   * construct(triples('?person', [
   *   ['schema:name', '?name'],
   *   ['schema:age', '?age']
   * ]))
   *   .where(triples('?person', [
   *     ['foaf:name', '?name'],
 *     ['foaf:age', '?age']
   *   ]))
   * ```
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
   * 
   * DESCRIBE queries return all triples about specified resources. It's like
   * asking "tell me everything you know about these things." The server decides
   * which triples are relevant.
   * 
   * @param resources IRIs or variables to describe
   * 
   * @example Describe resources
   * ```ts
   * describe(['<http://example.org/person/1>', '<http://example.org/person/2>'])
   * ```
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
   * Add a FROM clause to specify a named graph.
   * 
   * FROM restricts the query to only look in specific named graphs. Without
   * FROM clauses, queries search the default graph. You can add multiple FROM
   * clauses to query across several graphs.
   * 
   * @param graphIRI IRI of the named graph
   * 
   * @example Query specific graph
   * ```ts
   * select(['?s', '?p', '?o'])
   *   .from('http://example.org/graph/data')
   *   .where(triple('?s', '?p', '?o'))
   * ```
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
   * WHERE patterns define what you're looking for in the graph. Each pattern
   * is typically created with triple(), triples(), node(), rel(), or match().
   * Multiple where() calls add patterns that must all match (they're ANDed together).
   * 
   * @param pattern Pattern to match
   * 
   * @example Basic triples
   * ```ts
   * query
   *   .where(triple('?person', 'foaf:name', '?name'))
   *   .where(triple('?person', 'foaf:age', '?age'))
   * ```
   * 
   * @example Node pattern
   * ```ts
   * const person = node('person', 'foaf:Person')
   *   .prop('foaf:name', v('name'))
   * 
   * query.where(person)
   * ```
   */
  where(pattern: SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      where: [...this.state.where, pattern],
    })
  }

  /**
   * Add a FILTER constraint.
   * 
   * Filters restrict results based on conditions. The condition should be a
   * boolean expression built with comparison operators, functions, or logical
   * operators. Filters are applied after pattern matching.
   * 
   * @param condition Boolean expression
   * 
   * @example Age filter
   * ```ts
   * query.filter(gte(v('age'), 18))
   * ```
   * 
   * @example Multiple conditions
   * ```ts
   * query.filter(and(
   *   gte(v('age'), 18),
   *   regex(v('name'), '^Spider', 'i')
   * ))
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
   * Add an OPTIONAL pattern.
   * 
   * Optional patterns don't fail the query if they don't match - they just
   * leave variables unbound. This is like LEFT JOIN in SQL. Use it for data
   * that might not exist for all results.
   * 
   * @param pattern Pattern to optionally match
   * 
   * @example Optional email
   * ```ts
   * query
   *   .where(triple('?person', 'foaf:name', '?name'))
   *   .optional(triple('?person', 'foaf:email', '?email'))
   * ```
   * 
   * Email will be bound if it exists, unbound otherwise.
   */
  optional(pattern: SparqlValue): QueryBuilder {
    const optionalPattern = optionalExpr(pattern)

    return new QueryBuilder({
      ...this.state,
      optional: [...this.state.optional, optionalPattern],
    })
  }

  /**
   * Add a BIND expression to create computed variables.
   * 
   * BIND lets you create new variables from expressions. The variable will
   * be available in the rest of the query and in results. This is useful for
   * deriving values, formatting strings, or doing calculations.
   * 
   * @param expression Expression to compute
   * @param asVariable Variable name for the result
   * 
   * @example Full name
   * ```ts
   * query.bind(
   *   concat(v('firstName'), ' ', v('lastName')),
   *   'fullName'
   * )
   * ```
   * 
   * @example Age calculation
   * ```ts
   * query.bind(
   *   sub(2024, v('birthYear')),
   *   'age'
   * )
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
   * Add a UNION of alternative patterns.
   * 
   * UNION means "match any of these patterns." It's like OR for patterns - if
   * any branch matches, you get results. Each argument is a complete pattern
   * that could stand alone.
   * 
   * @param branches Alternative patterns
   * 
   * @example Either type
   * ```ts
   * query.union(
   *   triple('?item', 'rdf:type', 'schema:Book'),
   *   triple('?item', 'rdf:type', 'schema:Movie')
   * )
   * ```
   * 
   * This matches items that are either books or movies.
   */
  union(...branches: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      unions: [...this.state.unions, branches],
    })
  }

  /**
   * Add ORDER BY clause for sorting results.
   * 
   * Results are sorted by the specified variable. Default is ascending order
   * unless you specify 'DESC'. Multiple orderBy() calls create a multi-level
   * sort (first by first variable, then by second, etc.).
   * 
   * @param variable Variable to sort by (with or without ?)
   * @param direction Optional sort direction
   * 
   * @example Sort by age
   * ```ts
   * query.orderBy('?age', 'DESC')
   * ```
   * 
   * @example Multi-level sort
   * ```ts
   * query
   *   .orderBy('?lastName')
   *   .orderBy('?firstName')
   * ```
   */
  orderBy(variable: string, direction?: SortDirection): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      sorts: [...this.state.sorts, { variable, direction }],
    })
  }

  /**
   * Add LIMIT clause to cap result count.
   * 
   * Limits the number of results returned. Useful for pagination or when you
   * only need a sample of results. Combine with OFFSET for pagination.
   * 
   * @param count Maximum number of results
   * 
   * @example First 10 results
   * ```ts
   * query.limit(10)
   * ```
   */
  limit(count: number): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      limit: count,
    })
  }

  /**
   * Add OFFSET clause to skip results.
   * 
   * Skips the first N results. Used with LIMIT for pagination.
   * 
   * @param count Number of results to skip
   * 
   * @example Second page (10 per page)
   * ```ts
   * query.offset(10).limit(10)
   * ```
   */
  offset(count: number): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      offset: count,
    })
  }

  /**
   * Use DISTINCT modifier to remove duplicate rows.
   * 
   * DISTINCT ensures each result row is unique. This is useful when your patterns
   * might match the same data multiple ways but you only want each unique result
   * once.
   * 
   * @example Unique names
   * ```ts
   * select(['?name']).distinct()
   * ```
   */
  distinct(): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      modifier: 'distinct',
    })
  }

  /**
   * Use REDUCED modifier as optimization hint.
   * 
   * REDUCED allows the query engine to eliminate some duplicates as an optimization.
   * Unlike DISTINCT, it doesn't guarantee uniqueness, but it can be faster. Use this
   * when you don't need strict duplicate removal.
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
   * Build the final SPARQL query string.
   * 
   * Compiles all the clauses into a properly formatted SPARQL query. The output
   * follows standard SPARQL 1.1 syntax with consistent formatting.
   * 
   * @returns Complete query as SparqlValue
   * 
   * @example
   * ```ts
   * const queryString = query.build().value
   * console.log(queryString) // Pretty-printed SPARQL
   * ```
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

      // FILTER expressions
      for (const filter of this.state.filters) {
        parts.push(`  ${filter.value}`)
      }

      // OPTIONAL blocks
      for (const optional of this.state.optional) {
        parts.push(`  ${optional.value}`)
      }

      // BIND expressions
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
   * Execute the query against a SPARQL endpoint.
   * 
   * Builds the query and sends it to the specified endpoint. Returns a result
   * object that's either successful (with data) or failed (with error details).
   * 
   * @param config Endpoint configuration
   * @returns Promise of query result
   * 
   * @example
   * ```ts
   * const result = await query.execute({
   *   endpoint: 'http://localhost:9999/sparql'
   * })
   * 
   * if (result.success) {
   *   console.log(result.data)
   * } else {
   *   console.error(result.error.type, result.error.message)
   * }
   * ```
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
 * Quick execute shorthand.
 * 
 * Convenience function that builds and executes a query in one call. Useful
 * when you don't need to inspect the generated SPARQL.
 * 
 * @param builder Query builder
 * @param config Endpoint configuration
 * @returns Promise of query result
 * 
 * @example
 * ```ts
 * const result = await execute(
 *   select(['?name'])
 *     .where(triple('?person', 'foaf:name', '?name'))
 *     .limit(10),
 *   { endpoint: 'http://localhost:9999/sparql' }
 * )
 * ```
 */
export function execute(
  builder: QueryBuilder,
  config: ExecutorConfig
): Promise<SparqlResult> {
  return builder.execute(config)
}