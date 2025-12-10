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
 * Internal brand used to distinguish SPARQL values from plain strings.
 */
export const SPARQL_VALUE_BRAND = Symbol('SparqlValueBrand')
export const SPARQL_TERM_BRAND = Symbol('SparqlTermBrand')
export const SPARQL_EXPR_BRAND = Symbol('SparqlExprBrand')
export const SPARQL_PATTERN_BRAND = Symbol('SparqlPatternBrand')

export interface SparqlTerm {
  readonly [SPARQL_VALUE_BRAND]: true
  readonly [SPARQL_TERM_BRAND]: true
  readonly value: string
}

export interface SparqlExpr {
  readonly [SPARQL_VALUE_BRAND]: true
  readonly [SPARQL_EXPR_BRAND]: true
  readonly value: string
}

/**
 * A graph pattern snippet – e.g. a block of triples to drop into WHERE {}.
 * Node, Relationship, and other pattern builders should be this.
 */
export interface PatternValue {
  readonly [SPARQL_VALUE_BRAND]: true
  readonly [SPARQL_PATTERN_BRAND]: true
  readonly value: string
}

export type SparqlValue = SparqlTerm | SparqlExpr | PatternValue

/**
 * Values that can be safely interpolated into the `sparql` tag *as a single
 * RDF term*. This deliberately does NOT include arrays or plain objects.
 *
 * Composite structures (lists, blank-node patterns) must use dedicated helpers:
 * - `valuesList(...)`, `exprList(...)`, `rdfList(...)`
 * - `bnodePattern(...)`
 */
export type SparqlInterpolatable =
  | SparqlValue
  | string
  | number
  | boolean
  | Date
  | null
  | undefined

/**
 * Variable name without the leading ? or $ sigil.
 * 
 * In SPARQL, variables can be written as ?name or $name. We normalize these
 * internally to just store the name part, then add the ? when generating queries.
 */
export type VariableName = string | `?${string}` | SparqlTerm

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
// Internal Helpers
// ============================================================================

/**
 * Type guard for `SparqlValue`.
 */
export function isSparqlValue(value: unknown): value is SparqlValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SparqlValue)[SPARQL_VALUE_BRAND] === true
  )
}

export function isSparqlTerm(v: SparqlValue): v is SparqlTerm {
  return (v as SparqlTerm)[SPARQL_TERM_BRAND] === true
}

export function isSparqlExpr(v: SparqlValue): v is SparqlExpr {
  return (v as SparqlExpr)[SPARQL_EXPR_BRAND] === true
}

export function isPatternValue(v: SparqlValue): v is PatternValue {
  return (v as PatternValue)[SPARQL_PATTERN_BRAND] === true
}

/**
 * Extract the raw string from a SparqlValue or return the string as-is.
 * 
 * Use this when you need the underlying string value without any conversion.
 * This is for SYNTAX elements that should pass through unchanged.
 */
export function toRawString(value: string | SparqlValue): string {
  return isSparqlValue(value) ? value.value : value
}

// ============================================================================
// Grammar helpers (Var / IRI / VarOrIriRef / GraphRef / GraphRefAll)
// ============================================================================

/**
 * Check if a string is already a SPARQL variable token (`?name` or `$name`).
 *
 * This corresponds to the VAR1 / VAR2 productions in the SPARQL grammar.
 */
