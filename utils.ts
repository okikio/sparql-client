/**
 * SPARQL expression helpers and query utilities.
 * 
 * Building complex SPARQL expressions by hand is tedious. You end up with lots of
 * string concatenation that's hard to read and easy to mess up. These helpers let
 * you build expressions programmatically, like you would with Drizzle or other
 * query builders.
 * 
 * The functions here mirror SPARQL's built-in operations but give you type safety
 * and composability. Need to filter by age and check a regex? Combine `and()` with
 * `gte()` and `regex()`. Want to create computed fields? Use `bind()` with `concat()`.
 * 
 * @module
 */

import {
  convertValue,
  isSparqlValue,
  normalizeVariableName,
  raw,
  strlit,
  validateVariableName,
  wrapSparqlValue,
  type VariableName,
  type SparqlInterpolatable,
  type SparqlValue
} from './sparql.ts'

// ============================================================================
// Query Clauses
// ============================================================================

/**
 * Create a VALUES clause for filtering by a list of values.
 * 
 * VALUES clauses let you provide a set of possible values for a variable.
 * Think of it like an IN clause in SQL. The query engine will try each value
 * and return results that match any of them.
 * 
 * @example Simple list
 * ```ts
 * values('city', ['London', 'Paris', 'Tokyo'])
 * // VALUES ?city { "London" "Paris" "Tokyo" }
 * ```
 * 
 * @example With numbers
 * ```ts
 * values('age', [18, 21, 25])
 * // VALUES ?age { 18 21 25 }
 * ```
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
 * Wrap an expression in a FILTER clause.
 * 
 * Filters restrict results based on boolean conditions. The expression you pass
 * should evaluate to true or false. Use this with comparison operators, regex
 * checks, or any other boolean expression.
 * 
 * @example Age filter
 * ```ts
 * filter(gte(v('age'), 18))
 * // FILTER(?age >= 18)
 * ```
 * 
 * @example Multiple conditions
 * ```ts
 * filter(and(
 *   gte(v('age'), 18),
 *   regex(v('name'), '^Spider')
 * ))
 * // FILTER(?age >= 18 && REGEX(?name, "^Spider"))
 * ```
 */
export function filter(expression: SparqlValue): SparqlValue {
  return wrapSparqlValue(`FILTER(${expression.value})`)
}

/**
 * Wrap a pattern in an OPTIONAL block.
 * 
 * Optional patterns don't fail the whole query if they don't match - they just
 * leave variables unbound. This is like a LEFT JOIN in SQL. Use it for properties
 * that might not exist on all results.
 * 
 * @example Email might not exist
 * ```ts
 * optional(triple('?person', 'foaf:email', '?email'))
 * // OPTIONAL { ?person foaf:email ?email }
 * ```
 * 
 * @example Multiple optional triples
 * ```ts
 * optional(triples('?person', [
 *   ['foaf:email', '?email'],
 *   ['foaf:phone', '?phone']
 * ]))
 * ```
 */
export function optional(pattern: SparqlValue): SparqlValue {
  return wrapSparqlValue(`OPTIONAL { ${pattern.value} }`)
}

/**
 * Create a BIND expression to compute new variables.
 * 
 * BIND lets you create new variables from expressions. Think of it like a computed
 * column - you're deriving a new value from existing data. The variable will be
 * available in the rest of the query.
 * 
 * @example Full name from parts
 * ```ts
 * bind(concat(v('firstName'), ' ', v('lastName')), 'fullName')
 * // BIND(CONCAT(?firstName, " ", ?lastName) AS ?fullName)
 * ```
 * 
 * @example Age calculation
 * ```ts
 * bind(sub(2024, v('birthYear')), 'age')
 * // BIND(2024 - ?birthYear AS ?age)
 * ```
 */
export function bind(expression: SparqlValue, varName: VariableName): SparqlValue {
  const _varName = normalizeVariableName(varName)
  validateVariableName(_varName)
  return wrapSparqlValue(`BIND(${expression.value} AS ?${_varName})`)
}

// ============================================================================
// Expression Helpers
// ============================================================================

/**
 * Values that can be used in SPARQL expressions.
 * 
 * These are the building blocks: literals, numbers, dates, and already-constructed
 * SparqlValue objects. Most expression helpers accept these types.
 */
export type ExpressionPrimitive =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined

/**
 * Convert a value to a SparqlValue for use in expressions.
 * 
 * This is an internal helper that ensures values are properly formatted for
 * SPARQL expressions. You usually don't need to call this directly since the
 * other helpers call it for you.
 */
export function exprTerm(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  if (isSparqlValue(value)) {
    return value
  }
  return wrapSparqlValue(convertValue(value))
}

/**
 * Get the raw SPARQL string for a value.
 * 
 * Internal helper for converting values to strings that can be embedded in
 * larger expressions.
 */
