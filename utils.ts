/**
 * SPARQL expression helpers and query utilities.
 * 
 * These helpers build SPARQL expressions programmatically with proper escaping
 * for data values and validation for syntax elements.
 * 
 * ## Key Distinction
 * 
 * **Syntax elements** (passed through raw after validation):
 * - Variables created with `v()` or `variable()`
 * - Prefixed names like `foaf:name`
 * - IRIs
 * 
 * **Data values** (escaped and type-annotated):
 * - String literals passed to comparisons: `eq(v('name'), 'Alice')`
 * - Numbers: `gte(v('age'), 18)`
 * - Values in `concat()`, `contains()`, etc.
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
  variable,
  toPredicateName,
  toRawString,
  SPARQL_VALUE_BRAND,
  type VariableName,
  type SparqlValue,
  type SparqlInterpolatable,
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
  const _var = normalizeVariableName(varName)
  validateVariableName(_var)

  const converted = items.map((item) => convertValue(item)).join(' ')
  return raw(`VALUES ?${_var} { ${converted} }`)
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
  return raw(`FILTER(${expression.value})`)
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
  return raw(`OPTIONAL { ${pattern.value} }`)
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
export function bind(expression: SparqlValue, varName?: VariableName): SparqlValue {
  if (!varName) return raw(`BIND(${expression.value})`);

  const _varName = normalizeVariableName(varName)
  validateVariableName(_varName)
  return raw(`BIND(${expression.value} AS ?${_varName})`)
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
 * Convert a value to SPARQL for use in expressions.
 * 
 * - SparqlValue objects pass through unchanged
 * - Primitives are converted using convertValue (escaped and typed)
 * 
 * This is the key function that ensures data values are properly escaped
 * while syntax elements (already wrapped as SparqlValue) pass through.
 */
export function exprTerm(
  value: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  if (isSparqlValue(value)) {
    return value
  }
  return raw(convertValue(value))
}

/**
 * Get the raw SPARQL string for a value.
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
 */
export function concat(
  ...args: Array<SparqlValue | ExpressionPrimitive>
): FluentValue {
  if (args.length === 0) {
    return fluent(strlit(''))
  }

  const inner = args.map(a => exprTermString(a)).join(', ')
  return fluent(raw(`CONCAT(${inner})`))
}

/**
 * Convert a value to a string.
 * 
 * Forces conversion to string representation. Useful when you need to ensure
 * a value is treated as a string for comparison or manipulation.
 */
export function str(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`STR(${exprTermString(value)})`))
}

/**
 * Get the length of a string.
 * 
 * Returns the character count. Note that this counts Unicode characters, not bytes.
 */
export function strlen(
  value: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`STRLEN(${exprTermString(value)})`))
}

/**
 * Convert string to uppercase.
 */
export function ucase(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`UCASE(${exprTermString(value)})`))
}

/**
 * Convert string to lowercase.
 */
export function lcase(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`LCASE(${exprTermString(value)})`))
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

/** Alias for {@link startsWith} (matches SPARQL function name). */
export function strstarts(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return startsWith(text, pattern)
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

/** Alias for {@link endsWith} (matches SPARQL function name). */
export function strends(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
): SparqlValue {
  return endsWith(text, pattern)
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
  const textStr = exprTermString(text)
  const patternStr = exprTermString(pattern)
  
  if (flags) {
    const flagsStr = exprTermString(flags)
    return raw(`REGEX(${textStr}, ${patternStr}, ${flagsStr})`)
  }
  
  return raw(`REGEX(${textStr}, ${patternStr})`)
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
): FluentValue {
  const textStr = exprTermString(text)
  const startStr = exprTermString(start)
  
  if (length !== undefined) {
    const lengthStr = exprTermString(length)
    return fluent(raw(`SUBSTR(${textStr}, ${startStr}, ${lengthStr})`))
  }
  
  return fluent(raw(`SUBSTR(${textStr}, ${startStr})`))
}

/**
 * Replace occurrences of a pattern in text.
 * 
 * Replaces all occurrences of pattern with replacement string.
 * Optional flags parameter for case-insensitive matching (i), etc.
 * 
 * @example Remove dashes
 * ```ts
 * replaceStr(v('isbn'), '-', '')
 * // REPLACE(?isbn, "-", "")
 * ```
 * 
 * @example Case-insensitive replacement
 * ```ts
 * replaceStr(v('text'), 'hello', 'hi', 'i')
 * // REPLACE(?text, "hello", "hi", "i")
 * ```
 */
export function replaceStr(
  text: SparqlValue | ExpressionPrimitive,
  pattern: SparqlValue | ExpressionPrimitive,
  replacement: SparqlValue | ExpressionPrimitive,
  flags?: string,
): FluentValue {
  const textStr = exprTermString(text)
  const patternStr = exprTermString(pattern)
  const replacementStr = exprTermString(replacement)
  
  if (flags) {
    const flagsStr = exprTermString(flags)
    return fluent(raw(`REPLACE(${textStr}, ${patternStr}, ${replacementStr}, ${flagsStr})`))
  }
  
  return fluent(raw(`REPLACE(${textStr}, ${patternStr}, ${replacementStr})`))
}

/**
 * Get substring before first occurrence of match string.
 * 
 * Returns the part of the text that appears before the first occurrence
 * of the match string. If match is not found, returns empty string.
 * 
 * @example Extract username from email
 * ```ts
 * strBefore(v('email'), '@')
 * // STRBEFORE(?email, "@")
 * ```
 * 
 * @example Extract domain before subdomain
 * ```ts
 * strBefore(v('domain'), '.')
 * // STRBEFORE(?domain, ".")
 * ```
 */
export function strBefore(
  text: SparqlValue | ExpressionPrimitive,
  match: SparqlValue | ExpressionPrimitive,
): FluentValue {
  const textTerm = exprTermString(text)
  const matchTerm = exprTermString(match)
  return fluent(raw(`STRBEFORE(${textTerm}, ${matchTerm})`))
}

/**
 * Get substring after first occurrence of match string.
 * 
 * Returns the part of the text that appears after the first occurrence
 * of the match string. If match is not found, returns empty string.
 * 
 * @example Extract domain from email
 * ```ts
 * strAfter(v('email'), '@')
 * // STRAFTER(?email, "@")
 * ```
 * 
 * @example Extract file extension
 * ```ts
 * strAfter(v('filename'), '.')
 * // STRAFTER(?filename, ".")
 * ```
 */
export function strAfter(
  text: SparqlValue | ExpressionPrimitive,
  match: SparqlValue | ExpressionPrimitive,
): FluentValue {
  const textTerm = exprTermString(text)
  const matchTerm = exprTermString(match)
  return fluent(raw(`STRAFTER(${textTerm}, ${matchTerm})`))
}

/**
 * Conditional expression (ternary operator).
 * 
 * Like JavaScript's `condition ? whenTrue : whenFalse`. Evaluates the condition
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
): FluentValue {
  const trueTerm = exprTermString(whenTrue);
  const falseTerm = exprTermString(whenFalse)
  return fluent(raw(
    `IF(${condition.value}, ${trueTerm}, ${falseTerm})`,
  ))
}

// ============================================================================
// Numeric Operations
// ============================================================================

/** Add two numbers. */
export function add(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`${exprTermString(left)} + ${exprTermString(right)}`))
}