export function isVariableToken(value: string): boolean {
  const trimmed = value.trim()
  // ASCII-friendly subset of VARNAME; you already restrict variable names
  // via validateVariableName, so this just checks the leading sigil.
  return /^[?$][A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
}

/**
 * Normalise to a canonical `?var` token.
 *
 * Accepts:
 * - `"name"`
 * - `"?name"`
 * - `"$name"`
 * - `SparqlValue` that wraps a variable token
 *
 * Enforces your existing variable naming rules via validateVariableName().
 */
export function toVarToken(name: VariableName): string {
  const normalized = normalizeVariableName(name)
  validateVariableName(normalized)
  return `?${normalized}`
}

/**
 * Check whether a string already looks like an IRIref token: `<http://...>`.
 *
 * This is the lexical `<IRIref>` form from the grammar.
 */
export function isIRIRefToken(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length > 2
}

/**
 * Normalise something that should behave like an IRI or prefixed name.
 *
 * This is the common primitive for:
 * - `iri` (when the user passes a bare IRI)
 * - `PrefixedName`
 * - The `iri` branch of `VarOrIriRef` and `GraphRef`
 *
 * Behaviour:
 * - If it's already `<...>`, we validate the inner IRI and return as-is.
 * - Else we first try treating it as an absolute IRI (validateIRI).
 * - If that fails, we treat it as a prefixed name and validate that.
 *
 * This gives you a clean lexical token suitable for query text.
 */
export function toIriLikeToken(value: string): string {
  const trimmed = value.trim()

  // Already <IRI> → validate inner and return.
  if (isIRIRefToken(trimmed)) {
    const inner = trimmed.slice(1, -1)
    validateIRI(inner)
    return trimmed
  }

  // Try as absolute IRI first (scheme:...)
  try {
    validateIRI(trimmed)
    return `<${trimmed}>`
  } catch {
    // Not a valid absolute IRI → fall through to prefixed
  }

  // Treat as prefixed name `prefix:local`
  validatePrefixedName(trimmed)
  return trimmed
}

/**
 * SPARQL 1.1 `VarOrIriRef`:
 *
 *   VarOrIriRef ::= Var | iri
 *
 * This is the thing used in:
 *   GRAPH VarOrIriRef { ... }
 *   SERVICE VarOrIriRef { ... }  (depending on implementation)
 *
 * Semantics:
 * - If you pass a SparqlValue, we assume it's already a correct token and
 *   just return `.value`.
 * - If you pass a string:
 *   - `?name` / `$name` → normalised to `?name`
 *   - `name` with no colon → treated as variable name → `?name`
 *   - anything else → treated as IRI/prefixed name via toIriLikeToken()
 */
export function toVarOrIriRef(input: string | SparqlValue): string {
  if (isSparqlValue(input)) {
    // Caller is responsible for providing a syntactically correct token.
    return input.value
  }

  const trimmed = input.trim()

  // Explicit variable tokens (?name / $name)
  if (isVariableToken(trimmed)) {
    return toVarToken(trimmed)
  }

  // No colon at all → ambiguous; we follow your existing conventions and
  // treat this as a variable name rather than an IRI or prefixed name.
  if (!trimmed.includes(':')) {
    return toVarToken(trimmed)
  }

  // With a colon → interpret as IRI / prefixed via existing validators.
  return toIriLikeToken(trimmed)
}

/**
 * SPARQL 1.1 Update `GraphRef`:
 *
 *   GraphRef ::= iri
 *
 * This is used in DATA, WITH, USING, etc. Unlike GRAPH patterns in queries,
 * GraphRef does *not* allow variables – only IRIs.
 *
 * We therefore:
 * - Reject obvious variable tokens (`?name` / `$name`)
 * - Normalise to `<IRI>` or `prefix:local`
 */
export function toGraphRef(input: string | SparqlValue): string {
  if (isSparqlValue(input)) {
    // Assume the caller built a correct IRI/prefixed token.
    return input.value
  }

  const trimmed = input.trim()

  if (isVariableToken(trimmed)) {
    throw new Error(
      `GraphRef must be an IRI, not a variable: ${trimmed}`,
    )
  }

  return toIriLikeToken(trimmed)
}

/**
 * SPARQL 1.1 Update `GraphRefAll`:
 *
 *   GraphRefAll ::= GraphRef | 'DEFAULT' | 'NAMED' | 'ALL'
 *
 * Used in operations like:
 *   CLEAR DEFAULT
 *   DROP NAMED
 *   DROP ALL
 *   DROP GRAPH <iri>
 *
 * This helper:
 * - Accepts 'default' | 'named' | 'all' in any case and normalises them.
 * - Otherwise, falls back to a strict GraphRef (IRI) via toGraphRef().
 */
export type GraphRefAllKeyword = 'DEFAULT' | 'NAMED' | 'ALL'

export function toGraphRefAll(input: string | SparqlValue): string {
  if (isSparqlValue(input)) {
    return input.value
  }

  const trimmed = input.trim()
  const upper = trimmed.toUpperCase()

  if (upper === 'DEFAULT' || upper === 'NAMED' || upper === 'ALL') {
    return upper
  }

  return toGraphRef(trimmed)
}

/**
 * Parsed representation of a VarOrIriRef.
 *
 * This is useful when you need to *inspect* what you got back from user
 * input or higher-level code, rather than just drop it into the query string.
 */
export type ParsedVarOrIriRef =
  | {
      kind: 'var'
      /** Name without the leading '?' */
      name: string
      /** Canonical variable token (`?name`) */
      token: string
    }
  | {
      kind: 'iri'
      /** The IRI *without* angle brackets */
      iri: string
      /** Lexical token, usually `<iri>` */
      token: string
    }
  | {
      kind: 'prefixed'
      prefix: string
      local: string
      /** Lexical token like `prefix:local` */
      token: string
    }

/**
 * Parse a VarOrIriRef into a structured representation.
 *
 * Under the hood this first normalises via toVarOrIriRef(), so you get
 * the same semantics as the rest of the builder.
 */
export function parseVarOrIriRef(
  input: string | SparqlValue,
): ParsedVarOrIriRef {
  const token = toVarOrIriRef(input)

  if (isVariableToken(token)) {
    return {
      kind: 'var',
      name: token.slice(1),
      token,
    }
  }

  if (isIRIRefToken(token)) {
    return {
      kind: 'iri',
      iri: token.slice(1, -1),
      token,
    }
  }

  const idx = token.indexOf(':')

  if (idx > 0) {
    return {
      kind: 'prefixed',
      prefix: token.slice(0, idx),
      local: token.slice(idx + 1),
      token,
    }
  }

  // Fallback – in practice toVarOrIriRef() shouldn't produce this,
  // but we keep a safe default that still lets you use the token.
  return {
    kind: 'iri',
    iri: token,
    token,
  }
}

export function rawTerm(value: string): SparqlTerm {
  return {
    [SPARQL_VALUE_BRAND]: true,
    [SPARQL_TERM_BRAND]: true,
    value,
  } as const
}

export function rawExpr(value: string): SparqlExpr {
  return {
    [SPARQL_VALUE_BRAND]: true,
    [SPARQL_EXPR_BRAND]: true,
    value,
  } as const
}

export function rawPattern(text: string): PatternValue {
  return {
    [SPARQL_VALUE_BRAND]: true,
    [SPARQL_PATTERN_BRAND]: true,
    value: text,
  } as const
}

/**
 * Wrap a raw SPARQL snippet as a `SparqlValue`.
 *
 * Use this when you *know* the string is already valid SPARQL syntax and you
 * do not want any further escaping or conversion.
 * 
 * Inserts raw SPARQL without any processing.
 * 
 * You can use this as an escape hatch when the builder doesn't support your syntax:
 * - Property paths
 * - Custom functions
 * - Complex expressions
 * 
 * ⚠️ WARNING: No escaping or validation. Ensure input is safe, before use.
 * 
 * @example
 * raw('foaf:knows+')           // Property path
 * raw('BNODE()')               // Built-in function
 * raw('ex:customFunc(?x, ?y)') // Custom function
 */
export function raw(value: string): SparqlExpr {
  return rawExpr(value)
}

// ============================================================================
// String Escaping
// ============================================================================

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
    if (ch === '\\') return '\\\\'

    // Escape whichever quote you are actually using as the delimiter
    if (ch === quote) return '\\' + ch

    // The non-delimiting quote does not *need* escaping for SPARQL's grammar.
    if (ch === '"' || ch === "'") return ch

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
 * Check if a string needs triple-quoting (contains newlines or quotes).
 */
export function needsLongQuotes(str: string): boolean {
  return str.includes('\n') || str.includes('\r') || 
         str.includes('"') || str.includes("'")
}

// ============================================================================
// Validation (Security-focused, not overly restrictive)
// ============================================================================

/**
 * Characters that could enable SPARQL injection.
 */
export const INJECTION_CHARS = /[<>"'\n\r\t{}:]/

/**
 * Validate an IRI for use in SPARQL.
 * 
 * Allows any valid URI scheme (not just http/https).
 * Blocks characters that could break SPARQL syntax or enable injection.
 * 
 * @throws {Error} If the IRI is invalid or contains forbidden characters
 */
export function validateIRI(iri: string): void {
  // Must have a valid URI scheme (RFC 3986)
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(iri)) {
    throw new Error(`IRI must have a valid scheme (e.g., http:, urn:, file:), got: ${iri}`)
  }
  
  // Block characters that break IRI syntax in SPARQL
  const forbidden = ['<', '>', '"', ' ', '\n', '\r', '\t', '{', '}']
  for (const char of forbidden) {
    if (iri.includes(char)) {
      throw new Error(`IRI contains forbidden character '${char}': ${iri}`)
    }
  }
}

/**
 * Validate a SPARQL variable name.
 * 
 * SPARQL allows Unicode in variable names, but we block injection chars.
 * 
 * @throws {Error} If the variable name is invalid
 */
export function validateVariableName(name: string): void {
  if (!name || name.length === 0) {
    throw new Error('Variable name cannot be empty')
  }
  
  // Block characters that could enable injection
  if (INJECTION_CHARS.test(name)) {
    throw new Error(`Variable name contains forbidden characters: ${name}`)
  }
  
  // Must start with letter or underscore (simplified check)
  if (!/^[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D]/.test(name)) {
    throw new Error(`Variable name must start with a letter or underscore: ${name}`)
  }
}

/**
 * Validate a namespace prefix name.
 * 
 * Prefixes follow similar rules to variable names - they're identifiers that
 * get expanded to full IRIs during query execution.
 * 
 * @throws {Error} If the prefix name is invalid
 */
export function validatePrefixName(name: string): void {
  // Empty prefix (default namespace) is always valid
  if (name === '') return
  
  // Block injection characters
  if (INJECTION_CHARS.test(name) || name.includes(':')) {
    throw new Error(`Prefix name contains forbidden characters: ${name}`)
  }
  
  // Must start with letter or underscore
  if (!/^[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF]/.test(name)) {
    throw new Error(`Prefix name must start with a letter or underscore: ${name}`)
  }
}

/**
 * Validate a prefixed name (prefix:localPart).
 * 
 * @throws {Error} If the prefixed name is malformed
 */
export function validatePrefixedName(prefixedName: string): void {
  const colonIndex = prefixedName.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Prefixed name must contain a colon: ${prefixedName}`)
  }
  
  const prefix = prefixedName.slice(0, colonIndex)
  const local = prefixedName.slice(colonIndex + 1)
  
  validatePrefixName(prefix)
  
  // Local part can be empty or must be a valid local name
  // This is a simplified check - full PN_LOCAL is more complex
  if (local !== '' && !/^[A-Za-z0-9_.-]*$/.test(local)) {
    throw new Error(`Invalid local part in prefixed name: ${prefixedName}`)
  }
}

/**
 * Validate a BCP 47 language tag.
 */
export function validateLanguageTag(tag: string): void {
  // Basic BCP 47 validation
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(tag)) {
    throw new Error(`Invalid language tag: ${tag}. Expected BCP 47 format (e.g., "en", "en-US")`)
  }
}

/**
 * Normalize variable names to handle both ?foo and foo formats.
 * 
 * SPARQL lets you write variables with ? or $ prefixes, but we want consistent
 * internal representation. This function strips the prefix if present, so both
 * "foo" and "?foo" become "foo" internally.
 */
export function normalizeVariableName(name: VariableName): string {
  const n = isSparqlValue(name) ? name?.value : name;
  // Strip ? or $ prefix if present
  if (n.startsWith('?') || n.startsWith('$')) {
    return n.slice(1)
  }
  return n
}

// ============================================================================
// Value Constructors
// ============================================================================

/**
 * Create a SPARQL variable reference.
 * 
 * Variables are placeholders that get bound to values during query execution.
 * The ? prefix is added automatically, so you can write either "name" or "?name".
 * 
 * @example
 * variable('name')  // → ?name
 * variable('?name') // → ?name
 */
export function variable(name: VariableName): SparqlTerm {
  const n = normalizeVariableName(name)
  validateVariableName(n)
  return rawTerm(`?${n}`)
}

/**
 * Create an IRI reference wrapped in angle brackets.
 * 
 * IRIs are how you reference resources in RDF. This function validates the IRI
 * format and wraps it in the required angle brackets.
 * 
 * @example
 * uri('http://example.org/resource')  // → <http://example.org/resource>
 * uri('urn:isbn:0451450523')          // → <urn:isbn:0451450523>

 */
export function uri(iri: string): SparqlTerm {
  validateIRI(iri)
  return rawTerm(`<${iri}>`)
}

/**
 * Create a prefixed name (namespace:local format).
 * 
 * Prefixes let you abbreviate long IRIs.
 * 
 * @example
 * prefixed('foaf', 'name')  // → foaf:name
 */
export function prefixed(prefix: PrefixName, localName: string): SparqlExpr {
  validatePrefixName(prefix)
  // Local names have complex rules; block obvious injection
  if (INJECTION_CHARS.test(localName)) {
    throw new Error(`Local name contains forbidden characters: ${localName}`)
  }
  return raw(`${prefix}:${localName}`)
}

/**
 * Alias for {@link prefixed} with more explicit naming.
 */
export function prefix(namespace: PrefixName, local: string): SparqlExpr {
  return prefixed(namespace, local)
}

/**
 * Create a simple string literal.
 * 
 * Uses the most concise valid syntax:
 * - Simple strings: "value"
 * - Strings with special chars: """value"""
 * 
 * Note: In RDF 1.1, simple string literals implicitly have type xsd:string.
 * 
 * @example
 * strlit('Hello')           // → "Hello"
 * strlit('Line 1\nLine 2')  // → """Line 1\nLine 2"""
 */
export function strlit(value: string): SparqlTerm {
  const escaped = escapeString(value)
  
  if (needsLongQuotes(value)) {
    return rawTerm(`"""${escaped}"""`)
  }

  return rawTerm(`"${escaped}"`)
}

/**
 * Create a typed literal with explicit datatype.
 * 
 * @example
 * typed('42', 'http://www.w3.org/2001/XMLSchema#integer')
 * // → "42"^^<http://www.w3.org/2001/XMLSchema#integer>
 */
export function typed(value: string, datatype: DatatypeIRI): SparqlTerm {
  validateIRI(datatype)
  const escaped = escapeString(value)
  
  if (needsLongQuotes(value)) {
    return rawTerm(`"""${escaped}"""^^<${datatype}>`)
  }

  return rawTerm(`"${escaped}"^^<${datatype}>`)
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
export function lang(value: string, tag: LanguageTag): SparqlTerm {
  validateLanguageTag(tag)
  const escaped = escapeString(value)
  
  if (needsLongQuotes(value)) {
    return rawTerm(`"""${escaped}"""@${tag.toLowerCase()}`)
  }

  return rawTerm(`"${escaped}"@${tag.toLowerCase()}`)
}

/**
 * Create an integer literal using native SPARQL syntax.
 * 
 * SPARQL treats bare integers like `42` as xsd:integer.
 * 
 * @example
 * integer(42)  // → 42
 * 
 * @throws {Error} If value is not an integer
 */
export function integer(value: number): SparqlTerm {
  if (!Number.isInteger(value)) {
    throw new Error(`Expected integer, got: ${value}`)
  }

  // Use SPARQL native integer syntax
  return rawTerm(String(value))
}

/**
 * Create a decimal literal using native SPARQL syntax.
 * 
 * SPARQL treats numbers with decimal points like `3.14` as xsd:decimal.
 * 
 * @example
 * decimal(3.14)  // → 3.14
 * decimal(42)    // → 42.0 (ensures decimal interpretation)
 * 
 * @throws {Error} If value is not finite (NaN or Infinity)
 */
export function decimal(value: number): SparqlTerm {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number, got: ${value}`)
  }

  const str = String(value)
  // Ensure decimal point for unambiguous decimal type
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return rawTerm(str + '.0')
  }
  return rawTerm(str)
}

