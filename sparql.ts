/**
 * Type-safe SPARQL construction using template literals.
 * 
 * Writing SPARQL by hand gets messy fast. String concatenation leads to injection
 * vulnerabilities, and manually escaping values is error-prone. This module lets
 * you write queries with automatic type conversion and proper escaping.
 * 
 * The core idea is simple: use template literals with automatic value conversion.
 * Strings become properly escaped literals, numbers stay as numbers, dates get
 * formatted correctly, and complex values are handled intelligently.
 * 
 * @example Basic query construction
 * ```ts
 * const name = "Peter Parker";
 * const age = 30;
 * 
 * const query = sparql`
 *   SELECT * WHERE {
 *     ?person foaf:name ${name} ;
 *            foaf:age ${age} .
 *   }
 * `;
 * ```
 * 
 * @example Working with arrays
 * ```ts
 * const cities = ["London", "Paris", "Tokyo"];
 * 
 * // Arrays become space-separated values for VALUES clauses
 * const query = sparql`
 *   SELECT * WHERE {
 *     VALUES ?city { ${cities} }
 *     ?place schema:name ?city .
 *   }
 * `;
 * ```
 * 
 * @module
 */

import { outdent } from "outdent"

// ============================================================================
// Core Types
// ============================================================================

/**
 * Wrapper that marks a value as SPARQL-ready.
 * 
 * This prevents double-escaping and lets us mix raw SPARQL with constructed values.
 * When you see SparqlValue in a function signature, it means that value has already
 * been processed and is safe to insert directly into queries.
 */
export interface SparqlValue {
  readonly __sparql: true
  readonly value: string
}

/**
 * Any value that can be safely interpolated into a SPARQL query.
 * 
 * The system automatically converts these to proper SPARQL syntax:
 * - Strings → triple-quoted literals with xsd:string datatype
 * - Numbers → raw integers or decimals with appropriate datatypes
 * - Booleans → raw true/false
 * - Dates → xsd:dateTime literals
 * - Arrays → space-separated lists for VALUES or RDF lists
 * - Objects → blank nodes with properties
 * - SparqlValue → used as-is (already processed)
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
 * Variable name without the leading ? or $ sigil.
 * 
 * In SPARQL, variables can be written as ?name or $name. We normalize these
 * internally to just store the name part, then add the ? when generating queries.
 */
export type VariableName = string | `?${string}` | SparqlValue

/**
 * Namespace prefix for abbreviated IRIs (e.g., "foaf" in foaf:name).
 */
export type PrefixName = string

/**
 * Full IRI for a datatype (e.g., http://www.w3.org/2001/XMLSchema#integer).
 */
export type DatatypeIRI = string

/**
 * Language tag for multilingual literals (e.g., "en", "fr", "ja-JP").
 */
export type LanguageTag = string

// ============================================================================
// Escaping & Validation
// ============================================================================

/**
 * Normalize variable names to handle both ?foo and foo formats.
 * 
 * SPARQL lets you write variables with ? or $ prefixes, but we want consistent
 * internal representation. This function strips the prefix if present, so both
 * "foo" and "?foo" become "foo" internally.
 */
export function normalizeVariableName(name: VariableName): string {
  const n = isSparqlValue(name) ? name?.value : name;
  return n.startsWith('?') ? (n.slice(1) as string) : (n as string)
}

