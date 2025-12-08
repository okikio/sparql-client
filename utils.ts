import { convertValue, isSparqlValue, normalizeVariableName, raw, strlit, validateVariableName, wrapSparqlValue, type VariableName, type SparqlInterpolatable, type SparqlValue } from './sparql.ts'

/**
 * Create VALUES clause for multiple values
 * 
 * @example
 * values('city', ['London', 'Paris', 'Tokyo'])
 * → VALUES ?city { "London" "Paris" "Tokyo" }
 */
export function values(
  varName: VariableName,
  items: SparqlInterpolatable[]
): SparqlValue {
  validateVariableName(varName)
  const converted = items.map((item) => convertValue(item)).join(' ')
  return wrapSparqlValue(`VALUES ?${varName} { ${converted} }`)
}

/**
 * Create FILTER expression
 * 
 * @example
 * filter(sparql`?age > ${18}`)
 * → FILTER(?age > 18)
 */
export function filter(expression: SparqlValue): SparqlValue {
  return wrapSparqlValue(`FILTER(${expression.value})`)
}

/**
 * Create OPTIONAL block
 * 
 * @example
 * optional(sparql`?person foaf:email ?email`)
 * → OPTIONAL { ?person foaf:email ?email }
 */
export function optional(pattern: SparqlValue): SparqlValue {
  return wrapSparqlValue(`OPTIONAL { ${pattern.value} }`)
}

/**
 * Create BIND expression
 * 
 * @example
 * bind(sparql`CONCAT(?firstName, " ", ?lastName)`, 'fullName')
 * → BIND(CONCAT(?firstName, " ", ?lastName) AS ?fullName)
 */
export function bind(expression: SparqlValue, varName: VariableName): SparqlValue {
  const _varName = normalizeVariableName(varName)
  validateVariableName(_varName)
  return wrapSparqlValue(`BIND(${expression.value} AS ?${_varName})`)
}

// ============================================================================
// Expression helpers (Drizzle-like SPARQL operations)
// ============================================================================

export type ExpressionPrimitive =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined

/**
 * Treat a value as an expression term.
 *
 * - SparqlValue → use its `.value` directly
 * - primitives  → encoded using the `sparql` template, so they become
 *                 correctly escaped literals or IRIs/variables (depending
 *                 on how you pass them)
 */
export function exprTerm(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  if (isSparqlValue(value)) {
    return value
  }
  // primitives go through convertValue via the template tag
  return wrapSparqlValue(convertValue(value))
}

/**
 * Internal: convert a value to the raw SPARQL term string.
 */
export function exprTermString(
  value: SparqlValue | ExpressionPrimitive,
): string {
  return exprTerm(value).value
}

/**
 * CONCAT(arg1, arg2, ...)
 *
 * @example
 * ```ts
 * const fullName = concat(variable('firstName'), ' ', variable('lastName'))
 * const q = select(['?fullName'])
 *   .bind(fullName, 'fullName')
 * ```
 */
export function concat(
  ...args: Array<SparqlValue | ExpressionPrimitive>
): SparqlValue {
  if (args.length === 0) {
    // CONCAT() is invalid; return an empty string literal
    return strlit('') // """"
  }

  const inner = args.map(exprTermString).join(', ')
  return raw(`CONCAT(${inner})`)
}

export function str(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`STR(${exprTermString(value)})`)
}

export function strlen(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`STRLEN(${exprTermString(value)})`)
}

export function ucase(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`UCASE(${exprTermString(value)})`)
}

export function lcase(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`LCASE(${exprTermString(value)})`)
}