/**
 * Create a double literal using scientific notation.
 * 
 * SPARQL treats numbers in scientific notation as xsd:double.
 * 
 * @example
 * double(42)      // → 4.2e1
 * double(3.14e10) // → 3.14e10
 * 
 * @throws {Error} If value is not an double
 */
export function double(value: number): SparqlTerm {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number, got: ${value}`)
  }
  // Scientific notation triggers xsd:double
  return rawTerm(value.toExponential())
}

/**
 * Create a numeric literal, choosing appropriate type.
 * 
 * - Integers → native integer syntax (xsd:integer)
 * - Decimals → native decimal syntax (xsd:decimal)
 * 
 * @example
 * num(42)    // → 42
 * num(3.14)  // → 3.14
 */
export function num(value: number): SparqlTerm {
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
export function boolean(value: boolean): SparqlTerm {
  return rawTerm(value ? 'true' : 'false')
}

/**
 * Short alias for {@link boolean}.
 */
export function bool(value: boolean): SparqlTerm {
  return boolean(value)
}

/**
 * Create an xsd:date literal.
 * 
 * @example
 * date(new Date('2024-01-15'))  // → "2024-01-15"^^<xsd:date>
 */
export function date(value: Date | string): SparqlTerm {
  const dateObj = value instanceof Date ? value : new Date(value)
  const yyyy = dateObj.getFullYear()
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
  const dd = String(dateObj.getDate()).padStart(2, '0')
  return rawTerm(`"${yyyy}-${mm}-${dd}"^^<http://www.w3.org/2001/XMLSchema#date>`)
}