/**
 * Escape a JavaScript string so it can be safely embedded as a
 * SPARQL string literal.
 *
 * This is designed for building SPARQL queries by hand or via a query
 * builder, where you need to interpolate arbitrary user/content strings
 * into a literal like:
 *
 * ```sparql
 * "some value"
 * 'some value'
 * ```
 *
 * In raw SPARQL, string literals:
 *
 * - Are delimited by either double quotes (`"..."`) or single quotes (`'...'`)
 * - Must escape certain characters using backslashes (e.g. `\"`, `\\`, `\n`)
 * - Cannot contain unescaped control characters (U+0000–U+001F)
 *
 * This function handles those rules for you so you can safely do:
 *
 * ```ts
 * const escaped = escapeString(userInput, '"')
 * const query = `
 *   SELECT ?s WHERE {
 *     ?s rdfs:label "${escaped}" .
 *   }
 * `
 * ```
 *
 * # What this function does
 *
 * 1. **Escapes the backslash**:
 *    - `\` → `\\`
 *
 * 2. **Escapes the chosen quote delimiter**:
 *    - If `quote` is `"`, then `"` → `\"`
 *    - If `quote` is `'`, then `'` → `\'`
 *
 * 3. **Escapes common control characters using SPARQL-style escapes**:
 *    - Newline (`\n`)      → `\\n`
 *    - Carriage return (`\r`) → `\\r`
 *    - Tab (`\t`)          → `\\t`
 *    - Backspace (`\b`)    → `\\b`
 *    - Form feed (`\f`)    → `\\f`
 *
 * 4. **Escapes all remaining control characters U+0000–U+001F**:
 *    - Anything not covered above is encoded as a Unicode escape:
 *      - e.g. `\x01` (U+0001) → `\\u0001`
 *
 * 5. **Leaves all other characters as-is**:
 *    - Emoji, accents, CJK characters, etc. are preserved directly.
 *    - For example:
 *      - `"Don't panic 🦇"` is valid as a SPARQL literal once the backslashes
 *        and quotes are handled.
 *
 * # What this function does *not* do
 *
 * - It does **not** escape IRIs or prefixed names:
 *   - This is only for string literals, e.g. `"value"`, not `<http://example.com>`.
 *
 * - It does **not** handle long string literals (triple quotes) specially:
 *   - It is safe to use, but you still need to wrap the result in the correct
 *     triple-quoted delimiters yourself (e.g. `"""${escaped}"""`).
 *
 * - It does **not** validate that your string is semantically correct SPARQL:
 *   - It only makes sure the literal part is syntactically safe.
 *
 * # Usage guidelines
 *
 * - Always choose the `quote` argument to match how you will wrap the literal:
 *   - Use `escapeString(value, '"')` when you will emit `"${...}"`.
 *   - Use `escapeString(value, "'")` when you will emit `'${...}'`.
 *
 * - Prefer double-quoted literals (`"..."`) unless you have a specific reason
 *   to use single-quoted ones. That keeps things simpler.
 *
 * @param str
 *   The raw JavaScript string you want to embed inside a SPARQL literal.
 *   This can contain newlines, emoji, quotes, and other Unicode characters.
 *
 * @param quote
 *   The quote character you intend to use to delimit the SPARQL string literal:
 *   - `"\""` – for `"double-quoted"` literals (default)
 *   - `"'"`  – for `'single-quoted'` literals
 *
 *   This affects which quote character is escaped. The *other* quote character
 *   is allowed to remain unescaped because the SPARQL grammar allows it.
 *
 * @returns
 *   A string that can be safely interpolated inside a SPARQL literal delimited
 *   by `quote`, without breaking the query or introducing unescaped control
 *   characters.
 *
 * @example
 * // Example 1: Double-quoted literal with apostrophes and emoji
 * const input = `Don't panic 🦇\nLine 2`
 * const escaped = escapeString(input, '"')
 *
 * // escaped now looks like:
 * //   Don't panic 🦇\nLine 2
 * //
 * // so you can safely emit:
 * const query = `
 *   SELECT ?s WHERE {
 *     ?s rdfs:label "${escaped}" .
 *   }
 * `
 *
 * @example
 * // Example 2: Single-quoted literal
 * const input = `Don't panic 🦇\nLine 2`
 * const escaped = escapeString(input, "'")
 *
 * // escaped now looks like:
 * //   Don\'t panic 🦇\nLine 2
 * //
 * // and you can safely emit:
 * const query = `
 *   SELECT ?s WHERE {
 *     ?s rdfs:label '${escaped}' .
 *   }
 * `
 *
 * @example
 * // Example 3: Defensive handling of weird control characters
 * const input = 'prefix' + String.fromCharCode(1) + 'suffix'
 * const escaped = escapeString(input)
 *
 * // The U+0001 control character is turned into a Unicode escape:
 * //   prefix\\u0001suffix
 * //
 * // This keeps the SPARQL query syntactically valid even if the source
 * // data contains unexpected binary-like content.
 */
export function escapeString(
  str: string,
  quote: '"' | "'" = '"',
): string {
  return str.replace(/[\u0000-\u001F\\'"]/g, function (ch: string): string {
    // Always escape backslash
    if (ch === '\\') {
      return '\\\\'
    }

    // Escape whichever quote you are actually using as the delimiter
    if (ch === quote) {
      return '\\' + ch
    }

    // The non-delimiting quote does not *need* escaping for SPARQL's grammar.
    if (ch === '"' || ch === "'") {
      return ch
    }

    // Control characters with explicit SPARQL-style escapes
    switch (ch) {
      case '\n': return '\\n'
      case '\r': return '\\r'
      case '\t': return '\\t'
      case '\b': return '\\b'
      case '\f': return '\\f'
      default: {
        // Any remaining control char U+0000–U+001F gets a \u00XX escape
        const code = ch.charCodeAt(0)
        const hex = code.toString(16).toUpperCase().padStart(4, '0')
        return '\\u' + hex
      }
    }
  })
}