export function exprTermString(
  value: SparqlValue | ExpressionPrimitive,
): string {
  return exprTerm(value).value
}

// ============================================================================
// String Functions
// ============================================================================

/**
 * Concatenate strings or values.
 * 
 * CONCAT joins multiple values into a single string. All arguments are converted
 * to strings first. This is your go-to for building full names, labels, or any
 * composite string field.
 * 
 * @example Full name
 * ```ts
 * concat(v('firstName'), ' ', v('lastName'))
 * // CONCAT(?firstName, " ", ?lastName)
 * ```
 * 
 * @example Label with prefix
 * ```ts
 * concat('Issue #', v('issueNumber'))
 * // CONCAT("Issue #", ?issueNumber)
 * ```
 */
export function concat(
  ...args: Array<SparqlValue | ExpressionPrimitive>
): SparqlValue {
  if (args.length === 0) {
    return strlit('')
  }

  const inner = args.map(exprTermString).join(', ')
  return raw(`CONCAT(${inner})`)
}

/**
 * Convert a value to a string.
 * 
 * Forces conversion to string representation. Useful when you need to ensure
 * a value is treated as a string for comparison or manipulation.
 */
export function str(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`STR(${exprTermString(value)})`)
}

/**
 * Get the length of a string.
 * 
 * Returns the character count. Note that this counts Unicode characters, not bytes.
 */
export function strlen(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`STRLEN(${exprTermString(value)})`)
}

/**
 * Convert string to uppercase.
 */
export function ucase(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`UCASE(${exprTermString(value)})`)
}

/**
 * Convert string to lowercase.
 */
export function lcase(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`LCASE(${exprTermString(value)})`)
}

/**
 * Check if a string contains a substring.
 * 
 * Case-sensitive substring search. Returns true if pattern appears anywhere
 * in the text.
 * 
 * @example
 * ```ts
 * contains(v('title'), 'Spider')
 * // CONTAINS(?title, "Spider")
 * ```
 */
export function contains(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `CONTAINS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

/**
 * Check if string starts with a prefix.
 * 
 * Case-sensitive prefix check.
 */
export function startsWith(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `STRSTARTS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

/**
 * Check if string ends with a suffix.
 * 
 * Case-sensitive suffix check.
 */
export function endsWith(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(
    `STRENDS(${exprTermString(text)}, ${exprTermString(pattern)})`,
  )
}

/**
 * Extract substring from a string.
 * 
 * Starting position is 1-indexed (SPARQL convention). If length is omitted,
 * extracts to the end of the string.
 * 
 * @example First 5 characters
 * ```ts
 * substr(v('title'), 1, 5)
 * // SUBSTR(?title, 1, 5)
 * ```
 * 
 * @example Everything after position 10
 * ```ts
 * substr(v('description'), 10)
 * // SUBSTR(?description, 10)
 * ```
 */
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

/**
 * Replace occurrences of a pattern in text.
 * 
 * Replaces all occurrences of pattern with replacement string.
 * 
 * @example Remove dashes
 * ```ts
 * replaceStr(v('isbn'), '-', '')
 * // REPLACE(?isbn, "-", "")
 * ```
 */
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
 * Pattern matching with regular expressions.
 * 
 * Supports standard regex patterns. The flags parameter lets you control
 * matching behavior (i for case-insensitive, m for multiline, etc.).
 * 
 * @example Case-insensitive match
 * ```ts
 * regex(v('name'), '^Spider', 'i')
 * // REGEX(?name, "^Spider", "i")
 * ```
 * 
 * @example Match email pattern
 * ```ts
 * regex(v('email'), '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$', 'i')
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

// ============================================================================
// Nullability & List Operations
// ============================================================================

/**
 * Check if a variable is unbound (null).
 * 
 * In SPARQL, variables can be unbound if an OPTIONAL pattern didn't match.
 * This lets you check for that condition.
 * 
 * @example
 * ```ts
 * filter(isNull(v('email')))
 * // FILTER(!BOUND(?email))
 * ```
 */
export function isNull(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`!BOUND(${exprTermString(value)})`)
}

/**
 * Check if a variable is bound (not null).
 * 
 * Opposite of isNull - checks if a variable has a value.
 */
export function isNotNull(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`BOUND(${exprTermString(value)})`)
}

/**
 * Check if a value is in a list.
 * 
 * Like SQL's IN operator. Checks if the expression matches any value in the list.
 * 
 * @example Check publisher
 * ```ts
 * inList(v('publisher'), ['Marvel', 'DC Comics', 'Image'])
 * // ?publisher IN ("Marvel", "DC Comics", "Image")
 * ```
 */
export function inList(
  expr: SparqlValue | ExpressionPrimitive,
  values: Array<SparqlValue | ExpressionPrimitive>,
): SparqlValue {
  if (values.length === 0) {
    return raw('false')
  }
  const list = values.map(exprTermString).join(', ')
  return raw(`${exprTermString(expr)} IN (${list})`)
}

/**
 * Check if a value is not in a list.
 * 
 * Opposite of inList - returns true if the value doesn't match any list item.
 */
export function notInList(
  expr: SparqlValue | ExpressionPrimitive,
  values: Array<SparqlValue | ExpressionPrimitive>,
): SparqlValue {
  if (values.length === 0) {
    return raw('true')
  }
  const list = values.map(exprTermString).join(', ')
  return raw(`${exprTermString(expr)} NOT IN (${list})`)
}

/**
 * Check if a value is in a range.
 * 
 * Shorthand for value >= low AND value <= high. Both bounds are inclusive.
 * 
 * @example Age range
 * ```ts
 * between(v('age'), 18, 65)
 * // (?age >= 18 && ?age <= 65)
 * ```
 */
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

/**
 * Return first non-null value from a list.
 * 
 * Like SQL's COALESCE. Evaluates arguments left-to-right and returns the first
 * one that's bound. Useful for providing fallback values.
 * 
 * @example Fallback label
 * ```ts
 * coalesce(v('preferredLabel'), v('commonLabel'), strlit('Unnamed'))
 * // COALESCE(?preferredLabel, ?commonLabel, "Unnamed")
 * ```
 */
export function coalesce(
  ...values: Array<SparqlValue | ExpressionPrimitive>
): SparqlValue {
  if (values.length === 0) {
    return strlit('')
  }
  const inner = values.map(exprTermString).join(', ')
  return raw(`COALESCE(${inner})`)
}

/**
 * Conditional expression (ternary operator).
 * 
 * Like JavaScript's condition ? whenTrue : whenFalse. Evaluates the condition
 * and returns one of two values based on the result.
 * 
 * @example Adult vs minor
 * ```ts
 * ifElse(gte(v('age'), 18), strlit('Adult'), strlit('Minor'))
 * // IF(?age >= 18, "Adult", "Minor")
 * ```
 */
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

// ============================================================================
// Numeric Operations
// ============================================================================

/** Add two numbers. */
export function add(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} + ${exprTermString(right)}`)
}