/**
 * Create an xsd:dateTime literal.
 * 
 * @example
 * dateTime(new Date())  // → "2024-01-15T10:30:00.000Z"^^<xsd:dateTime>
 */
export function dateTime(value: Date | string): SparqlTerm {
  const dateObj = value instanceof Date ? value : new Date(value)
  return rawTerm(`"${dateObj.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`)
}

// ============================================================================
// Type Conversion (for DATA VALUES only)
// ============================================================================

/**
 * Convert a single JavaScript value into a SPARQL *term* representation.
 * 
 * This is the workhorse function that handles all type conversions. It's called
 * automatically by the sparql template tag, so you rarely need to call it directly.
 * The conversion rules match what developers expect - strings become literals,
 * numbers stay as numbers, dates get proper formatting.
 *
 * This function intentionally only supports **scalar** values (one RDF term).
 * Composite structures (arrays, objects) are handled by dedicated helpers:
 *
 * - Use `valuesList(...)`, `exprList(...)`, `rdfList(...)` for lists.
 * - Use `bnodePattern(...)` for `[ ... ]` blank node property lists.
 * 
 * ⚠️ IMPORTANT: This function is for DATA VALUES only, not SPARQL syntax.
 * Do not use this for variables, prefixes, IRIs, or other syntax elements.
 *
 * It is also used by the `sparql` template tag internally for interpolations.
 *
 * @param value  The data value to convert.
 * @param strict If true, `null`/`undefined` will throw. If false, they become
 *               `""` (empty string literal).
 *
 * @throws {Error} For `null`/`undefined` when `strict = true`.
 * @throws {Error} For non-finite numbers (NaN/Infinity).
 * @throws {Error} For arrays/objects (use list/blank-node helpers instead).
 *
 * @example Converting simple scalars
 * ```ts
 * convertValue('Peter Parker')   // => "\"Peter Parker\""
 * convertValue(18)               // => "18"
 * convertValue(true)             // => "true"
 * convertValue(new Date())       // => "\"...\"^^xsd:dateTime"
 * ```
 *
 * @example Null handling
 * ```ts
 * convertValue(null, false)      // => "\"\""
 * convertValue(undefined, false) // => "\"\""
 * convertValue(null)             // throws
 * ```
 */