/**
 * Validate that a string is a proper IRI.
 * 
 * IRIs must start with http:// or https:// and can't contain certain forbidden
 * characters like spaces, angle brackets, or pipes. This catches common mistakes
 * before they cause query errors.
 */
export function validateIRI(iri: string): void {
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
 * Validate SPARQL variable names.
 * 
 * Variable names must start with a letter or underscore, followed by letters,
 * numbers, or underscores. This matches the SPARQL 1.1 specification.
 */
export function validateVariableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid variable name: ${name}`)
  }
}

/**
 * Validate namespace prefix names.
 * 
 * Prefixes follow the same rules as variable names - they're identifiers that
 * get expanded to full IRIs during query execution.
 */
export function validatePrefixName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid prefix name: ${name}`)
  }
}

// ============================================================================
// Type Conversion
// ============================================================================

/**
 * Convert Date to xsd:dateTime with full timestamp.
 * 
 * Uses ISO 8601 format with timezone. This is the standard way to represent
 * date-time values in RDF.
 * 
 * @example "2024-01-15T10:30:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>
 */
export function formatDateTime(date: Date): string {
  return `"${date.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`
}

/**
 * Convert Date to xsd:date with date only (no time component).
 * 
 * Useful when you only care about the calendar date, not the time. The format
 * is YYYY-MM-DD.
 * 
 * @example "2024-01-15"^^<http://www.w3.org/2001/XMLSchema#date>
 */
export function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `"${yyyy}-${mm}-${dd}"^^<http://www.w3.org/2001/XMLSchema#date>`
}

/**
 * Convert array to SPARQL representation.
 * 
 * The conversion depends on what's in the array. For primitive values, we generate
 * a space-separated list suitable for VALUES clauses. For complex values, we
 * generate an RDF list using parentheses notation.
 * 
 * @example Primitive values (for VALUES)
 * ```ts
 * formatArray([1, 2, 3]) // → "1 2 3"
 * ```
 * 
 * @example Complex values (RDF list)
 * ```ts
 * formatArray([obj1, obj2]) // → "( [props...] [props...] )"
 * ```
 */
export function formatArray(arr: SparqlInterpolatable[]): string {
  if (arr.length === 0) {
    throw new Error('Cannot convert empty array to SPARQL')
  }

  // Check if all elements are simple primitives
  const allPrimitives = arr.every(
    (item) =>
      item instanceof Date ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null ||
      item === undefined
  )

  if (allPrimitives) {
    // For VALUES clauses, just space-separate the values
    const values = arr.map((item) => convertValue(item)).join(' ')
    return values
  }

  // For complex arrays, generate RDF list notation
  const values = arr.map((item) => convertValue(item)).join(' ')
  return `( ${values} )`
}

/**
 * Convert object to SPARQL blank node with properties.
 * 
 * JavaScript objects map naturally to RDF blank nodes. Each key becomes a predicate,
 * and each value becomes an object. Keys can be prefixed names (foaf:name) or
 * full IRIs.
 * 
 * @example
 * ```ts
 * formatObject({
 *   'foaf:name': 'Alice',
 *   'foaf:age': 30
 * })
 * // → [ foaf:name "Alice" ; foaf:age 30 ]
 * ```
 */
export function formatObject(obj: { [key: string]: SparqlInterpolatable }): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    throw new Error('Cannot convert empty object to SPARQL')
  }

  // Generate blank node syntax with semicolon-separated properties
  const properties = entries
    .map(([key, value]) => {
      // Handle different predicate formats
      const predicate = key.includes(':') || key.startsWith('http')
        ? key.includes(':')
          ? key // Already a prefixed name
          : `<${key}>` // Full IRI needs angle brackets
        : `:${key}` // Default to colon prefix

      return `${predicate} ${convertValue(value)}`
    })
    .join(' ; ')

  return `[ ${properties} ]`
}