export function contains(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `CONTAINS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

export function startsWith(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `STRSTARTS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

export function endsWith(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `STRENDS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

export function substr(
  text: SparqlValue | ExpressionPrimitive,
  start: SparqlValue | ExpressionPrimitive,
  length?: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  const t = exprTermString(text)
  const s = exprTermString(start)
  if (length === undefined) {
    return raw(`SUBSTR(${t}, ${s})`)
  }
  const l = exprTermString(length)
  return raw(`SUBSTR(${t}, ${s}, ${l})`)
}

export function replaceStr(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
  replacement: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  const textTerm = exprTermString(text)
  const patternTerm = exprTermString(pattern)
  const replacementTerm = exprTermString(replacement)
  return raw(`REPLACE(${textTerm}, ${patternTerm}, ${replacementTerm})`)
}


/**
 * REGEX helper
 *
 * @example
 * ```ts
 * const condition = regex(variable('name'), '^Spidey', 'i')
 * builder.filter(condition)
 * ```
 */
export function regex(
  text: SparqlValue | ExpressionPrimitive,
  pattern: string,
  flags?: string,
): SparqlValue {
  const textTerm = exprTermString(text)
  const patternTerm = exprTermString(pattern)
  const flagsTerm = flags ? `, ${exprTermString(flags)}` : ''
  return raw(`REGEX(${textTerm}, ${patternTerm}${flagsTerm})`)
}


// Nullish / list helpers (Drizzle-like)

export function isNull(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`!BOUND(${exprTermString(value)})`)
}

export function isNotNull(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`BOUND(${exprTermString(value)})`)
}

export function inList(
  expr: SparqlValue | ExpressionPrimitive,
  values: Array<SparqlValue | ExpressionPrimitive>,
): SparqlValue {
  if (values.length === 0) {
    // Nothing is in an empty set.
    return raw('false')
  }
  const list = values.map(exprTermString).join(', ')
  return raw(`${exprTermString(expr)} IN (${list})`)
}

export function notInList(
  expr: SparqlValue | ExpressionPrimitive,
  values: Array<SparqlValue | ExpressionPrimitive>,
): SparqlValue {
  if (values.length === 0) {
    // Everything is not in an empty set.
    return raw('true')
  }
  const list = values.map(exprTermString).join(', ')
  return raw(`${exprTermString(expr)} NOT IN (${list})`)
}

export function between(
  expr: SparqlValue | ExpressionPrimitive,
  low: SparqlValue | ExpressionPrimitive,
  high: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  const e = exprTermString(expr)
  const l = exprTermString(low)
  const h = exprTermString(high)
  return raw(`(${e} >= ${l} && ${e} <= ${h})`)
}

export function coalesce(
  ...values: Array<SparqlValue | ExpressionPrimitive>
): SparqlValue {
  if (values.length === 0) {
    return strlit('')
  }
  const inner = values.map(exprTermString).join(', ')
  return raw(`COALESCE(${inner})`)
}

export function ifElse(
  condition: SparqlValue,
  whenTrue: SparqlValue | ExpressionPrimitive,
  whenFalse: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  const trueTerm = exprTermString(whenTrue);
  const falseTerm = exprTermString(whenFalse)
  return raw(
    `IF(${condition.value}, ${trueTerm}, ${falseTerm})`,
  )
}


// ---- Numeric helpers ----

export function add(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} + ${exprTermString(right)}`)
}

export function sub(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} - ${exprTermString(right)}`)
}

export function mul(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} * ${exprTermString(right)}`)
}

export function div(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} / ${exprTermString(right)}`)
}

export function mod(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`(${exprTermString(left)} % ${exprTermString(right)})`)
}

export function abs(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`ABS(${exprTermString(value)})`)
}

export function ceil(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`CEIL(${exprTermString(value)})`)
}

export function floor(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`FLOOR(${exprTermString(value)})`)
}

export function round(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`ROUND(${exprTermString(value)})`)
}

// ---- Date/Time helpers (SPARQL 1.1) ----

export function nowFn(): SparqlValue {
  return raw('NOW()')
}

export function yearFn(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`YEAR(${exprTermString(value)})`)
}

export function monthFn(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`MONTH(${exprTermString(value)})`)
}

export function dayFn(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`DAY(${exprTermString(value)})`)
}


/**
 * Comparison helpers
 *
 * These all build simple binary expressions and return them as SparqlValue.
 */

export function eq(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} = ${exprTermString(right)}`)
}

export function neq(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} != ${exprTermString(right)}`)
}

export function gt(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} > ${exprTermString(right)}`)
}

export function gte(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} >= ${exprTermString(right)}`)
}

export function lt(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} < ${exprTermString(right)}`)
}

export function lte(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} <= ${exprTermString(right)}`)
}

/**
 * Logical helpers
 */

export function and(
  ...conditions: SparqlValue[]
): SparqlValue {
  if (conditions.length === 0) return raw('true')
  if (conditions.length === 1) return conditions[0]
  return raw(conditions.map((c) => c.value).join(' && '))
}

export function or(
  ...conditions: SparqlValue[]
): SparqlValue {
  if (conditions.length === 0) return raw('false')
  if (conditions.length === 1) return conditions[0]
  return raw(conditions.map((c) => c.value).join(' || '))
}

export function not(condition: SparqlValue): SparqlValue {
  return raw(`!(${condition.value})`)
}

/**
 * EXISTS/NOT EXISTS helpers
 *
 * You pass a SparqlValue that represents a group pattern:
 *   exists(triple('?s', 'rdf:type', 'ex:Thing'))
 */
export function exists(pattern: SparqlValue): SparqlValue {
  return raw(`EXISTS { ${pattern.value} }`)
}

export function notExists(pattern: SparqlValue): SparqlValue {
  return raw(`NOT EXISTS { ${pattern.value} }`)
}

// ============================================================================
// RDF Term Type Testing Functions
// ============================================================================

/**
 * Test if a term is an IRI
 */
export function isIri(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isIRI(${exprTermString(term)})`)
}