export function convertValue(value: SparqlInterpolatable, strict = true): string { // Already a SPARQL value – pass straight through.
  if (isSparqlValue(value)) {
    return value.value
  }

  // Null/undefined cannot represent "unbound" – force caller to decide.
  if (value === null || value === undefined) {
    if (strict) {
      throw new Error(
        'Cannot convert null/undefined to a SPARQL term. Use OPTIONAL/BOUND or pass strict=false if you explicitly want an empty string literal.'
      )
    }
    return strlit('').value
  }

  // Scalar primitives.
  if (typeof value === 'string') {
    return strlit(value).value
  }

  if (typeof value === 'boolean') {
    return boolean(value).value
  }

  if (typeof value === 'number') {
    return num(value).value
  }

  if (value instanceof Date) {
    return dateTime(value).value
  }

  // Anything else (arrays, plain objects, etc.) is not a single term.
  if (Array.isArray(value)) {
    throw new Error(
      'Cannot convert an array directly to a SPARQL term. Use valuesList(), exprList(), or rdfList() to control how the list appears in your query.'
    )
  }

  if (typeof value === 'object') {
    throw new Error(
      'Cannot convert a plain object directly to a SPARQL term. Use bnodePattern() to create [ ... ] blank nodes, or pre-wrap it as a SparqlValue using raw().'
    )
  }

  throw new Error(
    `Cannot convert value of type "${typeof value}" to a SPARQL term`
  )
}