/**
 * Convert any JavaScript value to its SPARQL representation.
 * 
 * This is the workhorse function that handles all type conversions. It's called
 * automatically by the sparql template tag, so you rarely need to call it directly.
 * The conversion rules match what developers expect - strings become literals,
 * numbers stay as numbers, dates get proper formatting.
 * 
 * @param value The value to convert
 * @param strict If true, throw errors for null/undefined; if false, convert to empty string
 * 
 * @throws {Error} For null/undefined when strict=true (use OPTIONAL instead)
 * @throws {Error} For empty arrays or objects (they're ambiguous in SPARQL)
 * @throws {Error} For values that can't be represented in SPARQL
 */
export function convertValue(value: SparqlInterpolatable, strict = true): string {
  // Already wrapped - use as-is
  if (isSparqlValue(value)) {
    return value.value
  }

  // Null/undefined - these are tricky in RDF
  if (value === null || value === undefined) {
    if (strict) {
      throw new Error(
        'Cannot convert null/undefined to SPARQL. Use OPTIONAL { } pattern instead.'
      )
    }
    return strlit('').value
  }

  // String - becomes xsd:string literal
  if (typeof value === 'string') {
    return strlit(value).value
  }

  // Boolean - raw true/false keywords
  if (typeof value === 'boolean') {
    return boolean(value).value
  }

  // Number - raw numeric literal (SPARQL infers type)
  if (typeof value === 'number') {
    return num(value).value
  }

  // Date - becomes xsd:dateTime
  if (value instanceof Date) {
    return date(value).value
  }

  // Array - space-separated list or RDF list
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
 * Check if a value is already wrapped as SparqlValue.
 * 
 * This type guard lets us avoid double-processing values that have already
 * been converted to SPARQL format.
 */
export function isSparqlValue(value: unknown): value is SparqlValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__sparql' in value &&
    value.__sparql === true
  )
}

/**
 * Wrap a string as SparqlValue without any conversion.
 * 
 * Internal helper for creating SparqlValue objects. Marks the string as
 * already-processed SPARQL so it won't be escaped or converted again.
 */
export function wrapSparqlValue(value: string): SparqlValue {
  return { __sparql: true, value: value }
}

// ============================================================================
// Value Constructors
// ============================================================================

/**
 * Create an IRI reference wrapped in angle brackets.
 * 
 * IRIs are how you reference resources in RDF. This function validates the IRI
 * format and wraps it in the required angle brackets.
 * 
 * @example uri('http://example.org/resource') → <http://example.org/resource>
 */
export function uri(iri: string): SparqlValue {
  validateIRI(iri)
  return wrapSparqlValue(`<${iri}>`)
}

/**
 * Create a SPARQL variable reference.
 * 
 * Variables are placeholders that get bound to values during query execution.
 * The ? prefix is added automatically, so you can write either "name" or "?name".
 * 
 * @example variable('person') → ?person
 * @example variable('?person') → ?person (? is normalized)
 */
export function variable(name: VariableName): SparqlValue {
  const n = normalizeVariableName(name)
  validateVariableName(n)
  return wrapSparqlValue(`?${n}`)
}

/**
 * Create a prefixed name (namespace:local format).
 * 
 * Prefixes let you abbreviate long IRIs. Instead of writing out the full IRI
 * each time, you can use a short prefix. Your query needs matching PREFIX
 * declarations at the top.
 * 
 * @example prefixed('foaf', 'name') → foaf:name
 * @example prefixed('schema', 'Person') → schema:Person
 */
export function prefixed(prefix: PrefixName, localName: string): SparqlValue {
  validatePrefixName(prefix)
  return wrapSparqlValue(`${prefix}:${localName}`)
}

/**
 * Alias for {@link prefixed} with more explicit naming.
 */
export function prefix(namespace: string, local: string): SparqlValue {
  return prefixed(namespace, local)
}

/**
 * Create an xsd:date literal (calendar date without time).
 * 
 * Use this when you only care about the date, not the time. Good for birthdays,
 * publication dates, or any calendar-based data.
 * 
 * @example date(new Date('2024-01-15')) → "2024-01-15"^^xsd:date
 */
export function date(value: Date | string): SparqlValue {
  const dateObj = value instanceof Date ? value : new Date(value)
  return wrapSparqlValue(formatDate(dateObj))
}

/**
 * Create an xsd:dateTime literal (full timestamp with time).
 * 
 * Use this when you need both date and time. The format includes milliseconds
 * and timezone information.
 * 
 * @example dateTime(new Date()) → "2024-01-15T10:30:00.000Z"^^xsd:dateTime
 */
export function dateTime(value: Date | string): SparqlValue {
  const dateObj = value instanceof Date ? value : new Date(value)
  return wrapSparqlValue(formatDateTime(dateObj))
}