/** Subtract two numbers. */
export function sub(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} - ${exprTermString(right)}`)
}

/** Multiply two numbers. */
export function mul(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} * ${exprTermString(right)}`)
}

/** Divide two numbers. */
export function div(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} / ${exprTermString(right)}`)
}

/** Modulo operation (remainder after division). */
export function mod(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`(${exprTermString(left)} % ${exprTermString(right)})`)
}

/** Absolute value. */
export function abs(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`ABS(${exprTermString(value)})`)
}

/** Round to nearest integer. */
export function round(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`ROUND(${exprTermString(value)})`)
}

/** Round up to next integer. */
export function ceil(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`CEIL(${exprTermString(value)})`)
}

/** Round down to previous integer. */
export function floor(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`FLOOR(${exprTermString(value)})`)
}

// ============================================================================
// Comparison Operations
// ============================================================================

/** Equal to. */
export function eq(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} = ${exprTermString(right)}`)
}

/** Not equal to. */
export function neq(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} != ${exprTermString(right)}`)
}

/** Greater than. */
export function gt(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} > ${exprTermString(right)}`)
}

/** Greater than or equal to. */
export function gte(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} >= ${exprTermString(right)}`)
}

/** Less than. */
export function lt(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} < ${exprTermString(right)}`)
}

/** Less than or equal to. */
export function lte(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`${exprTermString(left)} <= ${exprTermString(right)}`)
}

// ============================================================================
// Logical Operations
// ============================================================================

/**
 * Combine conditions with AND.
 * 
 * All conditions must be true for the result to be true. Short-circuits on
 * the first false condition.
 * 
 * @example Multiple filters
 * ```ts
 * and(
 *   gte(v('age'), 18),
 *   lte(v('age'), 65),
 *   eq(v('status'), 'active')
 * )
 * // ?age >= 18 && ?age <= 65 && ?status = "active"
 * ```
 */
export function and(
  ...conditions: SparqlValue[]
): SparqlValue {
  if (conditions.length === 0) return raw('true')
  if (conditions.length === 1) return conditions[0]
  return raw(conditions.map((c) => c.value).join(' && '))
}

/**
 * Combine conditions with OR.
 * 
 * Any condition being true makes the result true. Short-circuits on the
 * first true condition.
 * 
 * @example Alternative publishers
 * ```ts
 * or(
 *   eq(v('publisher'), 'Marvel'),
 *   eq(v('publisher'), 'DC Comics')
 * )
 * // ?publisher = "Marvel" || ?publisher = "DC Comics"
 * ```
 */
