/**
 * Type-safe SPARQL query construction with template literals
 * 
 * Provides automatic type conversion for:
 * - Primitives: strings, numbers, booleans, dates
 * - Complex types: arrays, objects, nested structures
 * - SPARQL constructs: variables, prefixes, IRIs
 * 
 * @example
 * ```ts
 * const name = "John Doe";
 * const age = 30;
 * const tags = ["hero", "villain"];
 * 
 * const query = sparql`
 *   SELECT * WHERE {
 *     ?person foaf:name ${name} ;
 *            foaf:age ${age} ;
 *            tags:has ${tags} .
 *   }
 * `;
 * ```
 */

// ============================================================================
// Core Types
// ============================================================================

import { outdent } from "outdent"

/**
 * SPARQL value wrapper for type-safe interpolation
 */
export interface SparqlValue {
  readonly __sparql: true
  readonly value: string
}

/**
 * Any value that can be interpolated into SPARQL query
 */
export type SparqlInterpolatable =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | SparqlValue
  | SparqlInterpolatable[]
  | { [key: string]: SparqlInterpolatable }

/**
 * Variable name in SPARQL (without ? or $ prefix)
 */
export type VariableName = string

/**
 * Prefix name for namespace abbreviation
 */
export type PrefixName = string

/**
 * Literal datatype IRI
 */
export type DatatypeIRI = string

/**
 * Language tag (e.g., 'en', 'fr', 'ja')
 */
export type LanguageTag = string

// ============================================================================
// Escaping & Validation
// ============================================================================

/**
 * Normalize a variable name so that both "foo" and "?foo" are accepted,
 * but internally we always store "foo" and validate via sparql.ts.
 */
export function normalizeVariableName(name: string | `?${string}`): VariableName {
  // Accept ?foo or foo; store as foo
  return name.startsWith('?') ? (name.slice(1) as VariableName) : (name as VariableName)
}

/**
 * Escape string for use in SPARQL triple-quoted literal
 * 
 * Escapes: backslash, double-quote, newline, carriage return, tab
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Validate IRI format
 * 
 * Must be http/https and not contain forbidden characters
 */
function validateIRI(iri: string): void {
  if (!iri.startsWith('http://') && !iri.startsWith('https://')) {
    throw new Error(`IRI must start with http:// or https://, got: ${iri}`)
  }

  const forbidden = ['<', '>', '"', '{', '}', '|', '^', '`', '\\', ' ']
  for (const char of forbidden) {
    if (iri.includes(char)) {
      throw new Error(`IRI contains forbidden character '${char}': ${iri}`)
    }
  }
}

/**
 * Validate variable name (must be valid SPARQL variable)
 */
function validateVariableName(name: string): void {
  // SPARQL variable names must match: [A-Za-z_][A-Za-z0-9_]*
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid variable name: ${name}`)
  }
}

/**
 * Validate prefix name (must be valid SPARQL prefix)
 */
function validatePrefixName(name: string): void {
  // Prefix names match same rules as variables
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid prefix name: ${name}`)
  }
}

// ============================================================================
// Type Conversion
// ============================================================================

/**
 * Convert Date to xsd:dateTime literal
 */
function formatDateTime(date: Date): string {
  return `"${date.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`
}

/**
 * Convert Date to xsd:date literal (date only, no time)
 */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `"${yyyy}-${mm}-${dd}"^^<http://www.w3.org/2001/XMLSchema#date>`
}

/**
 * Convert array to SPARQL VALUES clause or list
 */
function formatArray(arr: SparqlInterpolatable[]): string {
  if (arr.length === 0) {
    throw new Error('Cannot convert empty array to SPARQL')
  }

  // Check if all elements are primitives (for VALUES clause)
  const allPrimitives = arr.every(
    (item) =>
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null ||
      item === undefined
  )

  if (allPrimitives) {
    // Generate VALUES clause: VALUES ?var { val1 val2 val3 }
    const values = arr.map((item) => convertValue(item)).join(' ')
    return values
  }

  // For complex arrays, generate RDF list: ( val1 val2 val3 )
  const values = arr.map((item) => convertValue(item)).join(' ')
  return `( ${values} )`
}

/**
 * Convert object to SPARQL inline data or blank node
 */