/**
 * Create an xsd:integer literal.
 * 
 * Explicitly marks a number as an integer. Throws if you pass a non-integer value.
 * Most of the time you can just use {@link num} instead, which picks the right
 * type automatically.
 * 
 * @throws {Error} If value is not an integer
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
 * Create an xsd:decimal literal.
 * 
 * Explicitly marks a number as a decimal. Good for currency or precise measurements
 * where you want decimal semantics rather than floating point.
 * 
 * @throws {Error} If value is not finite (NaN or Infinity)
 */
export function decimal(value: number): SparqlValue {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number, got: ${value}`)
  }

  return wrapSparqlValue(
    `"${value}"^^<http://www.w3.org/2001/XMLSchema#decimal>`
  )
}

/**
 * Create a numeric literal (integer or decimal).
 * 
 * Picks the right type automatically based on whether the number is an integer
 * or has a fractional part. This is what the automatic conversion uses.
 */
export function num(value: number): SparqlValue {
  if (Number.isInteger(value)) {
    return integer(value)
  }

  return decimal(value)
}

/**
 * Create a boolean literal (true or false).
 * 
 * Boolean values in SPARQL are written as bare keywords, not quoted strings.
 */
export function boolean(value: boolean): SparqlValue {
  return wrapSparqlValue(String(!!value))
}

/**
 * Short alias for {@link boolean}.
 */
export function bool(value: boolean): SparqlValue {
  return boolean(value)
}

/**
 * Create a language-tagged literal.
 * 
 * Use this for multilingual text. The language tag indicates which language the
 * text is in, following BCP 47 conventions (en, fr, ja-JP, etc.).
 * 
 * @example lang('Hello', 'en') → "Hello"@en
 * @example lang('Bonjour', 'fr') → "Bonjour"@fr
 */
export function lang(value: string, tag: LanguageTag): SparqlValue {
  return wrapSparqlValue(`"""${escapeString(value)}"""@${tag}`)
}

/**
 * Create a typed literal with custom datatype.
 * 
 * For when you need a specific datatype that isn't covered by the standard helpers.
 * The datatype must be a full IRI.
 * 
 * @example typed('custom value', 'http://example.org/datatype')
 */
export function typed(value: string, datatype: DatatypeIRI): SparqlValue {
  validateIRI(datatype)
  return wrapSparqlValue(
    `"""${escapeString(value)}"""^^<${datatype}>`
  )
}

/**
 * Create an xsd:string literal.
 * 
 * Explicitly creates a string literal. This is what the automatic conversion uses
 * for string values.
 */
export function strlit(value: string): SparqlValue {
  return typed(value, "http://www.w3.org/2001/XMLSchema#string")
}

/**
 * Insert raw SPARQL without any escaping.
 * 
 * ⚠️ DANGEROUS: This bypasses all safety checks. Only use this when you have
 * complete control over the input and you're certain it's safe. Prefer the
 * type-safe helpers whenever possible.
 * 
 * @example raw('?person foaf:name ?name') → ?person foaf:name ?name
 */
export function raw(value: string): SparqlValue {
  return wrapSparqlValue(value)
}

// ============================================================================
// Main Template Tag
// ============================================================================

/**
 * Main template tag for building SPARQL queries.
 * 
 * This is the primary way to construct queries. It automatically converts
 * interpolated values to proper SPARQL syntax and handles indentation.
 * 
 * Use this whenever you're writing SPARQL. The automatic conversions handle
 * the tedious escaping work, and the template literal format keeps your queries
 * readable.
 * 
 * @example Basic query
 * ```ts
 * const name = "Peter Parker";
 * const minAge = 18;
 * 
 * const query = sparql`
 *   SELECT ?person WHERE {
 *     ?person foaf:name ${name} ;
 *            foaf:age ?age .
 *     FILTER(?age >= ${minAge})
 *   }
 * `;
 * ```
 * 
 * @example With arrays
 * ```ts
 * const cities = ["London", "Paris", "Tokyo"];
 * 
 * const query = sparql`
 *   SELECT * WHERE {
 *     VALUES ?city { ${cities} }
 *     ?place schema:name ?city .
 *   }
 * `;
 * ```
 * 
 * @example With nested values
 * ```ts
 * const person = {
 *   'foaf:name': 'Alice',
 *   'foaf:age': 30
 * };
 * 
 * const query = sparql`
 *   INSERT DATA {
 *     ?person ${person}
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
// Re-exports
// ============================================================================

export default sparql