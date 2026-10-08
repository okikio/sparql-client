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

import * as structure from './structure.ts'

import {
  isTerm as isRdfTerm,
  type NamedNode as RdfNamedNode,
  type Term as RdfTerm,
} from '@okikio/rdf'

import {
  convertValue,
  type IriInputType,
  isIRIRefToken,
  isSparqlTerm,
  isSparqlValue,
  isVariableToken,
  normalizeVariableName,
  type PatternValueType,
  type PredicateInputType,
  type PrefixNameType,
  raw,
  rawPattern,
  rawTerm,
  SPARQL_EXPR_BRAND,
  SPARQL_PATH_BRAND,
  SPARQL_PATTERN_BRAND,
  SPARQL_TERM_BRAND,
  SPARQL_VALUE_BRAND,
  type SparqlExprType,
  type SparqlPathType,
  type SparqlTermType,
  type SparqlValueType,
  strlit,
  toPredicateToken,
  toValuesToken,
  toVarOrIriRef,
  toVarToken,
  validateIRI,
  validatePrefixName,
  validateVariableName,
  type ValuesItemType,
  variable,
  type VariableNameType,
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
  varName: VariableNameType,
  items: readonly ValuesItemType[],
): PatternValueType {
  const _var = toVarToken(varName)
  const converted = items.map(toValuesToken).join(' ')
  return structure.pattern(rawPattern(`VALUES ${_var} { ${converted} }`), {
    kind: 'values',
    bindings: [_var],
  })
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
export function filter(expression: SparqlExprType): PatternValueType {
  exprTerm(expression)
  return structure.pattern(rawPattern(`FILTER(${expression.value})`), {
    kind: 'filter',
    bindings: [],
  })
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
export function optional(pattern: PatternValueType): PatternValueType {
  return structure.pattern(rawPattern(`OPTIONAL { ${pattern.value} }`), {
    kind: 'optional',
    bindings: [...structure.scope([pattern])],
    children: [pattern],
  })
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
export function bind(
  expression: SparqlExprType | SparqlTermType,
  varName: VariableNameType,
): PatternValueType {
  const normalized = toVarToken(varName)
  exprTerm(expression)
  return structure.pattern(rawPattern(`BIND(${expression.value} AS ${normalized})`), {
    kind: 'bind',
    target: normalized,
    bindings: [normalized],
  })
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
export function exists(pattern: PatternValueType): SparqlExprType {
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
export function notExists(pattern: PatternValueType): SparqlExprType {
  return raw(`NOT EXISTS { ${pattern.value} }`)
}

// ============================================================================
// Expression Helpers
// ============================================================================

/**
 * Values that can be used in SPARQL expressions.
 *
 * These are the building blocks: literals, numbers, dates, and already-constructed
 * SparqlValueType objects. Most expression helpers accept these types.
 */
export type ExpressionPrimitiveType =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | undefined
  | RdfTerm

/**
 * Convert a value to SPARQL for use in expressions.
 *
 * - SparqlValueType objects pass through unchanged
 * - Primitives are converted using convertValue (escaped and typed)
 *
 * This is the key function that ensures data values are properly escaped
 * while syntax elements (already wrapped as SparqlValueType) pass through.
 */
export function exprTerm(
  value: SparqlValueType | ExpressionPrimitiveType,
): SparqlValueType {
  if (isSparqlValue(value)) {
    if (SPARQL_PATTERN_BRAND in value || structure.isPath(value)) {
      throw new TypeError(
        'Expression operands must be terms or expressions, not patterns or paths.',
      )
    }
    return value
  }
  return raw(convertValue(value))
}

/**
 * Get the raw SPARQL string for a value.
 */
export function exprTermString(
  value: SparqlValueType | ExpressionPrimitiveType,
): string {
  return exprTerm(value).value
}

// ============================================================================
// Term Helpers (GraphNode / VarOrTerm for triples)
// ============================================================================

/**
 * Positions where an RDF term (not a full expression) is required.
 *
 * For now we focus on triple positions; you can extend this later if
 * you want to validate GRAPH names etc.
 */
export type TermPositionType = 'subject' | 'object' | 'graph'

/**
 * Convert a value into a *term* suitable for triple subject/object.
 *
 * Checked term constructors preserve their grammar role. Expressions and paths
 * are rejected. rawTerm retains explicit caller responsibility for its syntax.
 *
 * This is what you want for triple objects and any context where
 * SPARQL forbids arbitrary expressions.
 *
 * @throws Error if the value serializes to something that is not
 *         a valid SPARQL term (e.g. STR(...), CONCAT(...), BNODE()).
 */
export function termString(
  value: SparqlTermType | ExpressionPrimitiveType,
  position: TermPositionType = 'object',
): string {
  if (isSparqlValue(value)) {
    if (!isSparqlTerm(value)) {
      throw new TypeError(`Triple ${position} requires a term. Use BIND for expressions.`)
    }
    // rawTerm is explicitly caller-owned syntax. Checked constructors own their token spelling.
    return value.value
  }
  return convertValue(value)
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
  ...args: Array<SparqlValueType | ExpressionPrimitiveType>
): FluentExprType {
  return args.length ? call('CONCAT', ...args) : fluent(strlit(''))
}

/**
 * Convert a value to a string.
 *
 * Forces conversion to string representation. Useful when you need to ensure
 * a value is treated as a string for comparison or manipulation.
 */
export function str(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('STR', value)
}

/**
 * Get the length of a string.
 *
 * Returns the character count. Note that this counts Unicode characters, not bytes.
 */
export function strlen(
  value: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('STRLEN', value)
}

/**
 * Convert string to uppercase.
 */
export function ucase(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('UCASE', value)
}

/**
 * Convert string to lowercase.
 */
export function lcase(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('LCASE', value)
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
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return call('CONTAINS', text, pattern)
}

/**
 * Check if string starts with a prefix.
 *
 * Case-sensitive prefix check.
 */
export function startsWith(
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return call('STRSTARTS', text, pattern)
}

/** Alias for {@link startsWith} (matches SPARQL function name). */
export function strstarts(
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return startsWith(text, pattern)
}

/**
 * Check if string ends with a suffix.
 *
 * Case-sensitive suffix check.
 */
export function endsWith(
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return call('STRENDS', text, pattern)
}

/** Alias for {@link endsWith} (matches SPARQL function name). */
export function strends(
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
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
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: string,
  flags?: string,
): SparqlExprType {
  return call('REGEX', text, pattern, ...(flags === undefined ? [] : [flags]))
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
  text: SparqlValueType | ExpressionPrimitiveType,
  start: SparqlValueType | ExpressionPrimitiveType,
  length?: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('SUBSTR', text, start, ...(length === undefined ? [] : [length]))
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
  text: SparqlValueType | ExpressionPrimitiveType,
  pattern: SparqlValueType | ExpressionPrimitiveType,
  replacement: SparqlValueType | ExpressionPrimitiveType,
  flags?: string,
): FluentExprType {
  return call('REPLACE', text, pattern, replacement, ...(flags === undefined ? [] : [flags]))
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
  text: SparqlValueType | ExpressionPrimitiveType,
  match: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('STRBEFORE', text, match)
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
  text: SparqlValueType | ExpressionPrimitiveType,
  match: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('STRAFTER', text, match)
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
  condition: SparqlValueType,
  whenTrue: SparqlValueType | ExpressionPrimitiveType,
  whenFalse: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('IF', condition, whenTrue, whenFalse)
}

// ============================================================================
// Numeric Operations
// ============================================================================

/** Add two numbers. */
export function add(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return fluent(
    structure.view(raw(''), {
      kind: 'binary',
      operator: '+',
      children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
    }),
  )
}

/** Subtract two numbers. */
export function sub(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return fluent(
    structure.view(raw(''), {
      kind: 'binary',
      operator: '-',
      children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
    }),
  )
}

/** Multiply two numbers. */
export function mul(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return fluent(
    structure.view(raw(''), {
      kind: 'binary',
      operator: '*',
      children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
    }),
  )
}

/** Divide two numbers. */
export function div(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return fluent(
    structure.view(raw(''), {
      kind: 'binary',
      operator: '/',
      children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
    }),
  )
}

/** Absolute value. */
export function abs(
  value: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('ABS', value)
}

/** Round to nearest integer. */
export function round(
  value: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('ROUND', value)
}

/** Round up to next integer. */
export function ceil(
  value: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('CEIL', value)
}

/** Round down to previous integer. */
export function floor(
  value: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('FLOOR', value)
}

// ============================================================================
// Comparison Operations
// ============================================================================

/** Equal to. */
export function eq(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '=',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
}

/** Not equal to. */
export function neq(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '!=',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
}

/** Greater than. */
export function gt(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '>',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
}

/** Greater than or equal to. */
export function gte(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '>=',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
}

/** Less than. */
export function lt(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '<',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
}

/** Less than or equal to. */
export function lte(
  left: SparqlValueType | ExpressionPrimitiveType,
  right: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '<=',
    children: [structure.node(exprTerm(left)), structure.node(exprTerm(right))],
  })
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
  value: SparqlValueType,
): SparqlExprType {
  return raw(`!BOUND(${toVarToken(value as SparqlTermType)})`)
}

/**
 * Check if a variable is bound (not null).
 *
 * Opposite of isNull - checks if a variable has a value.
 */
export function isNotNull(
  value: SparqlValueType,
): SparqlExprType {
  return raw(`BOUND(${toVarToken(value as SparqlTermType)})`)
}

/** Check if a variable is bound. Basically the same thing as {@link isNotNull} */
export function bound(
  variable: SparqlValueType,
): SparqlExprType {
  return raw(`BOUND(${toVarToken(variable as SparqlTermType)})`)
}

/** Check if a term is an IRI. */
export function isIri(
  term: SparqlValueType,
): SparqlExprType {
  return raw(`isIRI(${exprTermString(term)})`)
}

/** Check if a term is a blank node. */
export function isBlank(
  term: SparqlValueType,
): SparqlExprType {
  return raw(`isBlank(${exprTermString(term)})`)
}

/** Check if a term is a literal. */
export function isLiteral(
  term: SparqlValueType,
): SparqlExprType {
  return raw(`isLiteral(${exprTermString(term)})`)
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
  ...conditions: SparqlValueType[]
): SparqlExprType {
  if (conditions.length === 0) throw new TypeError('and needs at least one operand.')
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '&&',
    children: conditions.map((value) => structure.node(exprTerm(value))),
  })
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
  ...conditions: SparqlValueType[]
): SparqlExprType {
  if (conditions.length === 0) throw new TypeError('or needs at least one operand.')
  return structure.view(raw(''), {
    kind: 'binary',
    operator: '||',
    children: conditions.map((value) => structure.node(exprTerm(value))),
  })
}

/**
 * Negate a condition.
 *
 * Flips true to false and false to true.
 */
export function not(condition: SparqlValueType): SparqlExprType {
  return fragment(['!(', structure.node(exprTerm(condition)), ')'])
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
  expr: SparqlValueType | ExpressionPrimitiveType,
  values: Array<SparqlValueType | ExpressionPrimitiveType>,
): SparqlExprType {
  if (!values.length) return raw('false')
  const parts: (structure.NodeType | string)[] = ['(', structure.node(exprTerm(expr)), ' IN (']
  values.forEach((value, index) => {
    if (index) parts.push(', ')
    parts.push(structure.node(exprTerm(value)))
  })
  parts.push('))')
  return fragment(parts)
}

/**
 * Check if a value is not in a list.
 *
 * Opposite of inList - returns true if the value doesn't match any list item.
 */
export function notInList(
  expr: SparqlValueType | ExpressionPrimitiveType,
  values: Array<SparqlValueType | ExpressionPrimitiveType>,
): SparqlExprType {
  if (!values.length) return raw('true')
  const parts: (structure.NodeType | string)[] = ['(', structure.node(exprTerm(expr)), ' NOT IN (']
  values.forEach((value, index) => {
    if (index) parts.push(', ')
    parts.push(structure.node(exprTerm(value)))
  })
  parts.push('))')
  return fragment(parts)
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
  expr: SparqlValueType | ExpressionPrimitiveType,
  low: SparqlValueType | ExpressionPrimitiveType,
  high: SparqlValueType | ExpressionPrimitiveType,
): SparqlExprType {
  return and(gte(expr, low), lte(expr, high))
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
  ...values: Array<SparqlValueType | ExpressionPrimitiveType>
): FluentExprType {
  return values.length ? call('COALESCE', ...values) : fluent(strlit(''))
}

/**
 * Create a blank node *term*.
 *
 * - Represents the SPARQL `BNODE()` function, which creates
 *   a fresh blank node per evaluation.
 */
export function bnodeFn(): SparqlExprType {
  return raw('BNODE()')
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
export interface FluentExprType extends SparqlExprType {
  // Comparison operators
  /** Builds an equality expression between this expression and the supplied value. */
  eq(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds an inequality expression between this expression and the supplied value. */
  neq(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds a less-than comparison expression. */
  lt(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds a less-than-or-equal comparison expression. */
  lte(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds a greater-than comparison expression. */
  gt(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds a greater-than-or-equal comparison expression. */
  gte(other: SparqlValueType | ExpressionPrimitiveType): SparqlExprType

  // Arithmetic operators
  /** Adds  to FluentExprType while maintaining its indexes and semantic invariants. */
  add(other: SparqlValueType | ExpressionPrimitiveType): FluentExprType
  /** Builds numeric subtraction with this expression on the left. */
  sub(other: SparqlValueType | ExpressionPrimitiveType): FluentExprType
  /** Builds numeric multiplication with this expression on the left. */
  mul(other: SparqlValueType | ExpressionPrimitiveType): FluentExprType
  /** Builds numeric division with this expression on the left. */
  div(other: SparqlValueType | ExpressionPrimitiveType): FluentExprType

  // String functions
  /** Builds CONCAT with this expression as the first argument. */
  concat(...others: Array<SparqlValueType | ExpressionPrimitiveType>): FluentExprType
  /** Builds a CONTAINS string predicate for this expression. */
  contains(substring: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds STRSTARTS for this expression and the supplied prefix. */
  startsWith(prefix: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds STRENDS for this expression and the supplied suffix. */
  endsWith(suffix: SparqlValueType | ExpressionPrimitiveType): SparqlExprType
  /** Builds a REGEX predicate with optional SPARQL regular-expression flags. */
  regex(pattern: string, flags?: string): SparqlExprType
  /** Builds STRLEN for this expression. */
  strlen(): FluentExprType
  /** Builds UCASE for this expression. */
  ucase(): FluentExprType
  /** Builds LCASE for this expression. */
  lcase(): FluentExprType
  /** Builds SUBSTR using SPARQL one-based start and optional length arguments. */
  substr(
    start: SparqlValueType | ExpressionPrimitiveType,
    length?: SparqlValueType | ExpressionPrimitiveType,
  ): FluentExprType
  /** Builds REPLACE with the supplied pattern, replacement, and optional flags. */
  replace(
    pattern: SparqlValueType | ExpressionPrimitiveType,
    replacement: SparqlValueType | ExpressionPrimitiveType,
    flags?: string,
  ): FluentExprType
  /** Builds STRBEFORE for this expression and the supplied delimiter. */
  strBefore(match: SparqlValueType | ExpressionPrimitiveType): FluentExprType
  /** Builds STRAFTER for this expression and the supplied delimiter. */
  strAfter(match: SparqlValueType | ExpressionPrimitiveType): FluentExprType

  // Type checking
  /** Builds the project null-test expression used by object-pattern helpers. */
  isNull(): SparqlExprType
  /** Builds the negated project null-test expression used by object-pattern helpers. */
  isNotNull(): SparqlExprType
  /** Builds ISIRI for this expression. */
  isIri(): SparqlExprType
  /** Builds ISBLANK for this expression. */
  isBlank(): SparqlExprType
  /** Builds ISLITERAL for this expression. */
  isLiteral(): SparqlExprType
  /** Builds BOUND for this variable-compatible expression. */
  bound(): SparqlExprType

  // Logical operators
  /** Builds logical conjunction with this expression on the left. */
  and(other: SparqlValueType): SparqlExprType
  /** Builds logical disjunction with this expression on the left. */
  or(other: SparqlValueType): SparqlExprType
  /** Builds logical negation of this expression. */
  not(): SparqlExprType

  // Math functions
  /** Builds ABS for this numeric expression. */
  abs(): FluentExprType
  /** Builds ROUND for this numeric expression. */
  round(): FluentExprType
  /** Builds CEIL for this numeric expression. */
  ceil(): FluentExprType
  /** Builds FLOOR for this numeric expression. */
  floor(): FluentExprType

  // Utility
  /** Aliases this expression to the supplied SPARQL variable for projection. */
  as(variable: VariableNameType): SparqlExprType
}

/**
 * Create a fluent value with chainable methods.
 *
 * Wraps any SparqlValueType to add method chaining. This lets you write expressions
 * more naturally with dot notation instead of nested function calls.
 *
 * @param value SparqlValueType to enhance
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
export function fluent(value: SparqlTermType | SparqlExprType): FluentExprType {
  if (SPARQL_PATTERN_BRAND in value && value[SPARQL_PATTERN_BRAND]) {
    throw new Error(`Cannot convert pattern value "${value}" to a fluent expression`)
  }

  const result: FluentExprType = {
    [SPARQL_VALUE_BRAND]: true,
    value: '',

    [SPARQL_EXPR_BRAND]: true,
    ...(isSparqlTerm(value) ? { [SPARQL_TERM_BRAND]: true as const } : {}),

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
    replace: (pattern, replacement, flags) =>
      fluent(replaceStr(result, pattern, replacement, flags)),
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
      return structure.alias(
        fragment(['(', structure.node(result), ` AS ?${varName})`]),
        `?${varName}`,
      )
    },
  }

  const meaning = structure.meaning(value)
  if (meaning) structure.term(result, meaning)
  return structure.view(result, structure.node(value))
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
export function v(name: string): FluentExprType {
  return fluent(variable(name))
}

/** Get the language tag of a literal. */
export function getlang(
  literal: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('LANG', literal)
}

/** Get the datatype IRI of a literal. */
export function datatype(
  literal: SparqlValueType | ExpressionPrimitiveType,
): FluentExprType {
  return call('DATATYPE', literal)
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
export interface AggregationExpressionType extends SparqlExprType {
  /** Aliases this aggregate expression to the supplied SPARQL variable for projection. */
  as(variable: string): SparqlExprType
}

/**
 * Internal helper to create aggregation expressions.
 */
function createAggregation(
  sparqlFunc: string,
  expr?: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
  const value = expr === undefined ? fragment([`${sparqlFunc}(*)`]) : call(sparqlFunc, expr)
  const result: AggregationExpressionType = {
    [SPARQL_VALUE_BRAND]: true,
    [SPARQL_EXPR_BRAND]: true,
    value: '',
    as(variable: string): SparqlExprType {
      const name = toVarToken(variable)
      return structure.alias(fragment(['(', structure.node(result), ` AS ${name})`]), name)
    },
  }
  return structure.view(result, structure.node(value))
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
  expr?: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
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
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
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
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
  return createAggregation('SUM', expr)
}

/** Calculate average of numeric values. */
export function avg(
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
  return createAggregation('AVG', expr)
}

/** Find minimum value. */
export function min(
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
  return createAggregation('MIN', expr)
}

/** Find maximum value. */
export function max(
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
  return createAggregation('MAX', expr)
}

/**
 * Return an arbitrary value from the group.
 *
 * When you just need one value from each group but don't care which one.
 * Useful for properties that should be the same across a group.
 */
export function sample(
  expr: SparqlValueType | ExpressionPrimitiveType,
): AggregationExpressionType {
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
  expr: SparqlValueType | ExpressionPrimitiveType,
  separator?: string,
): AggregationExpressionType {
  return createAggregation(
    'GROUP_CONCAT',
    fragment([
      structure.node(exprTerm(expr)),
      ...(separator === undefined ? [] : ['; SEPARATOR=', structure.node(exprTerm(separator))]),
    ]),
  )
}

// ============================================================================
// GRAPH Patterns
// ============================================================================

// ============================================================================
// GRAPH Patterns
// ============================================================================

/**
 * Create a GRAPH pattern for querying named graphs.
 *
 * Under the hood this uses the VarOrIriRef grammar:
 *
 *   GRAPH VarOrIriRef { ... }
 *
 * That means the graph identifier can be:
 * - A variable: `"g"`, `"?g"`, or `$g` → normalised to `?g`
 * - An IRI: `"http://example.org/data"` → `<http://example.org/data>`
 * - A prefixed name: `"ex:GraphTermType"`
 *
 * It will *not* accept GraphRefAll keywords like DEFAULT/NAMED/ALL here,
 * because those belong to the update grammar (`GraphRefAll`), not to
 * GRAPH graph patterns in queries.
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
 * // GRAPH ?g { ?person foaf:name ?name . }
 * ```
 *
 * @example Combine with FROM NAMED
 * ```ts
 * select(['?person', '?name'])
 *   .fromNamed('http://example.org/graph1')
 *   .where(graph('?g', triple('?person', 'foaf:name', '?name')))
 * // FROM NAMED <http://example.org/graph1>
 * // WHERE {
 * //   GRAPH ?g { ?person foaf:name ?name . }
 * // }
 * ```
 */
export function graph(
  graphIri: IriInputType,
  pattern: PatternValueType,
): PatternValueType {
  const graphRef = toVarOrIriRef(graphIri)
  return structure.pattern(rawPattern(`GRAPH ${graphRef} { ${pattern.value} }`), {
    kind: 'graph',
    bindings: [...structure.scope([pattern]), ...(isVariableToken(graphRef) ? [graphRef] : [])],
    children: [pattern],
    variables: isVariableToken(graphRef),
  })
}

// ============================================================================
// Special Values and Functions
// ============================================================================

/**
 * Returns the SPARQL `UNDEF` data-block token.
 *
 * `UNDEF` is valid in VALUES data blocks. It is not a general expression value
 * and must not be rewritten as a variable such as `?UNDEF`.
 */
export function undef(): SparqlTermType {
  return rawTerm('UNDEF')
}

// ============================================================================
// Property Paths
// ============================================================================

/** Admits only IRI/path atoms, excluding variables from compound paths. */
function pathNode(value: PredicateInputType): structure.NodeType {
  if (typeof value !== 'string' && structure.isPath(value)) return structure.node(value)
  const token = toPredicateToken(value)
  if (
    /^[?$]/.test(token) || token.startsWith('"') || token.startsWith("'") || token.startsWith('_:')
  ) throw new TypeError('Path atom must be an IRI or a.')
  return { kind: 'atom', text: token }
}

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
export function zeroOrMore(property: PredicateInputType): SparqlPathType {
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '*', children: [pathNode(property)] })
}

/**
 * One or more path.
 *
 * Matches the property one or more times. Like + in regular expressions.
 * At least one hop is required. Cycles can reach the starting node again.
 *
 * @param property Property IRI
 *
 * @example Find direct and indirect reports
 * ```ts
 * triple('?manager', oneOrMore('org:manages'), '?employee')
 * // ?manager org:manages+ ?employee
 * // Matches all reports at any level, including the manager when a cycle exists
 * ```
 *
 * @example Ancestor relationships
 * ```ts
 * triple('?ancestor', oneOrMore('bio:parent'), '?descendant')
 * // Finds parents, grandparents, great-grandparents, etc.
 * ```
 */
export function oneOrMore(property: PredicateInputType): SparqlPathType {
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '+', children: [pathNode(property)] })
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
export function zeroOrOne(property: PredicateInputType): SparqlPathType {
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '?', children: [pathNode(property)] })
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
export function sequence(...properties: PredicateInputType[]): SparqlPathType {
  if (!properties.length) throw new TypeError('Path requires at least one atom.')
  const children = properties.map(pathNode)
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '/', children })
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
export function alternative(...properties: PredicateInputType[]): SparqlPathType {
  if (!properties.length) throw new TypeError('Path requires at least one atom.')
  const children = properties.map(pathNode)
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '|', children })
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
export function inverse(property: PredicateInputType): SparqlPathType {
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '^', children: [pathNode(property)] })
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
export function negatedPropertySet(...properties: PredicateInputType[]): SparqlPathType {
  if (!properties.length) throw new TypeError('Path requires at least one atom.')
  const children = properties.map(pathNode)
  if (
    children.some((child) =>
      child.kind === 'path' && !(child.operator === '^' && child.children[0]?.kind === 'atom')
    )
  ) throw new TypeError('Negated sets contain only IRI/a or inverse IRI/a atoms.')
  return structure.view({
    [SPARQL_VALUE_BRAND]: true as const,
    [SPARQL_PATH_BRAND]: true as const,
    value: '',
  }, { kind: 'path', operator: '!', children })
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
  endpoint: IriInputType,
  pattern: PatternValueType,
  silent = false,
): PatternValueType {
  const endpointRef = toVarOrIriRef(endpoint)
  const silentModifier = silent ? 'SILENT ' : ''
  return structure.pattern(
    rawPattern(`SERVICE ${silentModifier}${endpointRef} { ${pattern.value} }`),
    { kind: 'service', bindings: [...structure.scope([pattern])], children: [pattern] },
  )
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
 * @param prefix Prefix name
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
export function definePrefix(prefix: PrefixNameType, iri: string | RdfNamedNode): SparqlValueType {
  validatePrefixName(prefix)

  if (isRdfTerm(iri)) {
    return raw(`PREFIX ${prefix}: ${toPredicateToken(iri)}`)
  }

  const trimmed = iri.trim()
  if (isIRIRefToken(trimmed)) {
    const inner = trimmed.slice(1, -1)
    validateIRI(inner)
    return raw(`PREFIX ${prefix}: ${trimmed}`)
  }

  validateIRI(trimmed)
  return raw(`PREFIX ${prefix}: <${trimmed}>`)
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
export function md5(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('MD5', value)
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
export function sha1(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('SHA1', value)
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
export function sha256(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('SHA256', value)
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
export function sha384(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('SHA384', value)
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
export function sha512(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('SHA512', value)
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
export function now(): SparqlValueType {
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
export function uuid(): SparqlValueType {
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
export function struuid(): FluentExprType {
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
export function rand(): FluentExprType {
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
export function strdt(lexical: SparqlValueType, datatype: SparqlValueType): SparqlValueType {
  return call('STRDT', lexical, datatype)
}

/** Creates a SPARQL STRLANG expression from lexical text and a language tag. */
export function strlang(lexical: SparqlValueType, lang: string): SparqlValueType {
  return call('STRLANG', lexical, lang)
}

/** Creates a SPARQL sameTerm expression without JavaScript value coercion. */
export function sameTerm(a: SparqlValueType, b: SparqlValueType): SparqlValueType {
  return call('sameTerm', a, b)
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
export function encodeForUri(value: SparqlValueType | ExpressionPrimitiveType): FluentExprType {
  return call('ENCODE_FOR_URI', value)
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
  lang: SparqlValueType | ExpressionPrimitiveType,
  range: string,
): SparqlValueType {
  return call('langMatches', lang, range)
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
export function iri(value: SparqlValueType | ExpressionPrimitiveType): SparqlValueType {
  return call('IRI', value)
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
export function minus(pattern: PatternValueType): PatternValueType {
  return structure.pattern(rawPattern(`MINUS { ${pattern.value} }`), {
    kind: 'minus',
    bindings: [],
    children: [pattern],
  })
}

/** Function calls retain compact child nodes until text is requested. */
function call(
  name: string,
  ...values: readonly (SparqlValueType | ExpressionPrimitiveType)[]
): FluentExprType {
  const parts: (structure.NodeType | string)[] = [name, '(']
  values.forEach((value, index) => {
    if (index) parts.push(', ')
    parts.push(structure.node(exprTerm(value)))
  })
  parts.push(')')
  return fluent(fragment(parts))
}

/** Internal grammar fragments contain checked children and literal syntax owned by this module. */
function fragment(parts: readonly (structure.NodeType | string)[]): SparqlExprType {
  return structure.view(raw(''), { kind: 'fragment', parts })
}