/** Subtract two numbers. */
export function sub(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`${exprTermString(left)} - ${exprTermString(right)}`))
}

/** Multiply two numbers. */
export function mul(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`${exprTermString(left)} * ${exprTermString(right)}`))
}

/** Divide two numbers. */
export function div(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`${exprTermString(left)} / ${exprTermString(right)}`))
}

/** Modulo operation (remainder after division). */
export function mod(
  left: SparqlValue | ExpressionPrimitive,
  right: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`(${exprTermString(left)} % ${exprTermString(right)})`))
}

/** Absolute value. */
export function abs(
  value: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`ABS(${exprTermString(value)})`))
}

/** Round to nearest integer. */
export function round(
  value: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`ROUND(${exprTermString(value)})`))
}

/** Round up to next integer. */
export function ceil(
  value: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`CEIL(${exprTermString(value)})`))
}

/** Round down to previous integer. */
export function floor(
  value: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`FLOOR(${exprTermString(value)})`))
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
// Type Checking Functions
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
  value: SparqlValue,
): SparqlValue {
  return raw(`!BOUND(${value.value})`)
}

/**
 * Check if a variable is bound (not null).
 * 
 * Opposite of isNull - checks if a variable has a value.
 */
export function isNotNull(
  value: SparqlValue,
): SparqlValue {
  return raw(`BOUND(${value.value})`)
}

/** Check if a variable is bound. Basically the same thing as {@link isNotNull} */
export function bound(
  variable: SparqlValue,
): SparqlValue {
  return raw(`BOUND(${variable.value})`)
}

/** Check if a term is an IRI. */
export function isIri(
  term: SparqlValue,
): SparqlValue {
  return raw(`isIRI(${term.value})`)
}

/** Check if a term is a blank node. */
export function isBlank(
  term: SparqlValue,
): SparqlValue {
  return raw(`isBlank(${term.value})`)
}

/** Check if a term is a literal. */
export function isLiteral(
  term: SparqlValue,
): SparqlValue {
  return raw(`isLiteral(${term.value})`)
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

// ============================================================================
// List Operations
// ============================================================================

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
  const exprTerm = exprTermString(expr)
  const lowTerm = exprTermString(low)
  const highTerm = exprTermString(high)
  return raw(`(${exprTerm} >= ${lowTerm} && ${exprTerm} <= ${highTerm})`)
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
): FluentValue {
  if (values.length === 0) {
    return fluent(strlit(''))
  }
  const inner = values.map(exprTermString).join(', ')
  return fluent(raw(`COALESCE(${inner})`))
}

// ============================================================================
// Fluent Value Interface
// ============================================================================

/**
 * Fluent interface for SPARQL values with chainable methods.
 * 
 * Instead of wrapping values in functions, you can call methods directly on values.
 * This makes complex expressions more readable and natural.
 * 
 * @example Comparison operators
 * ```ts
 * v('age').gte(18)          // instead of gte(v('age'), 18)
 * v('name').eq('Alice')     // instead of eq(v('name'), 'Alice')
 * ```
 * 
 * @example Arithmetic
 * ```ts
 * v('price').mul(1.1).add(5)   // instead of add(mul(v('price'), 1.1), 5)
 * ```
 * 
 * @example String operations
 * ```ts
 * v('name').ucase().contains('SPIDER')   // instead of contains(ucase(v('name')), 'SPIDER')
 * ```
 * 
 * @example Combining styles
 * ```ts
 * // Both functional and method styles work together
 * and(
 *   v('age').gte(18),
 *   v('name').regex('^Spider')
 * )
 * ```
 */
export interface FluentValue extends SparqlValue {
  // Comparison operators
  eq(other: SparqlValue | ExpressionPrimitive): SparqlValue
  neq(other: SparqlValue | ExpressionPrimitive): SparqlValue
  lt(other: SparqlValue | ExpressionPrimitive): SparqlValue
  lte(other: SparqlValue | ExpressionPrimitive): SparqlValue
  gt(other: SparqlValue | ExpressionPrimitive): SparqlValue
  gte(other: SparqlValue | ExpressionPrimitive): SparqlValue

