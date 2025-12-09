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
  type VariableName,
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
  static describe(resources: (string | SparqlValue)[]): QueryBuilder {
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
  from(graphIRI: string | SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      from: [...(this.state.from || []), exprTermString(graphIRI)],
    })
  }

  /**
   * Add FROM NAMED clause for named graph queries.
   * 
   * FROM NAMED declares which named graphs are available for GRAPH patterns.
   * Without FROM NAMED, GRAPH patterns can access any named graph. Use this
   * to restrict which graphs your query can access.
   * 
   * @param graphIRI Named graph IRI
   * 
   * @example Restrict to specific graph
   * ```ts
   * select(['?s', '?p', '?o'])
   *   .fromNamed('http://example.org/graph1')
   *   .where(graph('?g', triple('?s', '?p', '?o')))
   * ```
   */
  fromNamed(graphIRI: string | SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      fromNamed: [...(this.state.fromNamed || []), exprTermString(graphIRI)],
    })
  }

  /**
   * Declare a namespace prefix for abbreviated IRIs.
   * 
   * **Common use case:** Cleaning up queries by using short prefixes instead of typing
   * full IRIs everywhere. Makes queries more readable and less error-prone.
   * 
   * **How it works:** Prefix declarations appear at the top of the generated SPARQL query.
   * Once declared, you can use the short form (like `foaf:name`) anywhere in your patterns
   * instead of the full IRI (`<http://xmlns.com/foaf/0.1/name>`).
   * 
   * **Best practice:** Declare all your prefixes upfront before adding patterns. This keeps
   * the query structure clear and ensures prefixes are available for all subsequent patterns.
   * 
   * @param name - Prefix name (without the colon)
   * @param iri - Full namespace IRI
   * @returns QueryBuilder for chaining
   * 
   * @example Basic prefix usage
   * ```ts
   * select(['?name'])
   *   .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
   *   .where(triple('?person', 'foaf:name', '?name'))
   * 
   * // Generates:
   * // PREFIX foaf: <http://xmlns.com/foaf/0.1/>
   * // SELECT ?name WHERE { ?person foaf:name ?name }
   * ```
   * 
   * @example Multiple prefixes
   * ```ts
   * select(['?name', '?email'])
   *   .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
   *   .prefix('schema', 'https://schema.org/')
   *   .where(triple('?person', 'foaf:name', '?name'))
   *   .where(triple('?person', 'schema:email', '?email'))
   * 
   * // Generates:
   * // PREFIX foaf: <http://xmlns.com/foaf/0.1/>
   * // PREFIX schema: <https://schema.org/>
   * // SELECT ?name ?email WHERE { ... }
   * ```
   * 
   * @example Using namespace constants
   * ```ts
   * import { RDF, FOAF, getNamespaceIRI } from '@okikio/sparql'
   * 
   * select(['?person'])
   *   .prefix('rdf', getNamespaceIRI(RDF))
   *   .prefix('foaf', getNamespaceIRI(FOAF))
   *   .where(triple('?person', RDF.type, uri(FOAF.Person)))
   * ```
   * 
   * @example Overriding prefixes (last one wins)
   * ```ts
   * select(['?name'])
   *   .prefix('ex', 'http://example.org/old/')
   *   .prefix('ex', 'http://example.org/new/')  // Replaces previous
   *   .where(triple('?person', 'ex:name', '?name'))
   * // Uses http://example.org/new/
   * ```
   * 
   * @see getNamespaceIRI - Extract namespace IRI from constants
   */
  prefix(name: string | SparqlValue, iri: string | SparqlValue): QueryBuilder {
    const prefixes = new Map(this.state.prefixes || [])
    prefixes.set(
      exprTermString(name),
      exprTermString(iri)
    )
    return new QueryBuilder({
      ...this.state,
      prefixes,
    })
  }

  /**
   * Add a WHERE pattern.
   * 
   * WHERE patterns define what you're looking for in the graph. Each pattern
   * is typically created with triple(), triples(), node(), rel(), or match().
   * Multiple where() calls add patterns that must all match (they're ANDed together).
   * 
   * @param [...patterns] Patterns to match
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
  where(...patterns: SparqlValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      where: [...this.state.where, ...patterns],
    })
  }

  /**
   * Add a FILTER constraint.
   * 
   * Filters restrict results based on conditions. The condition should be a
   * boolean expression built with comparison operators, functions, or logical
   * operators. Filters are applied after pattern matching.
   * 
   * @param [...conditions] Boolean expression
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
  filter(...conditions: SparqlValue[]): QueryBuilder {
    const filterValues = conditions.map(c => filterExpr(c))

    return new QueryBuilder({
      ...this.state,
      filters: [...this.state.filters, ...filterValues],
    })
  }

  /**
   * Add an OPTIONAL pattern.
   * 
   * Optional patterns don't fail the query if they don't match - they just
   * leave variables unbound. This is like LEFT JOIN in SQL. Use it for data
   * that might not exist for all results.
   * 
   * @param [...patterns] Pattern to optionally match
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
  optional(...patterns: SparqlValue[]): QueryBuilder {
    const optionalPatterns = patterns.map(p => optionalExpr(p))

    return new QueryBuilder({
      ...this.state,
      optional: [...this.state.optional, ...optionalPatterns],
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
  bind(expression: SparqlValue, asVariable?: VariableName): QueryBuilder {
    const bindValue = asVariable
      ? bindExpr(expression, normalizeVariableName(asVariable))
      : bindExpr(expression)

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
   * Add GROUP BY clause for aggregation.
   * 
   * GROUP BY groups results by specified variables before applying aggregation
   * functions like COUNT, SUM, MAX. All non-aggregated variables in your SELECT
   * must appear in GROUP BY.
   * 
   * @param variables Variables to group by (with or without ? prefix)
   * 
   * @example Count products per publisher
   * ```ts
   * select([v('publisher'), count(v('product')).as('total')])
   *   .where(triple('?product', 'schema:publisher', '?publisher'))
   *   .groupBy('?publisher')
   * ```
   * 
   * @example Multiple grouping variables
   * ```ts
   * select([v('publisher'), v('year'), count().as('total')])
   *   .where(triple('?product', 'schema:publisher', '?publisher'))
   *   .where(triple('?product', 'schema:datePublished', '?date'))
   *   .bind(year(v('date')), 'year')
   *   .groupBy('?publisher', '?year')
   * ```
   */
  groupBy(...variables: VariableName[]): QueryBuilder {
    const normalized = variables.map(v => 
      `?${normalizeVariableName(v)}`
    )
    return new QueryBuilder({
      ...this.state,
      groupBy: [...(this.state.groupBy || []), ...normalized],
    })
  }

  /**
   * Add HAVING clause to filter grouped results.
   * 
   * HAVING is like FILTER but operates on grouped/aggregated data. Use it to
   * filter based on aggregation results (like "groups with COUNT > 10").
   * Multiple having() calls are ANDed together.
   * 
   * @param condition Boolean expression on aggregated values
   * 
   * @example Publishers with many products
   * ```ts
   * select([v('publisher'), count().as('total')])
   *   .where(triple('?product', 'schema:publisher', '?publisher'))
   *   .groupBy('?publisher')
   *   .having(gt(count(), 10))
   * ```
   * 
   * @example Multiple conditions
   * ```ts
   * select([v('publisher'), sum(v('price')).as('revenue')])
   *   .where(triple('?product', 'schema:publisher', '?publisher'))
   *   .where(triple('?product', 'schema:price', '?price'))
   *   .groupBy('?publisher')
   *   .having(and(
   *     gt(count(), 5),
   *     gt(sum(v('price')), 1000)
   *   ))
   * ```
   */
  having(condition: SparqlValue): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      having: [...(this.state.having || []), condition],
    })
  }

  /**
   * Add VALUES clause for inline data.
   * 
   * VALUES provides a list of possible bindings for a variable. Like a small
   * in-memory table that gets joined with your query patterns. Useful for
   * filtering by specific values or providing test data.
   * 
   * @param variable Variable name (with or without ?)
   * @param vals Array of values
   * 
   * @example Filter by specific cities
   * ```ts
   * select(['?person', '?city'])
   *   .values('city', [str('London'), str('Paris'), str('Tokyo')])
   *   .where(triple('?person', 'schema:address', '?address'))
   *   .where(triple('?address', 'schema:city', '?city'))
   * ```
   * 
   * @example Provide test data
   * ```ts
   * select(['?city', '?population'])
   *   .values('city', [str('NYC'), str('LA'), str('Chicago')])
   *   .where(triple('?city', 'schema:population', '?population'))
   * ```
   */
  values(variable: VariableName, vals: SparqlValue[]): QueryBuilder {
    const varName = normalizeVariableName(variable)
    const existing = this.state.values || new Map()
    const updated = new Map(existing)
    updated.set(varName, vals)
    
    return new QueryBuilder({
      ...this.state,
      values: updated,
    })
  }

  /**
   * Convert this query to a subquery pattern.
   * 
   * Subqueries let you use a SELECT as a pattern in another query's WHERE clause.
   * The subquery executes first, binding its variables, then those bindings are
   * available to the outer query. Useful for complex aggregations or filtering
   * on aggregated results.
   * 
   * @returns SparqlValue representing the subquery block
   * 
   * @example Nested aggregation
   * ```ts
   * const inner = select([v('publisher'), count().as('total')])
   *   .where(triple('?product', 'schema:publisher', '?publisher'))
   *   .groupBy('?publisher')
   * 
   * const outer = select([v('publisher'), v('total')])
   *   .where(inner.asSubquery())
   *   .filter(gt(v('total'), 10))
   * ```
   * 
   * @example Multi-level analysis
   * ```ts
   * // Count per property-range pair
   * const level1 = select([v('property'), v('range'), count().as('c')])
   *   .where(triple('?s', '?property', '?o'))
   *   .where(triple('?o', 'a', '?range'))
   *   .groupBy('?property', '?range')
   * 
   * // Aggregate to single range per property
   * const level2 = select([v('property'), sample(v('range')).as('mainRange')])
   *   .where(level1.asSubquery())
   *   .groupBy('?property')
   * 
   * const query = construct(triple('?property', 'rdfs:range', '?mainRange'))
   *   .where(level2.asSubquery())
   * ```
   */
  asSubquery(): SparqlValue {
    const query = this.build().value
    return { __sparql: true, value: `{\n  ${query}\n}` }
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
  orderBy(variable: VariableName, direction?: SortDirection): QueryBuilder {
    return new QueryBuilder({
      ...this.state,
      sorts: [...this.state.sorts, { variable: normalizeVariableName(variable), direction }],
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

    // PREFIX declarations
    if (this.state.prefixes && this.state.prefixes.size > 0) {
      for (const [name, iri] of this.state.prefixes) {
        parts.push(`PREFIX ${name}: <${iri}>`)
      }
      parts.push('') // Blank line after prefixes for readability
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

    // FROM NAMED clauses
    if (this.state.fromNamed) {
      for (const graph of this.state.fromNamed) {
        parts.push(`FROM NAMED <${graph}>`)
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
          parts.push(`  VALUES ?${varName} { ${valueStrs} }`)
        }
      }

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
 * Create a subquery from a query builder.
 * 
 * Convenience function that's equivalent to calling builder.asSubquery().
 * Subqueries let you nest SELECT queries within WHERE clauses for complex
 * analytical queries.
 * 
 * @param builder Query to use as subquery
 * @returns SparqlValue for use in WHERE clause
 * 
 * @example
 * ```ts
 * const inner = select([v('property'), count().as('total')])
 *   .where(triple('?s', '?property', '?o'))
 *   .groupBy('?property')
 * 
 * const outer = select(['?property', '?total'])
 *   .where(subquery(inner))
 *   .filter(gt(v('total'), 10))
 * ```
 */
export function subquery(builder: QueryBuilder): SparqlValue {
  return builder.asSubquery()
}

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