// ============================================================================
// List Helpers (arrays / iterables)
// ============================================================================

/**
 * Internal: check for an iterable that is *not* a string.
 */
export function isNonStringIterable(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value !== 'string' &&
    typeof (value as any)[Symbol.iterator] === 'function'
  )
}

/**
 * Create a VALUES-style list: `VALUES ?x { v1 v2 v3 }`.
 *
 * This is a generic "space-separated sequence of terms", suitable for:
 *
 * - `VALUES ?x { ${valuesList(...)} }`
 * - `VALUES (?x ?y) { (${valuesList(...)} ) ... }` (when building row fragments)
 *
 * @throws {Error} For empty iterables.
 *
 * @example Simple VALUES
 * ```ts
 * const cities = ['London', 'Paris', 'Tokyo']
 *
 * const query = sparql`
 *   SELECT * WHERE {
 *     VALUES ?city { ${valuesList(cities)} }
 *     ?place schema:name ?city .
 *   }
 * `
 * // => VALUES ?city { "London" "Paris" "Tokyo" }
 * ```
 */
export function valuesList(
  items: Iterable<SparqlInterpolatable>
): SparqlValue {
  const parts: string[] = []

  for (const item of items) {
    parts.push(convertValue(item))
  }

  if (parts.length === 0) {
    throw new Error('Cannot create VALUES list from an empty iterable')
  }

  return raw(parts.join(' '))
}

/**
 * Create a comma-separated expression list: `IN (v1, v2, v3)`.
 *
 * This is appropriate where SPARQL expects an expression list, e.g. `IN`,
 * function calls with multiple arguments, etc.
 *
 * @throws {Error} For empty iterables.
 *
 * @example IN list
 * ```ts
 * const ages = [18, 21, 25]
 *
 * const query = sparql`
 *   SELECT * WHERE {
 *     ?person schema:age ?age .
 *     FILTER(?age IN (${exprList(ages)}))
 *   }
 * `
 * // => FILTER(?age IN (18, 21, 25))
 * ```
 */
export function exprList(
  items: Iterable<SparqlInterpolatable>
): SparqlValue {
  const parts: string[] = []

  for (const item of items) {
    parts.push(convertValue(item))
  }

  if (parts.length === 0) {
    throw new Error('Cannot create expression list from an empty iterable')
  }

  return raw(parts.join(', '))
}

