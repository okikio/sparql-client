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
  type IriInputType,
  isVariableToken,
  type PatternValueType,
  queryDocument,
  rawPattern,
  type SparqlExprType,
  type SparqlQueryType,
  type SparqlTermType,
  toGraphRef,
  toRawString,
  toVarOrIriRef,
  toVarToken,
  validateIRI,
  validatePrefixName,
  type VariableNameType,
} from './sparql.ts'
import { bind, filter, optional } from './utils.ts'

/** SELECT projection item accepted by the fluent builder. */
export type ProjectionItemType = string | SparqlTermType | SparqlExprType

/** SELECT projection or wildcard. */
export type ProjectionType = readonly ProjectionItemType[] | '*'

/** DESCRIBE target accepted by the fluent builder. */
export type DescribeItemType = string | SparqlTermType | RdfNamedNode

/** Sort order for ORDER BY clauses. */
export type SortDirectionType = 'ASC' | 'DESC'

/** One ORDER BY variable and optional direction. */
export interface SortSpecType {
  /** Variable or expression used as the sort key. */
  readonly variable: string
  /** RDF 1.2 base text direction associated with this language value. */
  readonly direction?: SortDirectionType
}

/** SELECT duplicate modifier. */
export type SelectModifierType = 'none' | 'distinct' | 'reduced'

/**
 * Immutable query-builder state.
 *
 * `construct` is deliberately separate from `where`. A CONSTRUCT template is
 * output data syntax, while WHERE is the graph pattern evaluated by the query.
 */
interface QueryStateType {
  /** SPARQL query form currently represented by the builder state. */
  readonly type: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE'
  /** SELECT projection requested by the current query builder state. */
  readonly projection: ProjectionType
  /** Resources requested by a DESCRIBE query. */
  readonly describe: readonly DescribeItemType[]
  /** Triple templates emitted by a CONSTRUCT query. */
  readonly construct?: PatternValueType
  /** Prefix declarations available while serializing the current RDF or SPARQL document. */
  readonly prefixes: ReadonlyMap<string, string>
  /** Default graph IRIs included in the query dataset through `FROM`. */
  readonly from: readonly string[]
  /** Named graph IRIs included in the query dataset. */
  readonly fromNamed: readonly string[]
  /** Graph patterns that form the query or update WHERE clause. */
  readonly where: readonly PatternValueType[]
  /** FILTER expressions appended to the current graph pattern. */
  readonly filters: readonly PatternValueType[]
  /** OPTIONAL graph-pattern groups appended to the current query. */
  readonly optional: readonly PatternValueType[]
  /** VALUES or binding records attached to the current query state. */
  readonly bindings: readonly PatternValueType[]
  /** UNION graph-pattern branches attached to the current query state. */
  readonly unions: readonly (readonly PatternValueType[])[]
  /** ORDER BY specifications applied in source order. */
  readonly sorts: readonly SortSpecType[]
  /** GROUP BY expressions applied before aggregate projection. */
  readonly groupBy: readonly string[]
  /** HAVING expressions applied after grouping. */
  readonly having: readonly SparqlExprType[]
  /** Value expressions retained from source metadata. */
  readonly values: ReadonlyMap<string, readonly SparqlTermType[]>
  /** Maximum result rows requested by the current query. */
  readonly limit?: number
  /** Result rows skipped before query results are returned. */
  readonly offset?: number
  /** SELECT duplicate-handling mode: none, DISTINCT, or REDUCED. */
  readonly modifier: SelectModifierType
}

/** Shared empty state copied by each query-form constructor. */
const initialState: QueryStateType = {
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
function projectionText(item: ProjectionItemType): string {
  if (typeof item !== 'string') return item.value
  return toVarToken(item)
}

/**
 * Returns the output variable produced by one SELECT projection item.
 *
 * SPARQL forbids two projection entries that produce the same result-column
 * variable. Plain strings are variable names by API contract. Expression
 * projections can expose a result variable only through `(Expression AS ?v)`.
 * Keeping this check here lets `build()` reject invalid queries before a remote
 * endpoint or independent parser has to diagnose them.
 */
function projectionVariable(item: ProjectionItemType): string | undefined {
  const token = projectionText(item).trim()
  if (isVariableToken(token)) return `?${token.slice(1)}`
  const alias = /\bAS\s+([^\s)]+)\s*\)$/iu.exec(token)?.[1]
  return alias && isVariableToken(alias) ? `?${alias.slice(1)}` : undefined
}

/** Rejects duplicate SELECT result-column variables after normalization. */
function validateProjection(projection: ProjectionType): void {
  if (projection === '*') return
  const seen = new Set<string>()
  for (const item of projection) {
    const variable = projectionVariable(item)
    if (variable === undefined) continue
    if (seen.has(variable)) {
      throw new TypeError(`SELECT projection contains duplicate result variable '${variable}'.`)
    }
    seen.add(variable)
  }
}

/** Serializes one DESCRIBE target according to `VarOrIriRef`. */
function describeText(item: DescribeItemType): string {
  if (isRdfTerm(item)) return toVarOrIriRef(item)
  if (typeof item !== 'string') return item.value
  return toVarOrIriRef(item)
}