  // Arithmetic operators
  add(other: SparqlValue | ExpressionPrimitive): FluentValue
  sub(other: SparqlValue | ExpressionPrimitive): FluentValue
  mul(other: SparqlValue | ExpressionPrimitive): FluentValue
  div(other: SparqlValue | ExpressionPrimitive): FluentValue
  mod(other: SparqlValue | ExpressionPrimitive): FluentValue

  // String functions
  concat(...others: Array<SparqlValue | ExpressionPrimitive>): FluentValue
  contains(substring: SparqlValue | ExpressionPrimitive): SparqlValue
  startsWith(prefix: SparqlValue | ExpressionPrimitive): SparqlValue
  endsWith(suffix: SparqlValue | ExpressionPrimitive): SparqlValue
  regex(pattern: string, flags?: string): SparqlValue
  strlen(): FluentValue
  ucase(): FluentValue
  lcase(): FluentValue
  substr(start: SparqlValue | ExpressionPrimitive, length?: SparqlValue | ExpressionPrimitive): FluentValue
  replace(pattern: SparqlValue | ExpressionPrimitive, replacement: SparqlValue | ExpressionPrimitive, flags?: string): FluentValue
  strBefore(match: SparqlValue | ExpressionPrimitive): FluentValue
  strAfter(match: SparqlValue | ExpressionPrimitive): FluentValue

  // Type checking
  isNull(): SparqlValue
  isNotNull(): SparqlValue
  isIri(): SparqlValue
  isBlank(): SparqlValue
  isLiteral(): SparqlValue
  bound(): SparqlValue

  // Logical operators
  and(other: SparqlValue): SparqlValue
  or(other: SparqlValue): SparqlValue
  not(): SparqlValue

  // Math functions
  abs(): FluentValue
  round(): FluentValue
  ceil(): FluentValue
  floor(): FluentValue

  // Utility
  as(variable: VariableName): SparqlValue
}

/**
 * Create a fluent value with chainable methods.
 * 
 * Wraps any SparqlValue to add method chaining. This lets you write expressions
 * more naturally with dot notation instead of nested function calls.
 * 
 * @param value SparqlValue to enhance
 * @returns FluentValue with chainable methods
 * 
 * @example
 * ```ts
 * const age = fluent(v('age'))
 * age.gte(18).and(age.lt(65))
 * ```
 * 
 * @example Direct with variables
 * ```ts
 * fluent(v('price')).mul(1.1).add(5)
 * ```
 */
export function fluent(value: SparqlValue): FluentValue {
  const result: FluentValue = {
    ...value,

    // Comparison operators
    eq: (other) => eq(result, other),
    neq: (other) => neq(result, other),
    lt: (other) => lt(result, other),
    lte: (other) => lte(result, other),
    gt: (other) => gt(result, other),
    gte: (other) => gte(result, other),

    // Arithmetic operators (return FluentValue for chaining)
    add: (other) => fluent(add(result, other)),
    sub: (other) => fluent(sub(result, other)),
    mul: (other) => fluent(mul(result, other)),
    div: (other) => fluent(div(result, other)),
    mod: (other) => fluent(mod(result, other)),

    // String functions
    concat: (...others) => fluent(concat(result, ...others)),
    contains: (substring) => contains(result, substring),
    startsWith: (prefix) => startsWith(result, prefix),
    endsWith: (suffix) => endsWith(result, suffix),
    regex: (pattern, flags) => regex(result, pattern, flags),
    strlen: () => fluent(strlen(result)),
    ucase: () => fluent(ucase(result)),
    lcase: () => fluent(lcase(result)),
    substr: (start, length) => fluent(substr(result, start, length)),
    replace: (pattern, replacement, flags) => fluent(replaceStr(result, pattern, replacement, flags)),
    strBefore: (match) => fluent(strBefore(result, match)),
    strAfter: (match) => fluent(strAfter(result, match)),

    // Type checking
    isNull: () => isNull(result),
    isNotNull: () => isNotNull(result),
    isIri: () => isIri(result),
    isBlank: () => isBlank(result),
    isLiteral: () => isLiteral(result),
    bound: () => bound(result),

    // Logical operators
    and: (other) => and(result, other),
    or: (other) => or(result, other),
    not: () => not(result),

    // Math functions
    abs: () => fluent(abs(result)),
    round: () => fluent(round(result)),
    ceil: () => fluent(ceil(result)),
    floor: () => fluent(floor(result)),

    // Utility
    as: (variable) => {
      const varName = normalizeVariableName(variable)
      validateVariableName(varName)
      // Use the *current* expression and wrap as required by SPARQL
      return raw(`(${result.value} AS ?${varName})`)
    }
  }

  return result
}

/**
 * Create a fluent variable reference.
 * 
 * Variables are placeholders for values that get bound during query execution.
 * This enhanced version returns a FluentValue with chainable methods for
 * natural, readable query construction.
 * 
 * @param name Variable name (with or without ? prefix)
 * @returns FluentValue with comparison, arithmetic, and other methods
 * 
 * @example Chainable comparisons
 * ```ts
 * v('age').gte(18)
 * // Instead of: gte(v('age'), 18)
 * ```
 * 
 * @example Arithmetic chains
 * ```ts
 * v('price').mul(1.1).add(5)
 * // Instead of: add(mul(v('price'), 1.1), 5)
 * ```
 * 
 * @example Complex expressions
 * ```ts
 * select(['?name', '?total'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'schema:price', '?price'))
 *   .bind(v('price').mul(1.2).round(), 'total')
 * ```
 * 
 * @example Combining with logical operators
 * ```ts
 * filter(
 *   v('age').gte(18).and(v('age').lt(65))
 * )
 * ```
 */