/**
 * Create an RDF collection: `( v1 v2 v3 )`.
 *
 * This is for canonical RDF lists, which are whitespace-separated inside
 * parentheses.
 *
 * @throws {Error} For empty iterables.
 *
 * @example RDF list
 * ```ts
 * const items = ['a', 'b', 'c']
 *
 * const query = sparql`
 *   ?list ex:hasItems ${rdfList(items)} .
 * `
 * // => ?list ex:hasItems ( "a" "b" "c" ) .
 * ```
 */
export function rdfList(
  items: Iterable<SparqlInterpolatable>
): SparqlValue {
  const parts: string[] = []

  for (const item of items) {
    parts.push(convertValue(item))
  }

  if (parts.length === 0) {
    throw new Error('Cannot create RDF list from an empty iterable')
  }

  return rawTerm(`( ${parts.join(' ')} )`)
}

// ============================================================================
// Blank Node Helpers
// ============================================================================

/**
 * Create a blank node *term*.
 *
 * - With no `id`, this represents the SPARQL `BNODE()` function, which creates
 *   a fresh blank node per evaluation.
 * - With an `id`, this creates a labeled blank node like `_:b1`.
 *
 * This represents a **node term**, not a `[ ... ]` property pattern. For
 * inline property lists, use `bnodePattern(...)` instead.
 *
 * @param id Optional blank node identifier (e.g. "b1")
 *
 * @example Generate fresh blank node with BNODE()
 * ```ts
 * bind(bnode(), 'restriction')
 * // BIND(BNODE() AS ?restriction)
 * ```
 *
 * @example Stable blank node label
 * ```ts
 * triple(bnode('b1'), 'rdf:type', 'owl:Restriction')
 * // _:b1 rdf:type owl:Restriction .
 * ```
 *
 * @example Use in CONSTRUCT
 * ```ts
 * construct(triple(bnode(), 'ex:property', '?value'))
 *   .where(triple('?s', 'ex:property', '?value'))
 * // Fresh blank nodes for each result row.
 * ```
 */
export function bnode(id?: string): SparqlTerm {
  if (id) {
    return rawTerm(`_:${id}`)
  }
  return rawTerm('[]')
}

/**
 * Property map for `bnodePattern`.
 */
export type BnodeProps = Record<string, BnodePropValue>

/**
 * Allowed values for blank node properties:
 *
 * - Single scalar term (string/number/boolean/Date/SparqlValue/null/undefined).
 * - Arrays or other iterables → become **object lists**:
 *   `predicate v1 , v2 , v3`.
 * - Nested property objects → become nested `[ ... ]` blank nodes.
 */
export type BnodePropValue =
  | SparqlInterpolatable
  | Iterable<SparqlInterpolatable>

/**
 * Internal: check for a "plain" object (not Date, not SparqlValue, etc.).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Normalise a property key into a predicate lexeme.
 *
 * Rules:
 * - `<...>` → used as-is (already an IRI).
 * - `http://...` / `https://...` → wrapped as `<...>`.
 * - Anything with `:` → treated as a prefixed name (e.g. `foaf:name`).
 * - Everything else → treated as `:${localName}` (assumes a default `:` prefix).
 */
export function toPredicateName(key: string): string {
  if (key.startsWith('<') && key.endsWith('>')) {
    return key
  }

  if (key.startsWith('http://') || key.startsWith('https://')) {
    return `<${key}>`
  }

  if (key.includes(':')) {
    return key
  }

  // `a` = `rdf:type` its a common shortcut in SPARQL
  if (key === "a") return key

  // Fallback: assume a default ":" prefix is bound.
  return `:${key}`
}

/**
 * Create an inline blank node *pattern* using the `[ ... ]` syntax.
 *
 * This is syntactic sugar for:
 *
 * ```sparql
 * [ predicate1 object1 ;
 *   predicate2 object2 , object3 ;
 *   ...
 * ]
 * ```
 *
 * Rules:
 * - Plain values (string/number/boolean/Date/etc.) become single objects:
 *   `predicate value`.
 * - Arrays / other iterables become **object lists**:
 *   `predicate v1 , v2 , v3`.
 * - Nested plain objects become **nested blank nodes**:
 *   `predicate [ ...nested props... ]`.
 *
 * @throws {Error} For empty property maps.
 * @throws {Error} If a property has an empty iterable.
 *
 * @example Simple blank node pattern
 * ```ts
 * const personPattern = bnodePattern({
 *   'foaf:name': 'Alice',
 *   'foaf:age': 30,
 * })
 *
 * const query = sparql`
 *   INSERT DATA {
 *     ?person ${personPattern} .
 *   }
 * `
 * // => ?person [ foaf:name "Alice" ; foaf:age 30 ] .
 * ```
 *
 * @example Multi-valued predicate
 * ```ts
 * const nicknames = bnodePattern({
 *   'foaf:nick': ['Peter', 'Spidey'],
 * })
 *
 * // [ foaf:nick "Peter" , "Spidey" ]
 * ```
 *
 * @example Nested blank node
 * ```ts
 * const addressPattern = bnodePattern({
 *   'schema:postalAddress': {
 *     'schema:streetAddress': '123 Main St',
 *     'schema:addressLocality': 'Metropolis',
 *   },
 * })
 *
 * // [ schema:postalAddress
 * //     [ schema:streetAddress "123 Main St" ;
 * //       schema:addressLocality "Metropolis"
 * //     ]
 * // ]
 * ```
 */