function formatObject(obj: { [key: string]: SparqlInterpolatable }): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    throw new Error('Cannot convert empty object to SPARQL')
  }

  // Generate blank node with properties: [ pred1 val1 ; pred2 val2 ]
  const properties = entries
    .map(([key, value]) => {
      // Assume keys are predicates (can be prefixed or IRIs)
      const predicate = key.includes(':') || key.startsWith('http')
        ? key.includes(':')
          ? key // Already prefixed
          : `<${key}>` // Full IRI
        : `:${key}` // Default to colon prefix

      return `${predicate} ${convertValue(value)}`
    })
    .join(' ; ')

  return `[ ${properties} ]`
}

/**
 * Convert any value to SPARQL representation
 */
function convertValue(value: SparqlInterpolatable): string {
  // Already wrapped SparqlValue
  if (isSparqlValue(value)) {
    return value.value
  }

  // Null/undefined - throw error (use OPTIONAL instead)
  if (value === null || value === undefined) {
    throw new Error(
      'Cannot convert null/undefined to SPARQL. Use OPTIONAL { } pattern instead.'
    )
  }

  // String - triple-quoted literal with xsd:string
  if (typeof value === 'string') {
    return `"""${escapeString(value)}"""^^<http://www.w3.org/2001/XMLSchema#string>`
  }

  // Number - raw number (SPARQL infers integer/decimal/double)
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value)
    }
    return `"${value}"^^<http://www.w3.org/2001/XMLSchema#decimal>`
  }

  // Boolean - raw true/false
  if (typeof value === 'boolean') {
    return String(value)
  }

  // Date - xsd:dateTime
  if (value instanceof Date) {
    return formatDateTime(value)
  }

  // Array - VALUES clause or RDF list
  if (Array.isArray(value)) {
    return formatArray(value)
  }

  // Object - blank node with properties
  if (typeof value === 'object') {
    return formatObject(value as { [key: string]: SparqlInterpolatable })
  }

  throw new Error(`Cannot convert value of type ${typeof value} to SPARQL`)
}

/**
 * Type guard for SparqlValue
 */
function isSparqlValue(value: unknown): value is SparqlValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__sparql' in value &&
    value.__sparql === true
  )
}

/**
 * Wrap string as SparqlValue (for internal use)
 */
function wrapSparqlValue(value: string): SparqlValue {
  return { __sparql: true, value: value }
}

// ============================================================================
// Main Template Tag Function
// ============================================================================

/**
 * SPARQL template tag for type-safe query construction
 * 
 * @example
 * ```ts
 * const query = sparql`
 *   SELECT ?name ?age WHERE {
 *     ?person foaf:name ${name} ;
 *            foaf:age ${age} .
 *   }
 * `;
 * ```
 */
export function sparql(
  strings: TemplateStringsArray,
  ...values: SparqlInterpolatable[]
): SparqlValue {
  let result = strings[0]

  for (let i = 0; i < values.length; i++) {
    result += convertValue(values[i])
    result += strings[i + 1]
  }

  return wrapSparqlValue(outdent.string(result))
}

// ============================================================================
// Explicit Constructors
// ============================================================================

/**
 * Create IRI reference
 * 
 * @example uri('http://example.org/resource') → <http://example.org/resource>
 */
export function uri(iri: string): SparqlValue {
  validateIRI(iri)
  return wrapSparqlValue(`<${iri}>`)
}

/**
 * Create IRI reference (explicit, clear)
 * 
 * @example iri('http://example.org/person/1') → <http://example.org/person/1>
 */
export function iri(value: string): SparqlValue {
  return uri(value)
}

/**
 * Create variable reference
 * 
 * Note: In SPARQL, variables are written as ?name or $name.
 * This function handles the ? prefix automatically.
 * 
 * @example variable('person') → ?person
 */
export function variable(name: VariableName): SparqlValue {
  const n = name.startsWith('?') ? name.slice(1) : name
  validateVariableName(n)
  return wrapSparqlValue(`?${n}`)
}

/**
 * Create variable reference (explicit, clear)
 * 
 * @example var('name') → ?name
 */
export function v(name: string): SparqlValue {
  return variable(name)
}

/**
 * Create prefixed name reference
 * 
 * @example prefixed('foaf', 'name') → foaf:name
 */
