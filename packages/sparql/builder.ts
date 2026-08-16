/**
 * Immutable fluent builders for complete SPARQL query documents.
 *
 * The builder keeps grammar roles separate. Terms and expressions are not graph
 * patterns, graph patterns are not complete queries, and a complete query only
 * becomes embeddable through the explicit `asSubquery()` operation.
 *
 * @module
 */

import { isTerm as isRdfTerm, type NamedNode as RdfNamedNode, type Namespace } from '@okikio/rdf'
import {
  queryDocument,
  rawPattern,
  toGraphRef,
  toRawString,
  toVarOrIriRef,
  toVarToken,
  validateIRI,
  validatePrefixName,
  type IriInput,
  type PatternValue,
  type SparqlExpr,
  type SparqlQuery,
  type SparqlTerm,
  type VariableName,
} from './sparql.ts'
import { bind, filter, optional } from './utils.ts'

/** SELECT projection item accepted by the fluent builder. */
export type ProjectionItem = string | SparqlTerm | SparqlExpr

/** SELECT projection or wildcard. */
export type Projection = readonly ProjectionItem[] | '*'

/** DESCRIBE target accepted by the fluent builder. */
export type DescribeItem = string | SparqlTerm | RdfNamedNode

/** Sort order for ORDER BY clauses. */
export type SortDirection = 'ASC' | 'DESC'

/** One ORDER BY variable and optional direction. */
export interface SortSpec {
  readonly variable: string
  readonly direction?: SortDirection
}

/** SELECT duplicate modifier. */
export type SelectModifier = 'none' | 'distinct' | 'reduced'

/**
 * Immutable query-builder state.
 *
 * `construct` is deliberately separate from `where`. A CONSTRUCT template is
 * output data syntax, while WHERE is the graph pattern evaluated by the query.
 */
interface QueryState {
  readonly type: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE'
  readonly projection: Projection
  readonly describe: readonly DescribeItem[]
  readonly construct?: PatternValue
  readonly prefixes: ReadonlyMap<string, string>
  readonly from: readonly string[]
  readonly fromNamed: readonly string[]
  readonly where: readonly PatternValue[]
  readonly filters: readonly PatternValue[]
  readonly optional: readonly PatternValue[]
  readonly bindings: readonly PatternValue[]
  readonly unions: readonly (readonly PatternValue[])[]
  readonly sorts: readonly SortSpec[]
  readonly groupBy: readonly string[]
  readonly having: readonly SparqlExpr[]
  readonly values: ReadonlyMap<string, readonly SparqlTerm[]>
  readonly limit?: number
  readonly offset?: number
  readonly modifier: SelectModifier
}

/** Shared empty state copied by each query-form constructor. */
const initialState: QueryState = {
  type: 'SELECT',
  projection: '*',
  describe: [],
  prefixes: new Map(),
  from: [],
  fromNamed: [],
  where: [],
  filters: [],
  optional: [],
  bindings: [],
  unions: [],
  sorts: [],
  groupBy: [],
  having: [],
  values: new Map(),
  modifier: 'none',
}

/** Serializes one SELECT projection item without turning arbitrary IRIs into variables. */
function projectionText(item: ProjectionItem): string {
  if (typeof item !== 'string') return item.value
  return toVarToken(item)
}

/** Serializes one DESCRIBE target according to `VarOrIriRef`. */
function describeText(item: DescribeItem): string {
  if (isRdfTerm(item)) return toVarOrIriRef(item)
  if (typeof item !== 'string') return item.value
  return toVarOrIriRef(item)
}

/** Resolves a namespace-like prefix input to its validated absolute IRI. */
function namespaceText(value: string | SparqlTerm | RdfNamedNode | Namespace): string {
  if (typeof value === 'function') {
    validateIRI(value.iri)
    return value.iri
  }
  if (isRdfTerm(value)) {
    validateIRI(value.value)
    return value.value
  }
  if (typeof value !== 'string') {
    const token = value.value.trim()
    const iri = token.startsWith('<') && token.endsWith('>') ? token.slice(1, -1) : token
    validateIRI(iri)
    return iri
  }
  const iri = toRawString(value)
  validateIRI(iri)
  return iri
}

/** Emits one indented pattern while preserving intentional internal newlines. */
function pushPattern(parts: string[], pattern: PatternValue, depth = 1): void {
  const indent = '  '.repeat(depth)
  for (const line of pattern.value.split('\n')) parts.push(`${indent}${line}`)
}

/** Immutable builder for SELECT, ASK, CONSTRUCT, and DESCRIBE query documents. */
export class QueryBuilder {
  readonly #state: QueryState

  /** Creates one immutable builder from already-normalized state. */
  private constructor(state: QueryState) {
    this.#state = state
  }