/**
 * Test if a term is a blank node
 */
export function isBlank(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isBlank(${exprTermString(term)})`)
}

/**
 * Test if a term is a literal
 */
export function isLiteral(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isLiteral(${exprTermString(term)})`)
}

/**
 * Test if a variable is bound
 */
export function bound(
  variable: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`BOUND(${exprTermString(variable)})`)
}

/**
 * Get language tag of a literal
 */
export function getlang(
  literal: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`LANG(${exprTermString(literal)})`)
}

/**
 * Get datatype IRI of a literal
 */
export function datatype(
  literal: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`DATATYPE(${exprTermString(literal)})`)
}

/**
 * Alias for startsWith (matches SPARQL STRSTARTS function name)
 */
export function strstarts(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return startsWith(text, pattern)
}

/**
 * Alias for endsWith (matches SPARQL STRENDS function name)
 */
export function strends(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return endsWith(text, pattern)
}

// ============================================================================
// Aggregation Functions
// ============================================================================

/**
 * Interface for aggregation expressions with AS clause
 */
export interface AggregationExpression extends SparqlValue {
  as(variable: string): SparqlValue
}

/**
 * Create an aggregation expression with optional AS binding
 */
function createAggregation(sparqlFunc: string, expr?: SparqlValue | ExpressionPrimitive): AggregationExpression {
  const exprStr = expr ? exprTermString(expr) : '*'
  const baseValue = `${sparqlFunc}(${exprStr})`
  
  const result: AggregationExpression = {
    __sparql: true,
    value: baseValue,
    as(variable: string): SparqlValue {
      const varName = normalizeVariableName(variable)
      return raw(`${baseValue} AS ?${varName}`)
    }
  }
  
  return result
}

/**
 * COUNT aggregation
 * 
 * @example
 * ```ts
 * // COUNT(*)
 * count()
 * 
 * // COUNT(?person)
 * count(variable('person'))
 * 
 * // COUNT(?person) AS ?personCount
 * count(variable('person')).as('personCount')
 * ```
 */
export function count(
  expr?: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('COUNT', expr)
}

/**
 * COUNT DISTINCT aggregation
 */
export function countDistinct(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  const exprStr = exprTermString(expr)
  const baseValue = `COUNT(DISTINCT ${exprStr})`
  
  const result: AggregationExpression = {
    __sparql: true,
    value: baseValue,
    as(variable: string): SparqlValue {
      const varName = normalizeVariableName(variable)
      return raw(`${baseValue} AS ?${varName}`)
    }
  }
  
  return result
}

/**
 * SUM aggregation
 * 
 * @example
 * ```ts
 * // SUM(?amount)
 * sum(variable('amount'))
 * 
 * // SUM(?amount) AS ?total
 * sum(variable('amount')).as('total')
 * ```
 */
export function sum(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('SUM', expr)
}

/**
 * AVG aggregation
 */
export function avg(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('AVG', expr)
}

/**
 * MIN aggregation
 */
export function min(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('MIN', expr)
}

/**
 * MAX aggregation
 */
export function max(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('MAX', expr)
}

/**
 * GROUP_CONCAT aggregation
 * 
 * @example
 * ```ts
 * // GROUP_CONCAT(?name)
 * groupConcat(variable('name'))
 * 
 * // GROUP_CONCAT(?name; separator=", ")
 * groupConcat(variable('name'), ', ')
 * 
 * // GROUP_CONCAT(?name) AS ?names
 * groupConcat(variable('name')).as('names')
 * ```
 */
export function groupConcat(
  expr: SparqlValue | ExpressionPrimitive,
  separator?: string,
): AggregationExpression {
  const exprStr = exprTermString(expr)
  const sepStr = separator ? `; separator=${exprTermString(separator)}` : ''
  const baseValue = `GROUP_CONCAT(${exprStr}${sepStr})`
  
  const result: AggregationExpression = {
    __sparql: true,
    value: baseValue,
    as(variable: string): SparqlValue {
      const varName = normalizeVariableName(variable)
      return raw(`${baseValue} AS ?${varName}`)
    }
  }
  
  return result
}

/**
 * SAMPLE aggregation
 * 
 * Returns an arbitrary value from the group
 */
export function sample(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('SAMPLE', expr)
}
