import * as structure from './structure.ts'
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
import { bind, filter, optional, values as dataValues } from './utils.ts'
import type { ValuesItemType } from './sparql.ts'

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
/** Persistent append chunks keep incremental builder calls linear in admitted patterns. */
interface GroupType {
  readonly previous?: GroupType
  readonly items: readonly PatternValueType[]
}

/** Flattens chunks once, preserving order without recursive calls. */
function items(group: GroupType | undefined): PatternValueType[] {
  const chunks: (readonly PatternValueType[])[] = []
  for (let current = group; current; current = current.previous) chunks.push(current.items)
  return chunks.reverse().flat()
}

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
  /** Ordered group items, including BIND and VALUES in source order. */
  readonly group: GroupType | undefined
  /** ORDER BY specifications applied in source order. */
  readonly sorts: readonly SortSpecType[]
  /** GROUP BY expressions applied before aggregate projection. */
  readonly groupBy: readonly string[]
  /** HAVING expressions applied after grouping. */
  readonly having: readonly SparqlExprType[]
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
  group: undefined,
  sorts: [],
  groupBy: [],
  having: [],
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
  if (typeof item !== 'string') {
    const alias = structure.projection(item)
    if (alias) return alias
  }
  const token = projectionText(item).trim()
  return isVariableToken(token) ? `?${token.slice(1)}` : undefined
}

/** Rejects duplicate SELECT result-column variables after normalization. */
function validateProjection(projection: ProjectionType): void {
  if (projection === '*') return
  if (projection.length === 0) throw new TypeError('SELECT needs a projection or wildcard.')
  const seen = new Set<string>()
  for (const item of projection) {
    const variable = projectionVariable(item)
    if (variable === undefined) {
      throw new TypeError('SELECT projection needs a variable or an explicit .as(variable) alias.')
    }
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
    return new QueryBuilder({
      ...initialState,
      type: 'SELECT',
      projection: projection === '*' ? '*' : [...projection],
    })
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
      ...(template === undefined ? {} : { construct: structure.snapshot(template) }),
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
    const namespace = namespaceText(iri)
    if (prefixes.has(name) && prefixes.get(name) !== namespace) {
      throw new TypeError(`Conflicting prefix ${name}.`)
    }
    prefixes.set(name, namespace)
    return new QueryBuilder({ ...this.#state, prefixes })
  }

  /** Appends group clauses in source order. FILTER retains the scope of this group. */
  where(...patterns: readonly PatternValueType[]): QueryBuilder {
    return new QueryBuilder({
      ...this.#state,
      group: {
        ...(this.#state.group ? { previous: this.#state.group } : {}),
        items: patterns.map(structure.snapshot),
      },
    })
  }

  /** Adds group-scoped FILTER expressions. */
  filter(...conditions: readonly SparqlExprType[]): QueryBuilder {
    return this.where(...conditions.map(filter))
  }

  /** Adds OPTIONAL groups in source order. */
  optional(...patterns: readonly PatternValueType[]): QueryBuilder {
    return this.where(...patterns.map(optional))
  }

  /** Adds a computed binding at this exact group position. */
  bind(expression: SparqlExprType | SparqlTermType, variable: VariableNameType): QueryBuilder {
    return this.where(bind(expression, variable))
  }

  /** Adds a disjunction without flattening branch scopes into the containing group. */
  union(...branches: readonly PatternValueType[]): QueryBuilder {
    if (branches.length < 2) throw new TypeError('UNION requires at least two branches.')
    const children = branches.map(structure.snapshot)
    const text = children.map((branch) => `{ ${branch.value} }`).join(' UNION ')
    return this.where(
      structure.pattern(rawPattern(text), {
        kind: 'union',
        bindings: children.flatMap((branch) => [...structure.scope([branch])]),
        children,
      }),
    )
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
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`LIMIT must be a non-negative integer, got ${count}.`)
    }
    return new QueryBuilder({ ...this.#state, limit: count })
  }

  /** Sets OFFSET after validating the non-negative integer grammar. */
  offset(count: number): QueryBuilder {
    if (!Number.isSafeInteger(count) || count < 0) {
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

  /** Appends one VALUES relation. Repeated blocks are joins, never silent replacements. */
  values(variable: VariableNameType, values: readonly ValuesItemType[]): QueryBuilder {
    return this.where(dataValues(variable, values))
  }

  /** Converts SELECT only into a SubSelect body; declarations belong to the containing document. */
  asSubquery(): PatternValueType {
    if (this.#state.type !== 'SELECT' || this.#state.from.length || this.#state.fromNamed.length) {
      throw new TypeError('Subqueries require SELECT without FROM/FROM NAMED.')
    }
    const body = new QueryBuilder({ ...this.#state, prefixes: new Map() }).build()
    const bound = this.#state.projection === '*'
      ? [...structure.scope(items(this.#state.group))]
      : this.#state.projection.map(projectionVariable).filter((value): value is string =>
        value !== undefined
      )
    return structure.pattern(rawPattern(`{ ${body.value} }`), {
      kind: 'subselect',
      bindings: bound,
      prefixes: new Map(this.#state.prefixes),
    })
  }

  /** Builds one complete query document. */
  build(): SparqlQueryType {
    const parts: string[] = []
    const group = items(this.#state.group)
    structure.scope(group)
    if (this.#state.type === 'SELECT') validateProjection(this.#state.projection)
    if (this.#state.construct) structure.template(this.#state.construct, 'construct')
    if (this.#state.type === 'CONSTRUCT' && !this.#state.construct) {
      for (const item of group) structure.template(item, 'construct')
    }
    const prefixes = new Map(this.#state.prefixes)
    const pending: object[] = [...group]
    while (pending.length) {
      const record = structure.inspect(pending.pop()!)
      for (const [name, iri] of record?.prefixes ?? []) {
        if (prefixes.has(name) && prefixes.get(name) !== iri) {
          throw new TypeError(`Conflicting subquery prefix ${name}.`)
        }
        prefixes.set(name, iri)
      }
      pending.push(...record?.children ?? [])
    }
    for (const [name, iri] of prefixes) parts.push(`PREFIX ${name}: <${iri}>`)
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

    if (group.length || this.#state.type !== 'DESCRIBE') {
      parts.push('WHERE {')
      for (const pattern of group) pushPattern(parts, pattern)
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