export function or(
  ...conditions: SparqlValue[]
): SparqlValue {
  if (conditions.length === 0) return raw('false')
  if (conditions.length === 1) return conditions[0]
  return raw(conditions.map((c) => c.value).join(' || '))
}

/**
 * Negate a condition.
 * 
 * Flips true to false and false to true.
 */
export function not(condition: SparqlValue): SparqlValue {
  return raw(`!(${condition.value})`)
}

/**
 * Check if a pattern exists in the data.
 * 
 * EXISTS tests whether a graph pattern has any matches. The pattern you pass
 * is evaluated but doesn't affect variable bindings in the main query.
 * 
 * @example Has any email
 * ```ts
 * exists(triple('?person', 'foaf:email', '?anyEmail'))
 * // EXISTS { ?person foaf:email ?anyEmail }
 * ```
 */
export function exists(pattern: SparqlValue): SparqlValue {
  return raw(`EXISTS { ${pattern.value} }`)
}

/**
 * Check if a pattern does not exist in the data.
 * 
 * Opposite of EXISTS - returns true if the pattern has no matches.
 * 
 * @example No email address
 * ```ts
 * notExists(triple('?person', 'foaf:email', '?email'))
 * // NOT EXISTS { ?person foaf:email ?email }
 * ```
 */
export function notExists(pattern: SparqlValue): SparqlValue {
  return raw(`NOT EXISTS { ${pattern.value} }`)
}

// ============================================================================
// RDF Term Type Tests
// ============================================================================

/** Check if a term is an IRI. */
export function isIri(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isIRI(${exprTermString(term)})`)
}

/** Check if a term is a blank node. */
export function isBlank(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isBlank(${exprTermString(term)})`)
}

/** Check if a term is a literal. */
export function isLiteral(
  term: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`isLiteral(${exprTermString(term)})`)
}

/** Check if a variable is bound. */
export function bound(
  variable: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`BOUND(${exprTermString(variable)})`)
}

/** Get the language tag of a literal. */
export function getlang(
  literal: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`LANG(${exprTermString(literal)})`)
}

/** Get the datatype IRI of a literal. */
export function datatype(
  literal: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return raw(`DATATYPE(${exprTermString(literal)})`)
}

/** Alias for {@link startsWith} (matches SPARQL function name). */
export function strstarts(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return startsWith(text, pattern)
}

/** Alias for {@link endsWith} (matches SPARQL function name). */
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
 * Aggregation expression that can be aliased with AS.
 * 
 * Aggregations reduce a group of values to a single result. They're typically
 * used with GROUP BY clauses. The `.as()` method lets you assign the result
 * to a variable.
 */
export interface AggregationExpression extends SparqlValue {
  as(variable: string): SparqlValue
}

/**
 * Internal helper to create aggregation expressions.
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
 * Count the number of rows.
 * 
 * Without arguments, counts all rows (COUNT(*)). With an expression, counts
 * non-null values of that expression.
 * 
 * @example Count all
 * ```ts
 * select([count().as('total')])
 * // SELECT COUNT(*) AS ?total
 * ```
 * 
 * @example Count specific values
 * ```ts
 * select([count(v('email')).as('emailCount')])
 * // SELECT COUNT(?email) AS ?emailCount
 * ```
 */
export function count(
  expr?: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('COUNT', expr)
}

/**
 * Count distinct values.
 * 
 * Like COUNT but only counts unique values.
 * 
 * @example Unique publishers
 * ```ts
 * select([countDistinct(v('publisher')).as('publisherCount')])
 * // SELECT COUNT(DISTINCT ?publisher) AS ?publisherCount
 * ```
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
 * Sum numeric values.
 * 
 * Adds up all values in the group.
 * 
 * @example Total price
 * ```ts
 * select([sum(v('price')).as('totalPrice')])
 * // SELECT SUM(?price) AS ?totalPrice
 * ```
 */
export function sum(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('SUM', expr)
}

/** Calculate average of numeric values. */
export function avg(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('AVG', expr)
}

/** Find minimum value. */
export function min(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('MIN', expr)
}

/** Find maximum value. */
export function max(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('MAX', expr)
}

/**
 * Concatenate values into a single string.
 * 
 * Joins multiple values with an optional separator. Useful for creating
 * comma-separated lists or similar aggregations.
 * 
 * @example Author list
 * ```ts
 * select([groupConcat(v('author'), ', ').as('authors')])
 * // SELECT GROUP_CONCAT(?author; separator=", ") AS ?authors
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
 * Return an arbitrary value from the group.
 * 
 * When you just need one value from each group but don't care which one.
 * Useful for properties that should be the same across a group.
 */
export function sample(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  return createAggregation('SAMPLE', expr)
}