/** Resolves a namespace-like prefix input to its validated absolute IRI. */
function namespaceText(value: string | SparqlTermType | RdfNamedNode | Namespace): string {
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
function pushPattern(parts: string[], pattern: PatternValueType, depth = 1): void {
  const indent = '  '.repeat(depth)
  for (const line of pattern.value.split('\n')) parts.push(`${indent}${line}`)
}

/** Immutable builder for SELECT, ASK, CONSTRUCT, and DESCRIBE query documents. */
export class QueryBuilder {
  /** Mutable builder state owned by this builder instance and copied when an immutable output is produced. */
  readonly #state: QueryStateType

  /** Creates one immutable builder from already-normalized state. */
  private constructor(state: QueryStateType) {
    this.#state = state
  }

  /** Starts a SELECT query. */
  static select(projection: ProjectionType = '*'): QueryBuilder {
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
  static construct(template?: PatternValueType): QueryBuilder {
    return new QueryBuilder({
      ...initialState,
      type: 'CONSTRUCT',
      projection: [],
      ...(template === undefined ? {} : { construct: template }),
    })
  }

  /** Starts a DESCRIBE query over variables and/or explicit RDF named nodes. */
  static describe(resources: readonly DescribeItemType[]): QueryBuilder {
    if (resources.length === 0) throw new TypeError('DESCRIBE requires at least one target.')
    return new QueryBuilder({
      ...initialState,
      type: 'DESCRIBE',
      projection: [],
      describe: [...resources],
    })
  }

  /** Adds a FROM graph IRI. */
  from(graph: IriInputType): QueryBuilder {
    return new QueryBuilder({ ...this.#state, from: [...this.#state.from, toGraphRef(graph)] })
  }

  /** Adds a FROM NAMED graph IRI. */
  fromNamed(graph: IriInputType): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      fromNamed: [...this.#state.fromNamed, toGraphRef(graph)],
    })
  }

  /**
   * Declares one prefix.
   *
   * The namespace can be a string, RDF named node, SPARQL IRI term, or an
   * `@okikio/rdf` namespace function. Namespace functions therefore compose
   * directly with SPARQL without flattening them into application strings.
   */
  prefix(name: string, iri: string | SparqlTermType | RdfNamedNode | Namespace): QueryBuilder {
    validatePrefixName(name)
    const prefixes = new Map(this.#state.prefixes)
    prefixes.set(name, namespaceText(iri))
    return new QueryBuilder({ ...this.#state, prefixes })
  }

  /** Adds graph patterns to WHERE. */
  where(...patterns: readonly PatternValueType[]): QueryBuilder {
    return new QueryBuilder({ ...this.#state, where: [...this.#state.where, ...patterns] })
  }

  /** Adds FILTER graph-pattern clauses from expressions. */
  filter(...conditions: readonly SparqlExprType[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      filters: [...this.#state.filters, ...conditions.map((value) => filter(value))],
    })
  }

  /** Adds OPTIONAL graph-pattern clauses. */
  optional(...patterns: readonly PatternValueType[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      optional: [...this.#state.optional, ...patterns.map((value) => optional(value))],
    })
  }

  /** Adds a BIND clause with an explicit output variable. */
  bind(expression: SparqlExprType | SparqlTermType, variable: VariableNameType): QueryBuilder {
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
  union(...branches: readonly PatternValueType[]): QueryBuilder {
    if (branches.length < 2) {
      throw new TypeError('UNION requires at least two graph-pattern branches.')
    }
    return new QueryBuilder({ ...this.#state, unions: [...this.#state.unions, [...branches]] })
  }

  /** Adds GROUP BY variables. */
  groupBy(...variables: readonly VariableNameType[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      groupBy: [...this.#state.groupBy, ...variables.map((value) => toVarToken(value))],
    })
  }

  /** Adds HAVING expressions. */
  having(...conditions: readonly SparqlExprType[]): QueryBuilder {
    return new QueryBuilder({ ...this.#state, having: [...this.#state.having, ...conditions] })
  }

  /** Adds one ORDER BY variable. */
  orderBy(variable: VariableNameType, direction?: SortDirectionType): QueryBuilder {
    const sort = direction === undefined
      ? { variable: toVarToken(variable) }
      : { variable: toVarToken(variable), direction }
    return new QueryBuilder({ ...this.#state, sorts: [...this.#state.sorts, sort] })
  }

  /** Sets LIMIT after validating the non-negative integer grammar. */
  limit(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(`LIMIT must be a non-negative integer, got ${count}.`)
    }
    return new QueryBuilder({ ...this.#state, limit: count })
  }

  /** Sets OFFSET after validating the non-negative integer grammar. */
  offset(count: number): QueryBuilder {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(`OFFSET must be a non-negative integer, got ${count}.`)
    }
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
  values(variable: VariableNameType, values: readonly SparqlTermType[]): QueryBuilder {
    const blocks = new Map(this.#state.values)
    blocks.set(toVarToken(variable), [...values])
    return new QueryBuilder({ ...this.#state, values: blocks })
  }

  /** Explicitly converts this complete query into a subquery graph pattern. */
  asSubquery(): PatternValueType {
    return rawPattern(`{ ${this.build().value} }`)
  }

  /** Builds one complete query document. */
  build(): SparqlQueryType {
    const parts: string[] = []

    for (const [name, iri] of this.#state.prefixes) parts.push(`PREFIX ${name}: <${iri}>`)
    if (this.#state.prefixes.size > 0) parts.push('')

    if (this.#state.type === 'SELECT') {
      validateProjection(this.#state.projection)
      const modifier = this.#state.modifier === 'none'
        ? ''
        : `${this.#state.modifier.toUpperCase()} `
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
      parts.push(
        `ORDER BY ${
          this.#state.sorts.map((sort) =>
            sort.direction ? `${sort.direction}(${sort.variable})` : sort.variable
          ).join(' ')
        }`,
      )
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
export function subquery(builder: QueryBuilder): PatternValueType {
  return builder.asSubquery()
}