export function v(name: string): FluentValue {
  return fluent(variable(name))
}

/** Get the language tag of a literal. */
export function getlang(
  literal: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`LANG(${exprTermString(literal)})`))
}

/** Get the datatype IRI of a literal. */
export function datatype(
  literal: SparqlValue | ExpressionPrimitive,
): FluentValue {
  return fluent(raw(`DATATYPE(${exprTermString(literal)})`))
}

// ============================================================================
// Aggregation
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
    [SPARQL_VALUE_BRAND]: true,
    value: baseValue,
    as(variable: string): SparqlValue {
      const varName = normalizeVariableName(variable)
      validateVariableName(varName)
      // SPARQL 1.1 requires (Expression AS ?var) in SELECT
      return raw(`(${baseValue} AS ?${varName})`)
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
 * // SELECT (COUNT(DISTINCT ?publisher) AS ?publisherCount)
 * ```
 */
export function countDistinct(
  expr: SparqlValue | ExpressionPrimitive,
): AggregationExpression {
  const exprStr = exprTermString(expr)
  // Treat DISTINCT … as raw SPARQL, not a literal
  return createAggregation('COUNT', raw(`DISTINCT ${exprStr}`))
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
  const baseValue = separator
    ? `${exprStr}; SEPARATOR=${exprTermString(separator)}`
    : exprStr

  return createAggregation('GROUP_CONCAT', raw(baseValue))
}

// ============================================================================
// GRAPH Patterns
// ============================================================================

/**
 * Create a GRAPH pattern for querying named graphs.
 * 
 * GRAPH patterns restrict triples to a specific named graph. The graph can be
 * a variable (to match across graphs) or a specific IRI. This is essential
 * for datasets that store different information in separate graphs.
 * 
 * @param graphIri Graph IRI or variable
 * @param pattern Pattern to match within the graph
 * @returns GRAPH pattern
 * 
 * @example Query specific graph
 * ```ts
 * graph('http://example.org/data', triple('?s', '?p', '?o'))
 * // GRAPH <http://example.org/data> { ?s ?p ?o . }
 * ```
 * 
 * @example Query across named graphs
 * ```ts
 * select(['?g', '?person', '?name'])
 *   .where(graph('?g', triple('?person', 'foaf:name', '?name')))
 * // Finds all names across all graphs, telling you which graph each came from
 * ```
 * 
 * @example Combine with FROM NAMED
 * ```ts
 * select(['?person', '?name'])
 *   .fromNamed('http://example.org/graph1')
 *   .where(graph('?g', triple('?person', 'foaf:name', '?name')))
 * // Only searches in the specified named graph
 * ```
 */
export function graph(
  graphIri: string | SparqlValue,
  pattern: SparqlValue
): SparqlValue {
  const graphRef = toPredicateName(toRawString(graphIri))
  return raw(`GRAPH ${graphRef} { ${pattern.value} }`)
}

// ============================================================================
// Special Values and Functions
// ============================================================================

/**
 * Unbound variable placeholder.
 * 
 * Used in IF expressions to leave variables unbound. When ?UNDEF is used
 * as a binding result, it doesn't bind the variable at all - the variable
 * stays unbound.
 * 
 * @example Conditional binding
 * ```ts
 * bind(
 *   ifElse(eq(v('x'), 1), v('x'), undef()),
 *   'result'
 * )
 * // BIND(IF(?x = 1, ?x, ?UNDEF) AS ?result)
 * // If ?x = 1, ?result gets bound to ?x's value
 * // If ?x != 1, ?result stays unbound
 * ```
 * 
 * @example Inferring functional properties
 * ```ts
 * select([
 *   v('property'),
 *   ifElse(eq(v('maxCardinality'), 1), v('maxCardinality'), undef()).as('isFunctional')
 * ])
 *   .where(...)
 *   .groupBy('?property')
 * // ?isFunctional only gets bound for properties with max cardinality 1
 * ```
 */
export function undef(): SparqlValue {
  return raw('?UNDEF')
}

// ============================================================================
// Property Paths
// ============================================================================

/**
 * Zero or more path (transitive closure).
 * 
 * Matches the property zero or more times. Like * in regular expressions.
 * Use this to traverse relationship chains of any length, including zero
 * (which means subject and object can be the same).
 * 
 * @param property Property IRI
 * 
 * @example Find all connected people
 * ```ts
 * triple('?person', zeroOrMore('foaf:knows'), '?contact')
 * // ?person foaf:knows* ?contact
 * // Matches: direct friends, friends of friends, etc.
 * ```
 * 
 * @example Organizational hierarchy
 * ```ts
 * triple('?ceo', zeroOrMore('org:manages'), '?employee')
 * // Finds everyone in the org (including CEO themselves due to zero matches)
 * ```
 */
export function zeroOrMore(property: string | SparqlValue): SparqlValue {
  const prop = toPredicateName(toRawString(property))
  return raw(`${prop}*`)
}

/**
 * One or more path.
 * 
 * Matches the property one or more times. Like + in regular expressions.
 * Subject and object must be different (at least one hop required).
 * 
 * @param property Property IRI
 * 
 * @example Find direct and indirect reports
 * ```ts
 * triple('?manager', oneOrMore('org:manages'), '?employee')
 * // ?manager org:manages+ ?employee
 * // Matches all reports at any level, but not the manager themselves
 * ```
 * 
 * @example Ancestor relationships
 * ```ts
 * triple('?ancestor', oneOrMore('bio:parent'), '?descendant')
 * // Finds parents, grandparents, great-grandparents, etc.
 * ```
 */
export function oneOrMore(property: string | SparqlValue): SparqlValue {
  const prop = toPredicateName(toRawString(property))
  return raw(`${prop}+`)
}

/**
 * Zero or one path (optional property).
 * 
 * Matches the property zero or one time. Like ? in regular expressions.
 * Use for optional properties where you want both entities with and without
 * the property.
 * 
 * @param property Property IRI
 * 
 * @example Person with optional spouse
 * ```ts
 * triple('?person', zeroOrOne('schema:spouse'), '?maybeSpouse')
 * // ?person schema:spouse? ?maybeSpouse
 * // Matches married and unmarried people
 * ```
 */
export function zeroOrOne(property: string | SparqlValue): SparqlValue {
  const prop = toPredicateName(toRawString(property))
  return raw(`${prop}?`)
}

/**
 * Sequence path.
 * 
 * Matches properties in sequence (path1 followed by path2). Use to navigate
 * multi-hop relationships as if they were single properties.
 * 
 * @param properties Properties to traverse in order
 * 
 * @example Person's city through address
 * ```ts
 * triple('?person', sequence('schema:address', 'schema:city'), '?city')
 * // ?person schema:address/schema:city ?city
 * // Equivalent to: ?person schema:address ?addr . ?addr schema:city ?city
 * ```
 * 
 * @example Complex navigation
 * ```ts
 * triple('?product', sequence('schema:manufacturer', 'schema:location', 'schema:city'), '?city')
 * // Navigate: product → manufacturer → location → city
 * ```
 */
export function sequence(...properties: Array<string | SparqlValue>): SparqlValue {
  const props = properties.map(p => toPredicateName(toRawString(p)))
  return raw(props.join('/'))
}

/**
 * Alternative path.
 * 
 * Matches either path1 or path2. Use when multiple properties lead to the
 * same kind of information.
 * 
 * @param properties Properties to try (any match)
 * 
 * @example Contact info
 * ```ts
 * triple('?person', alternative('foaf:phone', 'foaf:email'), '?contact')
 * // ?person foaf:phone|foaf:email ?contact
 * // Matches either phone numbers or email addresses
 * ```
 * 
 * @example Multiple name properties
 * ```ts
 * triple('?entity', alternative('rdfs:label', 'foaf:name', 'schema:name'), '?name')
 * // Gets name from any of these properties
 * ```
 */
export function alternative(...properties: Array<string | SparqlValue>): SparqlValue {
  const props = properties.map(p => toPredicateName(toRawString(p)))
  return raw(`(${props.join('|')})`)
}

/**
 * Inverse path.
 * 
 * Traverses the property in reverse direction. Swaps subject and object positions.
 * 
 * @param property Property IRI
 * 
 * @example Find who manages this person
 * ```ts
 * triple('?employee', inverse('org:manages'), '?manager')
 * // ?employee ^org:manages ?manager
 * // Equivalent to: ?manager org:manages ?employee
 * ```
 * 
 * @example Find authors of book
 * ```ts
 * triple('?book', inverse('schema:author'), '?author')
 * // Reverse of: ?author schema:author ?book
 * ```
 */
export function inverse(property: string | SparqlValue): SparqlValue {
  const prop = toPredicateName(toRawString(property))
  return raw(`^${prop}`)
}

/**
 * Negated property set.
 * 
 * Matches any property except those listed. Use to exclude specific
 * relationships when you want "everything else".
 * 
 * @param properties Properties to exclude
 * 
 * @example Any property except rdf:type
 * ```ts
 * triple('?s', negatedPropertySet('rdf:type'), '?o')
 * // ?s !(rdf:type) ?o
 * // Matches all triples except type declarations
 * ```
 * 
 * @example Non-metadata properties
 * ```ts
 * triple('?s', negatedPropertySet('rdf:type', 'rdfs:label', 'rdfs:comment'), '?o')
 * // Gets data properties, not metadata
 * ```
 */
export function negatedPropertySet(...properties: Array<string | SparqlValue>): SparqlValue {
  const props = properties.map(p => toPredicateName(toRawString(p)))
  return raw(`!(${props.join('|')})`)
}

// ============================================================================
// Federation
// ============================================================================

/**
 * Query a remote SPARQL endpoint (federation).
 * 
 * SERVICE lets you include data from other SPARQL endpoints in your query.
 * The pattern is sent to the remote endpoint and results are integrated with
 * your local query. This is powerful for combining data from multiple sources.
 * 
 * @param endpoint Remote SPARQL endpoint URL
 * @param pattern Pattern to execute remotely
 * @param silent If true, continue if service unavailable (default: false)
 * 
 * @example Query DBpedia for birth places
 * ```ts
 * select(['?person', '?name', '?birthPlace'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(service(
 *     'http://dbpedia.org/sparql',
 *     triple('?person', 'dbo:birthPlace', '?birthPlace')
 *   ))
 * // Combines local names with DBpedia birth places
 * ```
 * 
 * @example Silent service (don't fail)
 * ```ts
 * service(
 *   'http://example.org/sparql',
 *   triple('?s', '?p', '?o'),
 *   true
 * )
 * // SERVICE SILENT - continues even if endpoint is down
 * ```
 * 
 * @example Complex federated query
 * ```ts
 * select(['?company', '?revenue', '?stockPrice'])
 *   .where(triple('?company', 'schema:revenue', '?revenue'))
 *   .where(service(
 *     'http://stocks.example.org/sparql',
 *     triple('?company', 'finance:stockPrice', '?stockPrice')
 *   ))
 * // Enriches company data with external stock prices
 * ```
 */
export function service(
  endpoint: string | SparqlValue,
  pattern: SparqlValue,
  silent = false
): SparqlValue {
  const endpointRef = toPredicateName(toRawString(endpoint))
  const silentModifier = silent ? 'SILENT ' : ''
  return raw(`SERVICE ${silentModifier}${endpointRef} { ${pattern.value} }`)
}

// ============================================================================
// Prefix Management
// ============================================================================

/**
 * Define a PREFIX for abbreviated IRIs.
 * 
 * Prefixes let you write short names instead of full IRIs. They're declared
 * at the top of queries and expand to full IRIs everywhere they're used.
 * 
 * @param name Prefix name
 * @param iri Full IRI for the namespace
 * 
 * @example Define common prefixes
 * ```ts
 * const prefixes = [
 *   definePrefix('foaf', 'http://xmlns.com/foaf/0.1/'),
 *   definePrefix('schema', 'http://schema.org/'),
 *   definePrefix('ex', 'http://example.org/')
 * ]
 * 
 * const query = raw(`
 *   ${prefixes.map(p => p.value).join('\n')}
 *   
 *   SELECT ?name WHERE {
 *     ?person foaf:name ?name .
 *     ?person schema:email ?email .
 *   }
 * `)
 * ```
 * 
 * @example With builder
 * ```ts
 * const prefixBlock = [
 *   definePrefix('rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'),
 *   definePrefix('rdfs', 'http://www.w3.org/2000/01/rdf-schema#')
 * ].map(p => p.value).join('\n')
 * 
 * const query = select(['?class'])
 *   .where(triple('?instance', 'rdf:type', '?class'))
 * 
 * const fullQuery = raw(`${prefixBlock}\n\n${query.build().value}`)
 * ```
 */
export function definePrefix(name: string, iri: string): SparqlValue {
  const endpoint = toPredicateName(iri)
  return raw(`PREFIX ${name}: ${endpoint}`)
}

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Compute MD5 hash of a value.
 * 
 * Returns the MD5 hash as a hex string. MD5 is a cryptographic hash function
 * that produces a 128-bit (16-byte) hash value, typically rendered as a
 * 32-character hexadecimal number.
 * 
 * @param value Value to hash
 * 
 * @sparql `MD5(value)`
 * 
 * @example Hash a string
 * ```ts
 * // Library
 * select([md5(v('email')).as('emailHash')])
 *   .where(triple('?person', 'foaf:mbox', '?email'))
 * 
 * // SPARQL ↓
 * // SELECT (MD5(?email) AS ?emailHash)
 * // WHERE { ?person foaf:mbox ?email }
 * ```
 * 
 * @example Deduplication key
 * ```ts
 * // Library
 * bind(md5(concat(v('firstName'), v('lastName'), v('birthDate'))), 'personKey')
 * 
 * // SPARQL ↓
 * // BIND(MD5(CONCAT(?firstName, ?lastName, ?birthDate)) AS ?personKey)
 * ```
 */
export function md5(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`MD5(${exprTermString(value)})`))
}

/**
 * Compute SHA1 hash of a value.
 * 
 * Returns the SHA-1 hash as a hex string. SHA-1 produces a 160-bit (20-byte)
 * hash value, typically rendered as a 40-character hexadecimal number.
 * 
 * @param value Value to hash
 * 
 * @sparql `SHA1(value)`
 * 
 * @example Content-based identifier
 * ```ts
 * // Library
 * bind(sha1(v('documentText')), 'contentHash')
 * 
 * // SPARQL ↓
 * // BIND(SHA1(?documentText) AS ?contentHash)
 * ```
 */
export function sha1(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`SHA1(${exprTermString(value)})`))
}

/**
 * Compute SHA256 hash of a value.
 * 
 * Returns the SHA-256 hash as a hex string. SHA-256 produces a 256-bit (32-byte)
 * hash value, typically rendered as a 64-character hexadecimal number. This is
 * more secure than MD5 or SHA-1.
 * 
 * @param value Value to hash
 * 
 * @sparql `SHA256(value)`
 * 
 * @example Secure hash
 * ```ts
 * // Library
 * select([sha256(v('password')).as('passwordHash')])
 *   .where(triple('?user', 'ex:password', '?password'))
 * 
 * // SPARQL ↓
 * // SELECT (SHA256(?password) AS ?passwordHash)
 * // WHERE { ?user ex:password ?password }
 * ```
 */
export function sha256(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`SHA256(${exprTermString(value)})`))
}

/**
 * Compute SHA384 hash of a value.
 * 
 * Returns the SHA-384 hash as a hex string. SHA-384 produces a 384-bit hash value.
 * 
 * @param value Value to hash
 * 
 * @sparql `SHA384(value)`
 * 
 * @example
 * ```ts
 * // Library
 * sha384(v('data'))
 * 
 * // SPARQL ↓
 * // SHA384(?data)
 * ```
 */
export function sha384(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`SHA384(${exprTermString(value)})`))
}

/**
 * Compute SHA512 hash of a value.
 * 
 * Returns the SHA-512 hash as a hex string. SHA-512 produces a 512-bit (64-byte)
 * hash value, typically rendered as a 128-character hexadecimal number. This
 * provides the highest security of the standard SHA-2 family.
 * 
 * @param value Value to hash
 * 
 * @sparql `SHA512(value)`
 * 
 * @example High-security hash
 * ```ts
 * // Library
 * bind(sha512(v('sensitiveData')), 'secureHash')
 * 
 * // SPARQL ↓
 * // BIND(SHA512(?sensitiveData) AS ?secureHash)
 * ```
 */
export function sha512(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`SHA512(${exprTermString(value)})`))
}

// ============================================================================
// Random & Unique Value Functions
// ============================================================================

/**
 * Get the current date and time.
 * 
 * Returns the current dateTime when the query is executed. The value is fixed
 * for the entire query execution - all calls to NOW() in the same query return
 * the same value.
 * 
 * @sparql `NOW()`
 * 
 * @example Timestamp queries
 * ```ts
 * // Library
 * select(['?event', '?time'])
 *   .where(triple('?event', 'ex:timestamp', '?time'))
 *   .filter(v('time').lt(now()))
 * 
 * // SPARQL ↓
 * // SELECT ?event ?time
 * // WHERE {
 * //   ?event ex:timestamp ?time .
 * //   FILTER(?time < NOW())
 * // }
 * ```
 * 
 * @example Add timestamp to data
 * ```ts
 * // Library
 * modify()
 *   .insert(triple('?person', 'ex:lastModified', now()))
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .done()
 * 
 * // SPARQL ↓
 * // INSERT { ?person ex:lastModified NOW() }
 * // WHERE { ?person foaf:name ?name }
 * ```
 */
export function now(): SparqlValue {
  return raw('NOW()')
}

/**
 * Generate a fresh UUID as an IRI.
 * 
 * Creates a new UUID (Universally Unique Identifier) and returns it as an IRI
 * in the urn:uuid: namespace. Each call generates a different UUID.
 * 
 * @sparql `UUID()`
 * 
 * @example Generate unique IRIs
 * ```ts
 * // Library
 * construct(triple(uuid(), 'rdf:type', 'ex:Event'))
 *   .where(triple('?input', 'ex:data', '?data'))
 * 
 * // SPARQL ↓
 * // CONSTRUCT { UUID() rdf:type ex:Event }
 * // WHERE { ?input ex:data ?data }
 * ```
 * 
 * @example Stable blank node replacement
 * ```ts
 * // Library
 * modify()
 *   .insert(triple(uuid(), 'ex:property', '?value'))
 *   .where(triple('?subject', 'ex:property', '?value'))
 *   .done()
 * 
 * // SPARQL ↓
 * // INSERT { UUID() ex:property ?value }
 * // WHERE { ?subject ex:property ?value }
 * ```
 */
export function uuid(): SparqlValue {
  return raw('UUID()')
}

/**
 * Generate a fresh UUID as a string literal.
 * 
 * Like UUID() but returns a plain string instead of an IRI. Useful when you
 * need a unique identifier as a literal value rather than an IRI.
 * 
 * @sparql `STRUUID()`
 * 
 * @example Unique string identifiers
 * ```ts
 * // Library
 * bind(struuid(), 'transactionId')
 * 
 * // SPARQL ↓
 * // BIND(STRUUID() AS ?transactionId)
 * ```
 * 
 * @example Session tracking
 * ```ts
 * // Library
 * modify()
 *   .insert(triple('?user', 'ex:sessionId', struuid()))
 *   .where(triple('?user', 'ex:loginTime', now()))
 *   .done()
 * 
 * // SPARQL ↓
 * // INSERT { ?user ex:sessionId STRUUID() }
 * // WHERE { ?user ex:loginTime NOW() }
 * ```
 */
export function struuid(): FluentValue {
  return fluent(raw('STRUUID()'))
}

/**
 * Generate a random number between 0 and 1.
 * 
 * Returns a pseudo-random number in the range [0, 1). Different calls may
 * return different values, even within the same query execution.
 * 
 * @sparql `RAND()`
 * 
 * @example Random sampling
 * ```ts
 * // Library
 * select(['?item'])
 *   .where(triple('?item', 'rdf:type', 'ex:Product'))
 *   .filter(rand().lt(0.1))
 * 
 * // SPARQL ↓
 * // SELECT ?item
 * // WHERE { ?item rdf:type ex:Product }
 * // FILTER(RAND() < 0.1)
 * ```
 * 
 * @example Randomize order
 * ```ts
 * // Library
 * select(['?person', '?name'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .orderBy(rand().as('random'))
 * 
 * // SPARQL ↓
 * // SELECT ?person ?name
 * // WHERE { ?person foaf:name ?name }
 * // ORDER BY (RAND() AS ?random)
 * ```
 */
export function rand(): FluentValue {
  return fluent(raw('RAND()'))
}

// ============================================================================
// Additional String Functions
// ============================================================================

/**
 * Create a typed literal from a string.
 * 
 * @example strdt(strlit('custom value'), 'http://example.org/datatype')
 */
export function strdt(lexical: SparqlValue, datatype: SparqlValue): SparqlValue {
  return raw(`STRDT(${lexical.value}, ${datatype.value})`)
}

export function strlang(lexical: SparqlValue, lang: string): SparqlValue {
  return raw(`STRLANG(${lexical.value}, ${exprTermString(lang)})`)
}

export function sameTerm(a: SparqlValue, b: SparqlValue): SparqlValue {
  return raw(`sameTerm(${a.value}, ${b.value})`)
}

/**
 * Encode a string for use in a URI.
 * 
 * Percent-encodes characters that have special meaning in URIs. This follows
 * the encoding rules of RFC 3986 for creating valid URI components.
 * 
 * @param value String to encode
 * 
 * @sparql `ENCODE_FOR_URI(value)`
 * 
 * @example Build query parameters
 * ```ts
 * // Library
 * bind(
 *   concat('http://example.org/search?q=', encodeForUri(v('searchTerm'))),
 *   'searchUrl'
 * )
 * 
 * // SPARQL ↓
 * // BIND(CONCAT("http://example.org/search?q=", ENCODE_FOR_URI(?searchTerm)) AS ?searchUrl)
 * ```
 * 
 * @example Create URIs from names
 * ```ts
 * // Library
 * bind(
 *   iri(concat('http://example.org/person/', encodeForUri(v('name')))),
 *   'personIri'
 * )
 * 
 * // SPARQL ↓
 * // BIND(IRI(CONCAT("http://example.org/person/", ENCODE_FOR_URI(?name))) AS ?personIri)
 * ```
 */
export function encodeForUri(value: SparqlValue | ExpressionPrimitive): FluentValue {
  return fluent(raw(`ENCODE_FOR_URI(${exprTermString(value)})`))
}

/**
 * Check if a language tag matches a language range.
 * 
 * Tests whether a language tag (like "en-US") matches a language range
 * (like "en" or "*"). This implements RFC 4647 basic filtering.
 * 
 * @param lang Language tag to test
 * @param range Language range pattern
 * 
 * @sparql `langMatches(lang, range)`
 * 
 * @example Match English variants
 * ```ts
 * // Library
 * select(['?label'])
 *   .where(triple('?resource', 'rdfs:label', '?label'))
 *   .filter(langMatches(getlang(v('label')), 'en'))
 * 
 * // SPARQL ↓
 * // SELECT ?label
 * // WHERE { ?resource rdfs:label ?label }
 * // FILTER(langMatches(LANG(?label), "en"))
 * // Matches "en", "en-US", "en-GB", etc.
 * ```
 * 
 * @example Match any language
 * ```ts
 * // Library
 * filter(langMatches(getlang(v('label')), '*'))
 * 
 * // SPARQL ↓
 * // FILTER(langMatches(LANG(?label), "*"))
 * ```
 */
export function langMatches(
  lang: SparqlValue | ExpressionPrimitive,
  range: string
): SparqlValue {
  return raw(`langMatches(${exprTermString(lang)}, ${exprTermString(range)})`)
}

// ============================================================================
// IRI Construction
// ============================================================================

/**
 * Construct an IRI from a string.
 * 
 * Converts a string value to an IRI. This is useful for dynamically creating
 * IRIs from string components. The input must be a valid absolute IRI.
 * 
 * @param value String value to convert to IRI
 * 
 * @sparql `IRI(value)`
 * 
 * @example Dynamic IRI creation
 * ```ts
 * // Library
 * bind(
 *   iri(concat('http://example.org/id/', v('personId'))),
 *   'personIri'
 * )
 * 
 * // SPARQL ↓
 * // BIND(IRI(CONCAT("http://example.org/id/", ?personId)) AS ?personIri)
 * ```
 * 
 * @example Namespace-based IRIs
 * ```ts
 * // Library
 * select(['?newIri'])
 *   .where(triple('?item', 'ex:identifier', '?id'))
 *   .bind(
 *     iri(concat('http://data.example.org/item/', encodeForUri(v('id')))),
 *     'newIri'
 *   )
 * 
 * // SPARQL ↓
 * // SELECT ?newIri
 * // WHERE {
 * //   ?item ex:identifier ?id .
 * //   BIND(IRI(CONCAT("http://data.example.org/item/", ENCODE_FOR_URI(?id))) AS ?newIri)
 * // }
 * ```
 */
export function iri(value: SparqlValue | ExpressionPrimitive): SparqlValue {
  return raw(`IRI(${exprTermString(value)})`)
}

// ============================================================================
// MINUS Pattern
// ============================================================================

/**
 * Exclude solutions that match a pattern (MINUS).
 * 
 * MINUS removes solutions from the query results. It's different from NOT EXISTS:
 * - MINUS removes entire solutions if the pattern matches
 * - NOT EXISTS tests for pattern absence but keeps solutions
 * 
 * Use MINUS when you want to subtract one set of results from another. Use
 * NOT EXISTS when you want to filter based on absence of a pattern.
 * 
 * @param pattern Pattern to subtract from results
 * 
 * @sparql `MINUS { pattern }`
 * 
 * @example Exclude patterns
 * ```ts
 * // Library
 * select(['?person', '?name'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(minus(
 *     triple('?person', 'ex:blocked', true)
 *   ))
 * 
 * // SPARQL ↓
 * // SELECT ?person ?name
 * // WHERE {
 * //   ?person foaf:name ?name .
 * //   MINUS { ?person ex:blocked true }
 * // }
 * ```
 * 
 * @example MINUS vs NOT EXISTS
 * ```ts
 * // Library - MINUS: Removes entire solution
 * select(['?person', '?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(optional(triple('?person', 'foaf:age', '?age')))
 *   .where(minus(triple('?person', 'ex:status', 'inactive')))
 * 
 * // SPARQL ↓
 * // SELECT ?person ?name ?age
 * // WHERE {
 * //   ?person foaf:name ?name .
 * //   OPTIONAL { ?person foaf:age ?age }
 * //   MINUS { ?person ex:status "inactive" }
 * // }
 * 
 * // Library - NOT EXISTS: Filters but keeps solution structure
 * select(['?person', '?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(optional(triple('?person', 'foaf:age', '?age')))
 *   .filter(notExists(triple('?person', 'ex:status', 'inactive')))
 * 
 * // SPARQL ↓
 * // SELECT ?person ?name ?age
 * // WHERE {
 * //   ?person foaf:name ?name .
 * //   OPTIONAL { ?person foaf:age ?age }
 * //   FILTER(NOT EXISTS { ?person ex:status "inactive" })
 * // }
 * ```
 */
export function minus(pattern: SparqlValue): SparqlValue {
  return raw(`MINUS { ${pattern.value} }`)
}