export function prefixed(prefix: PrefixName, localName: string): SparqlValue {
  validatePrefixName(prefix)
  return wrapSparqlValue(`${prefix}:${localName}`)
}

/**
 * Create prefixed name (explicit, clear)
 * 
 * @example prefix('foaf', 'name') → foaf:name
 */
export function prefix(namespace: string, local: string): SparqlValue {
  return prefixed(namespace, local)
}

/**
 * Create date literal (xsd:date - no time component)
 * 
 * @example date(new Date('2024-01-15')) → "2024-01-15"^^xsd:date
 */
export function date(value: Date | string): SparqlValue {
  const dateObj = value instanceof Date ? value : new Date(value)
  return wrapSparqlValue(formatDate(dateObj))
}

/**
 * Create dateTime literal (xsd:dateTime - full timestamp)
 * 
 * @example dateTime(new Date()) → "2024-01-15T10:30:00.000Z"^^xsd:dateTime
 */
export function dateTime(value: Date | string): SparqlValue {
  const dateObj = value instanceof Date ? value : new Date(value)
  return wrapSparqlValue(formatDateTime(dateObj))
}

/**
 * Create integer literal (xsd:integer)
 * 
 * @example integer(42) → "42"^^xsd:integer
 */
export function integer(value: number): SparqlValue {
  if (!Number.isInteger(value)) {
    throw new Error(`Expected integer, got: ${value}`)
  }
  return wrapSparqlValue(
    `"${value}"^^<http://www.w3.org/2001/XMLSchema#integer>`
  )
}

/**
 * Create decimal literal (xsd:decimal)
 * 
 * @example decimal(3.14) → "3.14"^^xsd:decimal
 */
export function decimal(value: number): SparqlValue {
  return wrapSparqlValue(
    `"${value}"^^<http://www.w3.org/2001/XMLSchema#decimal>`
  )
}

/**
 * Number literal (explicit)
 */
export function num(value: number): SparqlValue {
  if (Number.isInteger(value)) {
    return integer(value)
  }

  return decimal(value)
}

/**
 * Create boolean literal
 * 
 * @example boolean(true) → true
 */
export function boolean(value: boolean): SparqlValue {
  return wrapSparqlValue(String(value))
}

/**
 * Boolean literal (explicit)
 */
export function bool(value: boolean): SparqlValue {
  return boolean(value)
}

/**
 * Create language-tagged literal
 * 
 * @example lang('Hello', 'en') → "Hello"@en
 */
export function lang(value: string, tag: LanguageTag): SparqlValue {
  return wrapSparqlValue(`"""${escapeString(value)}"""@${tag}`)
}

/**
 * Create typed literal with custom datatype
 * 
 * @example typed('custom value', 'http://example.org/datatype') → "custom value"^^<http://example.org/datatype>
 */
export function typed(value: string, datatype: DatatypeIRI): SparqlValue {
  validateIRI(datatype)
  return wrapSparqlValue(
    `"""${escapeString(value)}"""^^<${datatype}>`
  )
}

/**
 * String literal (explicit)
 */
export function str(value: string): SparqlValue {
  return typed(value, "http://www.w3.org/2001/XMLSchema#string")
}

/**
 * Create raw SPARQL (no escaping)
 * 
 * ⚠️ DANGEROUS: Use only when you control the input completely
 * 
 * @example raw('?person foaf:name ?name') → ?person foaf:name ?name
 */
export function raw(value: string): SparqlValue {
  return wrapSparqlValue(value)
}

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
  validateVariableName(varName)
  return wrapSparqlValue(`BIND(${expression.value} AS ?${varName})`)
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
  return sparql`${value}`
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
    return sparql`` // """"
  }

  const inner = args.map(exprTermString).join(', ')
  return raw(`CONCAT(${inner})`)
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
  if (conditions.length === 0) {
    return raw('true')
  }
  if (conditions.length === 1) {
    return conditions[0]
  }
  return raw(conditions.map((c) => c.value).join(' && '))
}

export function or(
  ...conditions: SparqlValue[]
): SparqlValue {
  if (conditions.length === 0) {
    return raw('false')
  }
  if (conditions.length === 1) {
    return conditions[0]
  }
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


// ============================================================================
// Re-export for convenience
// ============================================================================

export default sparql