export function bnodePattern(props: BnodeProps): SparqlTerm {
  const entries = Object.entries(props)

  if (entries.length === 0) {
    throw new Error('Cannot create blank node pattern from an empty object')
  }

  const propertyFragments: string[] = []

  for (const [rawKey, rawVal] of entries) {
    const predicate = toPredicateName(rawKey)

    if (rawVal === null || rawVal === undefined) {
      throw new Error(
        `Property "${rawKey}" is null/undefined in bnodePattern(). Omit it or model absence with OPTIONAL patterns instead.`
      )
    }

    // Nested blank-node via plain object.
    if (
      isPlainObject(rawVal) &&
      !isSparqlValue(rawVal) &&
      !(rawVal instanceof Date)
    ) {
      const nested = bnodePattern(rawVal as BnodeProps)
      propertyFragments.push(`${predicate} ${nested.value}`)
      continue
    }

    // Multi-valued via iterable / array.
    if (Array.isArray(rawVal) || isNonStringIterable(rawVal)) {
      const objects: string[] = []

      for (const item of rawVal as Iterable<SparqlInterpolatable>) {
        objects.push(convertValue(item))
      }

      if (objects.length === 0) {
        throw new Error(
          `Property "${rawKey}" has an empty iterable in bnodePattern().`
        )
      }

      propertyFragments.push(`${predicate} ${objects.join(' , ')}`)
      continue
    }

    // Single scalar value.
    propertyFragments.push(
      `${predicate} ${convertValue(rawVal as SparqlInterpolatable)}`
    )
  }

  return rawTerm(`[ ${propertyFragments.join(' ; ')} ]`)
}

// ============================================================================
// Main Template Tag
// ============================================================================

/**
 * Main template tag for building SPARQL queries.
 *
 * It:
 * - Interpolates values using `convertValue` (scalars) or lets you insert
 *   richer fragments using `SparqlValue` helpers (`raw`, `valuesList`, etc.).
 * - Dedents/normalises indentation using `outdent`.
 *
 * Because `SparqlInterpolatable` deliberately excludes arrays/objects, you are
 * guided towards the explicit helpers for composite structures.
 *
 * @example Basic query with scalars
 * ```ts
 * const name = 'Peter Parker'
 * const minAge = 18
 *
 * const query = sparql`
 *   SELECT ?person WHERE {
 *     ?person foaf:name ${name} ;
 *             foaf:age ?age .
 *     FILTER(?age >= ${minAge})
 *   }
 * `
 * // ?person foaf:name "Peter Parker" ;
 * //         foaf:age ?age .
 * // FILTER(?age >= 18)
 * ```
 *
 * @example VALUES with an array (via helper)
 * ```ts
 * const cities = ['London', 'Paris', 'Tokyo']
 *
 * const query = sparql`
 *   SELECT * WHERE {
 *     VALUES ?city { ${valuesList(cities)} }
 *     ?place schema:name ?city .
 *   }
 * `
 * ```
 *
 * @example Blank-node pattern
 * ```ts
 * const person = bnodePattern({
 *   'foaf:name': 'Alice',
 *   'foaf:age': 30,
 * })
 *
 * const insert = sparql`
 *   INSERT DATA {
 *     ?person ${person} .
 *   }
 * `
 * ```
 */
export function sparql(
  strings: TemplateStringsArray,
  ...values: SparqlInterpolatable[]
): SparqlValue {
  let result = strings[0]

  for (let i = 0; i < values.length; i++) {
    const value = values[i]

    // SparqlValue fragments are injected as-is.
    if (isSparqlValue(value)) {
      result += value.value
    } else {
      // Everything else must be a scalar and go through convertValue.
      result += convertValue(value)
    }

    result += strings[i + 1]
  }

  return raw(outdent.string(result))
}

export default sparql