  /** Starts a SELECT query. */
  static select(projection: Projection = '*'): QueryBuilder {
    return new QueryBuilder({ ...initialState, type: 'SELECT', projection })
  }

  /** Starts an ASK query. */
  static ask(): QueryBuilder {
    return new QueryBuilder({ ...initialState, type: 'ASK', projection: [] })
  }

  /**
   * Starts a CONSTRUCT query.
   *
   * Omit `template` for the SPARQL `CONSTRUCT WHERE { ... }` shorthand. Supply
   * it to keep the result template separate from the WHERE graph pattern.
   */
  static construct(template?: PatternValue): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'CONSTRUCT',
      projection: [],
      ...(template === undefined ? {} : { construct: template }),
    })
  }

  /** Starts a DESCRIBE query over variables and/or explicit RDF named nodes. */
  static describe(resources: readonly DescribeItem[]): QueryBuilder {
    if (resources.length === 0) throw new TypeError('DESCRIBE requires at least one target.')
    return new QueryBuilder({ ...initialState, type: 'DESCRIBE', projection: [], describe: [...resources] })
  }

  /** Adds a FROM graph IRI. */
  from(graph: IriInput): QueryBuilder {
    return new QueryBuilder({ ...this.#state, from: [...this.#state.from, toGraphRef(graph)] })
  }

  /** Adds a FROM NAMED graph IRI. */
  fromNamed(graph: IriInput): QueryBuilder {
    return new QueryBuilder({ ...this.#state, fromNamed: [...this.#state.fromNamed, toGraphRef(graph)] })
  }

  /**
   * Declares one prefix.
   *
   * The namespace can be a string, RDF named node, SPARQL IRI term, or an
   * `@okikio/rdf` namespace function. Namespace functions therefore compose
   * directly with SPARQL without flattening them into application strings.
   */
  prefix(name: string, iri: string | SparqlTerm | RdfNamedNode | Namespace): QueryBuilder {
    validatePrefixName(name)
    const prefixes = new Map(this.#state.prefixes)
    prefixes.set(name, namespaceText(iri))
    return new QueryBuilder({ ...this.#state, prefixes })
  }

  /** Adds graph patterns to WHERE. */
  where(...patterns: readonly PatternValue[]): QueryBuilder {
    return new QueryBuilder({ ...this.#state, where: [...this.#state.where, ...patterns] })
  }

  /** Adds FILTER graph-pattern clauses from expressions. */
  filter(...conditions: readonly SparqlExpr[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      filters: [...this.#state.filters, ...conditions.map((value) => filter(value))],
    })
  }

  /** Adds OPTIONAL graph-pattern clauses. */
  optional(...patterns: readonly PatternValue[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      optional: [...this.#state.optional, ...patterns.map((value) => optional(value))],
    })
  }

  /** Adds a BIND clause with an explicit output variable. */
  bind(expression: SparqlExpr | SparqlTerm, variable: VariableName): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      bindings: [...this.#state.bindings, bind(expression, variable)],
    })
  }

  /**
   * Adds one UNION expression containing two or more graph-pattern branches.
   *
   * One call represents one disjunction. Each branch is emitted in its own
   * group so `union(a, b)` means `{ a } UNION { b }`, not `{ a b }`.
   */
  union(...branches: readonly PatternValue[]): QueryBuilder {
    if (branches.length < 2) throw new TypeError('UNION requires at least two graph-pattern branches.')
    return new QueryBuilder({ ...this.#state, unions: [...this.#state.unions, [...branches]] })
  }

  /** Adds GROUP BY variables. */
  groupBy(...variables: readonly VariableName[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      groupBy: [...this.#state.groupBy, ...variables.map((value) => toVarToken(value))],
    })
  }

  /** Adds HAVING expressions. */
  having(...conditions: readonly SparqlExpr[]): QueryBuilder {
    return new QueryBuilder({ ...this.#state, having: [...this.#state.having, ...conditions] })
  }

  /** Adds one ORDER BY variable. */
  orderBy(variable: VariableName, direction?: SortDirection): QueryBuilder {
    const sort = direction === undefined
      ? { variable: toVarToken(variable) }
      : { variable: toVarToken(variable), direction }
    return new QueryBuilder({ ...this.#state, sorts: [...this.#state.sorts, sort] })
  }

  /** Sets LIMIT after validating the non-negative integer grammar. */
  limit(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) throw new TypeError(`LIMIT must be a non-negative integer, got ${count}.`)
    return new QueryBuilder({ ...this.#state, limit: count })
  }

  /** Sets OFFSET after validating the non-negative integer grammar. */
  offset(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) throw new TypeError(`OFFSET must be a non-negative integer, got ${count}.`)
    return new QueryBuilder({ ...this.#state, offset: count })
  }

  /** Returns a builder with the SELECT `DISTINCT` solution modifier without mutating this builder. */
  distinct(): QueryBuilder {
    return new QueryBuilder({ ...this.#state, modifier: 'distinct' })
  }

  /** Returns a builder with the SELECT `REDUCED` solution modifier without mutating this builder. */
  reduced(): QueryBuilder {
    return new QueryBuilder({ ...this.#state, modifier: 'reduced' })
  }

  /** Adds one single-variable VALUES data block. */
  values(variable: VariableName, values: readonly SparqlTerm[]): QueryBuilder {
    const blocks = new Map(this.#state.values)
    blocks.set(toVarToken(variable), [...values])
    return new QueryBuilder({ ...this.#state, values: blocks })
  }

  /** Explicitly converts this complete query into a subquery graph pattern. */
  asSubquery(): PatternValue {
    return rawPattern(`{ ${this.build().value} }`)
  }

  /** Builds one complete query document. */
  build(): SparqlQuery {
    const parts: string[] = []

    for (const [name, iri] of this.#state.prefixes) parts.push(`PREFIX ${name}: <${iri}>`)
    if (this.#state.prefixes.size > 0) parts.push('')

    if (this.#state.type === 'SELECT') {
      const modifier = this.#state.modifier === 'none' ? '' : `${this.#state.modifier.toUpperCase()} `
      const projection = this.#state.projection === '*'
        ? '*'
        : this.#state.projection.map(projectionText).join(' ')
      parts.push(`SELECT ${modifier}${projection}`)
    } else if (this.#state.type === 'ASK') {
      parts.push('ASK')
    } else if (this.#state.type === 'DESCRIBE') {
      parts.push(`DESCRIBE ${this.#state.describe.map(describeText).join(' ')}`)
    } else if (this.#state.construct) {
      parts.push('CONSTRUCT {')
      pushPattern(parts, this.#state.construct)
      parts.push('}')
    } else {
      parts.push('CONSTRUCT')
    }

    for (const graph of this.#state.from) parts.push(`FROM ${graph}`)
    for (const graph of this.#state.fromNamed) parts.push(`FROM NAMED ${graph}`)

    const hasPattern = this.#state.where.length > 0 || this.#state.filters.length > 0 ||
      this.#state.optional.length > 0 || this.#state.bindings.length > 0 ||
      this.#state.unions.length > 0 || this.#state.values.size > 0

    if (this.#state.type === 'CONSTRUCT' && !this.#state.construct) {
      parts.push('WHERE {')
    } else if (hasPattern || this.#state.type === 'ASK' || this.#state.type === 'CONSTRUCT') {
      parts.push('WHERE {')
    }

    if (parts.at(-1) === 'WHERE {') {
      for (const [variable, values] of this.#state.values) {
        parts.push(`  VALUES ${variable} { ${values.map((value) => value.value).join(' ')} }`)
      }
      for (const pattern of this.#state.where) pushPattern(parts, pattern)
      for (const pattern of this.#state.filters) pushPattern(parts, pattern)
      for (const pattern of this.#state.optional) pushPattern(parts, pattern)
      for (const pattern of this.#state.bindings) pushPattern(parts, pattern)
      for (const union of this.#state.unions) {
        union.forEach((branch, index) => {
          if (index > 0) parts.push('  UNION')
          parts.push('  {')
          pushPattern(parts, branch, 2)
          parts.push('  }')
        })
      }
      parts.push('}')
    }

    if (this.#state.groupBy.length > 0) parts.push(`GROUP BY ${this.#state.groupBy.join(' ')}`)
    if (this.#state.having.length > 0) {
      parts.push(`HAVING(${this.#state.having.map((value) => value.value).join(' && ')})`)
    }
    if (this.#state.sorts.length > 0) {
      parts.push(`ORDER BY ${this.#state.sorts.map((sort) => sort.direction ? `${sort.direction}(${sort.variable})` : sort.variable).join(' ')}`)
    }
    if (this.#state.limit !== undefined) parts.push(`LIMIT ${this.#state.limit}`)
    if (this.#state.offset !== undefined) parts.push(`OFFSET ${this.#state.offset}`)

    return queryDocument(parts.join('\n'))
  }
}

/** Starts a SELECT query builder. */
export const select = QueryBuilder.select
/** Starts an ASK query builder. */
export const ask = QueryBuilder.ask
/** Starts a CONSTRUCT query builder. */
export const construct = QueryBuilder.construct
/** Starts a DESCRIBE query builder. */
export const describe = QueryBuilder.describe

/** Explicitly wraps a built query as a subquery graph pattern. */
export function subquery(builder: QueryBuilder): PatternValue {
  return builder.asSubquery()
}
