/**
 * SPARQL query execution with type-safe error handling.
 * 
 * Executing SPARQL queries involves network requests that can fail in many ways - timeouts,
 * bad syntax, server errors, or network issues. This module provides discriminated error
 * types so you can handle each failure mode appropriately.
 * 
 * The result is always a discriminated union: either success with data, or failure with
 * a specific error type. This forces you to handle errors explicitly rather than letting
 * exceptions bubble up unexpectedly.
 * 
 * Think of this as a type-safe fetch for SPARQL. It handles the HTTP details, parses
 * responses, and gives you structured errors when things go wrong.
 * 
 * @module
 */

import type { SparqlValue } from './sparql.ts'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for SPARQL endpoint connections.
 * 
 * At minimum you need the endpoint URL. Optionally specify timeout and custom
 * headers for authentication or other purposes.
 */
export interface ExecutorConfig {
  /** SPARQL endpoint URL (e.g., http://localhost:9999/sparql) */
  readonly endpoint: string
  /** Query timeout in milliseconds (default: 30000) */
  readonly timeout?: number
  /** Additional headers for requests (auth, etc.) */
  readonly headers?: Record<string, string>
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Specific error type discriminants.
 * 
 * Each error type represents a different failure mode:
 * - syntax: Your SPARQL query has invalid syntax (400 response)
 * - timeout: Query took too long and was aborted
 * - unavailable: Can't connect to endpoint (network error or 503)
 * - database: Server had an internal error (5xx responses)
 * - unknown: Something unexpected happened
 */
export type SparqlErrorType = 'syntax' | 'timeout' | 'unavailable' | 'database' | 'unknown'

/**
 * Structured error information.
 * 
 * Provides context about what went wrong. The type discriminant tells you what
 * kind of error it is, and the details provide additional context.
 */
export interface SparqlError {
  readonly type: SparqlErrorType
  readonly message: string
  readonly statusCode?: number
  readonly details?: unknown
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Raw binding value from SPARQL results.
 * 
 * This is what the SPARQL endpoint returns for each bound variable. It includes
 * type information so you know whether it's an IRI, literal, or blank node.
 */
export interface SparqlBinding {
  readonly type: string
  readonly value: string
  readonly 'xml:lang'?: string
  readonly datatype?: string
}

/**
 * Raw SPARQL JSON results format.
 * 
 * This follows the SPARQL 1.1 Query Results JSON Format specification. Each
 * result row is an object mapping variable names to bindings.
 */
export interface SparqlResponse {
  readonly results: {
    readonly bindings: ReadonlyArray<Record<string, SparqlBinding>>
  }
}

/**
 * Successful query result.
 * 
 * When a query succeeds, you get this. The data is in standard SPARQL JSON
 * format. You can transform it with the helper functions or process it directly.
 */
export interface SparqlSuccess {
  readonly success: true
  readonly data: SparqlResponse
}

/**
 * Failed query result.
 * 
 * When a query fails, you get structured error information. Check the error
 * type to determine how to handle it.
 */
export interface SparqlFailure {
  readonly success: false
  readonly error: SparqlError
}

/**
 * Discriminated union of query results.
 * 
 * Every query execution returns this type. You check the `success` field to
 * determine which variant you have, then TypeScript narrows the type appropriately.
 * 
 * @example Handling results
 * ```ts
 * const result = await execute(query, config)
 * 
 * if (result.success) {
 *   // result.data is available
 *   console.log(result.data.results.bindings)
 * } else {
 *   // result.error is available
 *   console.error(result.error.type, result.error.message)
 * }
 * ```
 */
export type SparqlResult = SparqlSuccess | SparqlFailure

// ============================================================================
// Core Execution
// ============================================================================

/**
 * Execute a SPARQL query against an endpoint.
 * 
 * Sends the query via HTTP POST and handles the response. Network errors,
 * timeouts, and HTTP errors are all converted to structured error types.
 * 
 * The function follows SPARQL 1.1 Protocol conventions:
 * - POST request with Content-Type: application/sparql-query
 * - Accept: application/sparql-results+json
 * - 400 responses indicate syntax errors
 * - 5xx responses indicate server errors
 * 
 * @param config Endpoint configuration
 * @param query Query to execute
 * @param overrides Optional per-query config overrides
 * @returns Discriminated result union
 * 
 * @example Basic execution
 * ```ts
 * const result = await executeSparql(
 *   { endpoint: 'http://localhost:9999/sparql' },
 *   sparql`SELECT * WHERE { ?s ?p ?o } LIMIT 10`
 * )
 * 
 * if (result.success) {
 *   console.log(result.data)
 * } else {
 *   console.error(result.error.type, result.error.message)
 * }
 * ```
 * 
 * @example With overrides
 * ```ts
 * const result = await executeSparql(
 *   { endpoint: 'http://localhost:9999/sparql', timeout: 30000 },
 *   query,
 *   { timeout: 60000 } // Use longer timeout for this query
 * )
 * ```
 */
export async function executeSparql(
  config: ExecutorConfig,
  query: SparqlValue | string,
  overrides?: Partial<ExecutorConfig>
): Promise<SparqlResult> {
  const endpoint = overrides?.endpoint ?? config.endpoint
  const timeout = overrides?.timeout ?? config.timeout ?? 30000
  const headers = { ...config.headers, ...overrides?.headers }

  // Extract query string
  const queryString = typeof query === 'string'
    ? query
    : query.value

  // Setup timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json',
        ...headers,
      },
      body: queryString,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Handle HTTP errors
    if (!response.ok) {
      const text = await response.text()

      // 400 = Invalid SPARQL syntax (per SPARQL 1.1 Protocol)
      if (response.status === 400) {
        return {
          success: false,
          error: {
            type: 'syntax',
            message: `Invalid SPARQL syntax: ${text}`,
            statusCode: response.status,
            details: text,
          },
        }
      }

      // 503 = Service unavailable
      if (response.status === 503) {
        return {
          success: false,
          error: {
            type: 'unavailable',
            message: `SPARQL endpoint unavailable: ${text}`,
            statusCode: response.status,
            details: text,
          },
        }
      }

      // 5xx = Database error
      if (response.status >= 500) {
        return {
          success: false,
          error: {
            type: 'database',
            message: `Database error: ${text}`,
            statusCode: response.status,
            details: text,
          },
        }
      }

      // Other errors
      return {
        success: false,
        error: {
          type: 'unknown',
          message: `HTTP error ${response.status}: ${text}`,
          statusCode: response.status,
          details: text,
        },
      }
    }

    // Parse successful response
    const data = await response.json() as SparqlResponse

    return {
      success: true,
      data,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    // Timeout error (AbortError)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: {
          type: 'timeout',
          message: `Query timeout after ${timeout}ms`,
          details: error,
        },
      }
    }

    // Network error (TypeError - cannot connect)
    if (error instanceof TypeError) {
      return {
        success: false,
        error: {
          type: 'unavailable',
          message: `Cannot connect to SPARQL endpoint: ${error.message}`,
          details: error,
        },
      }
    }

    // Unknown error
    return {
      success: false,
      error: {
        type: 'unknown',
        message: error instanceof Error ? error.message : String(error),
        details: error,
      },
    }
  }
}

/**
 * Create an executor function with pre-configured settings.
 * 
 * This is useful when you have a fixed endpoint and want to execute multiple
 * queries without repeating the configuration. The returned function can still
 * accept overrides for individual queries.
 * 
 * @param config Default executor configuration
 * @returns Executor function
 * 
 * @example Create reusable executor
 * ```ts
 * const execute = createExecutor({
 *   endpoint: 'http://localhost:9999/sparql',
 *   timeout: 30000,
 *   headers: { 'Authorization': 'Bearer token123' }
 * })
 * 
 * // Use it for multiple queries
 * const result1 = await execute(query1)
 * const result2 = await execute(query2)
 * const result3 = await execute(query3, { timeout: 60000 }) // Override for one query
 * ```
 */
export function createExecutor(config: ExecutorConfig): (
  query: SparqlValue | string,
  overrides?: Partial<ExecutorConfig>
) => Promise<SparqlResult> {
  return (
    query: SparqlValue | string,
    overrides?: Partial<ExecutorConfig>
  ): Promise<SparqlResult> => {
    return executeSparql(config, query, overrides)
  }
}

// ============================================================================
// Result Transformation
// ============================================================================

/**
 * Transform SPARQL bindings to simple key-value objects.
 * 
 * The raw SPARQL response format includes type information for each value.
 * Often you just want the values themselves. This helper strips the metadata
 * and gives you plain objects.
 * 
 * @param response SPARQL response data
 * @returns Array of simple objects
 * 
 * @example
 * ```ts
 * const result = await execute(query, config)
 * if (result.success) {
 *   const rows = transformResults(result.data)
 *   // [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]
 *   
 *   for (const row of rows) {
 *     console.log(row.name, row.age)
 *   }
 * }
 * ```
 */
export function transformResults(response: SparqlResponse): Array<Record<string, string>> {
  return response.results.bindings.map((binding) => {
    const row: Record<string, string> = {}
    for (const [key, value] of Object.entries(binding)) {
      row[key] = value.value
    }
    return row
  })
}

/**
 * Extract all URIs from query results.
 * 
 * Finds every URI value in the results and returns them as a deduplicated list.
 * Useful when you need to do something with all the resources mentioned in
 * your results.
 * 
 * @param response SPARQL response data
 * @returns Array of unique URIs
 * 
 * @example
 * ```ts
 * const result = await execute(query, config)
 * if (result.success) {
 *   const uris = extractUris(result.data)
 *   // ['http://example.org/person/1', 'http://example.org/person/2', ...]
 * }
 * ```
 */
export function extractUris(response: SparqlResponse): string[] {
  const uris = new Set<string>()

  for (const binding of response.results.bindings) {
    for (const value of Object.values(binding)) {
      if (value.type === 'uri') {
        uris.add(value.value)
      }
    }
  }

  return Array.from(uris)
}

// ============================================================================
// Label Resolution
// ============================================================================

/**
 * Configuration for resolving human-readable labels.
 * 
 * Often you have URIs but want to display friendly names. Label resolution
 * queries the graph for label properties and returns a map of URIs to labels.
 */
export interface LabelResolutionConfig {
  /** URIs to resolve labels for */
  readonly uris: string[]
  /** Label predicates to query (defaults to common label properties) */
  readonly labelPredicates?: string[]
  /** Maximum URIs per batch query (default: 50) */
  readonly maxBatchSize?: number
}

/**
 * Default label predicates in priority order.
 * 
 * When resolving labels, we check these properties in order. This includes
 * domain-specific labels followed by common vocabularies.
 */
const DEFAULT_LABEL_PREDICATES = [
  'http://knowledge.graph/narrative#characterName',
  'http://knowledge.graph/narrative#seriesName',
  'http://knowledge.graph/narrative#productTitle',
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://schema.org/name',
  'http://xmlns.com/foaf/0.1/name',
]

/**
 * Resolve human-readable labels for URIs.
 * 
 * Queries the graph for label properties on the specified URIs. Returns a map
 * where each URI gets an array of labels (there can be multiple if different
 * properties have values).
 * 
 * Processes URIs in batches to avoid overwhelming the endpoint with huge queries.
 * 
 * @param config Executor configuration
 * @param options Label resolution options
 * @returns Map of URI to array of labels
 * 
 * @example
 * ```ts
 * const uris = extractUris(queryResult.data)
 * const labels = await resolveLabels(config, { uris })
 * 
 * for (const uri of uris) {
 *   const uriLabels = labels.get(uri)
 *   console.log(uri, uriLabels?.[0] ?? 'No label')
 * }
 * ```
 */
export async function resolveLabels(
  config: ExecutorConfig,
  options: LabelResolutionConfig
): Promise<Map<string, string[]>> {
  const { uris, labelPredicates = DEFAULT_LABEL_PREDICATES, maxBatchSize = 50 } = options
  const labelMap = new Map<string, string[]>()

  // Process in batches
  for (let i = 0; i < uris.length; i += maxBatchSize) {
    const batch = uris.slice(i, i + maxBatchSize)
    const uriValues = batch.map((uri) => `<${uri}>`).join(' ')
    const predicateValues = labelPredicates.map((p) => `<${p}>`).join(' ')

    const query = `
      SELECT ?uri ?label WHERE {
        VALUES ?uri { ${uriValues} }
        VALUES ?predicate { ${predicateValues} }
        ?uri ?predicate ?label .
      }
    `

    const result = await executeSparql(config, query)

    if (result.success) {
      for (const binding of result.data.results.bindings) {
        const uri = binding.uri.value
        const label = binding.label.value

        if (!labelMap.has(uri)) {
          labelMap.set(uri, [])
        }
        labelMap.get(uri)!.push(label)
      }
    }
  }

  return labelMap
}

/**
 * Get the first label for a URI, with fallback.
 * 
 * Returns the first label if available, otherwise extracts a reasonable name
 * from the URI itself (fragment or last path segment).
 * 
 * @param labels Label map from resolveLabels
 * @param uri URI to get label for
 * @returns First label or URI fragment
 * 
 * @example
 * ```ts
 * const labels = await resolveLabels(config, { uris })
 * 
 * for (const uri of uris) {
 *   const label = getFirstLabel(labels, uri) ?? uri
 *   console.log(label)
 * }
 * ```
 */
export function getFirstLabel(labels: Map<string, string[]>, uri: string): string | undefined {
  const uriLabels = labels.get(uri)
  if (uriLabels && uriLabels.length > 0) {
    return uriLabels[0]
  }

  // Fallback to URI fragment or last path segment
  const fragment = uri.split('#').pop() || uri.split('/').pop()
  return fragment && fragment !== uri ? fragment : undefined
}

// ============================================================================
// Property Fetching
// ============================================================================

/**
 * Configuration for fetching all properties of resources.
 */
export interface PropertyFetchConfig {
  /** URIs to fetch properties for */
  readonly uris: string[]
  /** Maximum URIs per batch query (default: 50) */
  readonly maxBatchSize?: number
}

/**
 * Fetch all properties for specified URIs.
 * 
 * Queries the graph for all triples where these URIs are the subject. Returns
 * a nested map structure: URI → predicate → array of values.
 * 
 * This is useful when you need to inspect resources in detail or build entity
 * detail views.
 * 
 * @param config Executor configuration
 * @param options Property fetch options
 * @returns Map of URI to map of predicate to array of values
 * 
 * @example
 * ```ts
 * const uris = ['http://example.org/person/1']
 * const properties = await fetchProperties(config, { uris })
 * 
 * const person = properties.get(uris[0])
 * const names = person?.get('http://xmlns.com/foaf/0.1/name')
 * console.log(names?.[0]) // First name value
 * ```
 */
export async function fetchProperties(
  config: ExecutorConfig,
  options: PropertyFetchConfig
): Promise<Map<string, Map<string, string[]>>> {
  const { uris, maxBatchSize = 50 } = options
  const propertyMap = new Map<string, Map<string, string[]>>()

  // Process in batches
  for (let i = 0; i < uris.length; i += maxBatchSize) {
    const batch = uris.slice(i, i + maxBatchSize)
    const uriValues = batch.map((uri) => `<${uri}>`).join(' ')

    const query = `
      SELECT ?uri ?predicate ?value WHERE {
        VALUES ?uri { ${uriValues} }
        ?uri ?predicate ?value .
      }
    `

    const result = await executeSparql(config, query)

    if (result.success) {
      for (const binding of result.data.results.bindings) {
        const uri = binding.uri.value
        const predicate = binding.predicate.value
        const value = binding.value.value

        if (!propertyMap.has(uri)) {
          propertyMap.set(uri, new Map())
        }

        const uriProps = propertyMap.get(uri)!
        if (!uriProps.has(predicate)) {
          uriProps.set(predicate, [])
        }

        uriProps.get(predicate)!.push(value)
      }
    }
  }

  return propertyMap
}

// ============================================================================
// Enhanced Result Parsing
// ============================================================================

/**
 * Parsed SPARQL binding with type information preserved.
 * 
 * **Common use case:** When you need to know not just the value, but also what
 * *kind* of value it is - whether it's a URI, a typed literal, or has a language tag.
 * 
 * **How it works:** SPARQL results include metadata about each value. This interface
 * structures that metadata in an easy-to-use format while preserving all the
 * type information the endpoint provided.
 */
export interface ParsedValue {
  /** The actual value as a string */
  readonly raw: string
  /** What kind of RDF term this is */
  readonly type: 'uri' | 'literal' | 'bnode'
  /** Datatype IRI for typed literals (e.g., xsd:integer) */
  readonly datatype?: string
  /** Language tag for language-tagged strings (e.g., "en", "fr") */
  readonly language?: string
}

/**
 * Parse a SPARQL binding while preserving all type metadata.
 * 
 * **Common use case:** When you need to inspect the type information of a result,
 * such as checking if a value is a URI vs a literal, or what datatype it has.
 * 
 * **How it works:** Converts the raw SPARQL JSON binding format into a cleaner
 * TypeScript interface. All the information is preserved, just in a more
 * convenient structure.
 * 
 * @param binding - Raw SPARQL binding from query results
 * @returns Parsed value with type information
 * 
 * @example Inspect value types
 * ```ts
 * const result = await query.execute(config)
 * if (result.success) {
 *   for (const row of result.data.results.bindings) {
 *     const parsed = parseBinding(row.value)
 *     
 *     if (parsed.type === 'uri') {
 *       console.log('IRI:', parsed.raw)
 *     } else if (parsed.datatype === 'http://www.w3.org/2001/XMLSchema#integer') {
 *       console.log('Integer:', parsed.raw)
 *     } else if (parsed.language) {
 *       console.log(`Text in ${parsed.language}:`, parsed.raw)
 *     }
 *   }
 * }
 * ```
 */
export function parseBinding(binding: SparqlBinding): ParsedValue {
  return {
    raw: binding.value,
    type: binding.type as 'uri' | 'literal' | 'bnode',
    datatype: binding.datatype,
    language: binding['xml:lang'],
  }
}

/**
 * Convert SPARQL typed literals to native JavaScript types.
 * 
 * **Common use case:** Working with numeric data, dates, or booleans where you want
 * actual JavaScript types instead of strings. Makes it easier to do calculations,
 * comparisons, and date manipulation.
 * 
 * **How it works:** Reads the XSD datatype from the binding and converts the string
 * value to the corresponding JavaScript type. Falls back to returning the string if
 * the datatype isn't recognized.
 * 
 * **Important:** This only works for bindings with XSD datatypes. Language-tagged
 * strings and plain literals return as-is. URIs are never coerced.
 * 
 * **Performance note:** Type conversion happens for every value. For large result
 * sets where you don't need type conversion, use `transformResults()` instead.
 * 
 * @param binding - SPARQL binding to convert
 * @returns Native JavaScript value (number, boolean, Date, or string)
 * 
 * @example Working with numeric data
 * ```ts
 * const result = await select(['?age', '?price'])
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .where(triple('?person', 'schema:price', '?price'))
 *   .execute(config)
 * 
 * if (result.success) {
 *   for (const row of result.data.results.bindings) {
 *     const age = coerceValue(row.age)    // number
 *     const price = coerceValue(row.price) // number
 *     
 *     if (typeof age === 'number') {
 *       console.log('Person is', age, 'years old')
 *     }
 *   }
 * }
 * ```
 * 
 * @example Date handling
 * ```ts
 * // Query returns xsd:dateTime literals
 * const binding = row.timestamp
 * const date = coerceValue(binding)  // Date object
 * 
 * if (date instanceof Date) {
 *   console.log('Event happened:', date.toLocaleDateString())
 * }
 * ```
 * 
 * @example Supported type conversions
 * ```ts
 * // xsd:integer, xsd:int, xsd:long → number (parsed as integer)
 * // xsd:decimal, xsd:float, xsd:double → number (parsed as float)
 * // xsd:boolean → boolean (true/false)
 * // xsd:date, xsd:dateTime → Date object
 * // Anything else → string (unchanged)
 * ```
 */
export function coerceValue(binding: SparqlBinding): string | number | boolean | Date {
  const { value, datatype } = binding

  if (!datatype) return value

  // Integer types
  if (
    datatype === 'http://www.w3.org/2001/XMLSchema#integer' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#int' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#long' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#short' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#byte'
  ) {
    return parseInt(value, 10)
  }

  // Decimal/float types
  if (
    datatype === 'http://www.w3.org/2001/XMLSchema#decimal' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#float' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#double'
  ) {
    return parseFloat(value)
  }

  // Boolean
  if (datatype === 'http://www.w3.org/2001/XMLSchema#boolean') {
    return value === 'true' || value === '1'
  }

  // Date/time types
  if (
    datatype === 'http://www.w3.org/2001/XMLSchema#date' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#dateTime' ||
    datatype === 'http://www.w3.org/2001/XMLSchema#time'
  ) {
    return new Date(value)
  }

  // Unknown datatype - return as string
  return value
}

/**
 * Transform SPARQL results with automatic type coercion.
 * 
 * **Common use case:** When you want to work with properly typed data instead of
 * everything being strings. Particularly useful for numeric calculations, date
 * comparisons, or boolean logic.
 * 
 * **How it works:** Like `transformResults()`, but runs `coerceValue()` on every
 * binding to convert typed literals to JavaScript types. Numbers become numbers,
 * booleans become booleans, dates become Date objects.
 * 
 * **Performance tradeoff:** Slightly slower than `transformResults()` due to type
 * checking and conversion. For very large result sets, only use this if you actually
 * need the type conversion.
 * 
 * @param response - SPARQL response data
 * @returns Array of objects with native JavaScript types
 * 
 * @example Numeric calculations
 * ```ts
 * const result = await select(['?product', '?price', '?quantity'])
 *   .where(triple('?product', 'schema:price', '?price'))
 *   .where(triple('?product', 'schema:quantity', '?quantity'))
 *   .execute(config)
 * 
 * if (result.success) {
 *   const rows = transformResultsTyped(result.data)
 *   
 *   for (const row of rows) {
 *     // price and quantity are numbers, not strings
 *     const total = row.price * row.quantity
 *     console.log(`Total value: $${total.toFixed(2)}`)
 *   }
 * }
 * ```
 * 
 * @example Date filtering
 * ```ts
 * const rows = transformResultsTyped(result.data)
 * const recentEvents = rows.filter(row => {
 *   // timestamp is a Date object
 *   return row.timestamp instanceof Date && 
 *          row.timestamp > new Date('2024-01-01')
 * })
 * ```
 * 
 * @example Type checking
 * ```ts
 * const rows = transformResultsTyped(result.data)
 * for (const row of rows) {
 *   if (typeof row.age === 'number') {
 *     console.log('Age:', row.age)
 *   }
 *   if (typeof row.active === 'boolean') {
 *     console.log('Active:', row.active)
 *   }
 *   if (row.created instanceof Date) {
 *     console.log('Created:', row.created.toISOString())
 *   }
 * }
 * ```
 */
export function transformResultsTyped(
  response: SparqlResponse
): Array<Record<string, string | number | boolean | Date>> {
  return response.results.bindings.map((binding) => {
    const row: Record<string, string | number | boolean | Date> = {}
    for (const [key, value] of Object.entries(binding)) {
      row[key] = coerceValue(value)
    }
    return row
  })
}

/**
 * Extract values for a specific variable from query results.
 * 
 * **Common use case:** When you only care about one column from your results.
 * Perfect for building lists, checking for existence, or collecting IDs.
 * 
 * **How it works:** Walks through all result rows, extracts the specified variable,
 * and returns just those values as an array. Optionally applies type coercion.
 * 
 * **Filtering behavior:** Rows where the variable is unbound (undefined) are
 * automatically filtered out. This is useful when using OPTIONAL patterns.
 * 
 * @param response - SPARQL response data
 * @param variable - Variable name to extract (without the ? prefix)
 * @param coerce - Whether to apply type coercion (default: false)
 * @returns Array of values for that variable
 * 
 * @example Get list of names
 * ```ts
 * const result = await select(['?name', '?age'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:age', '?age'))
 *   .execute(config)
 * 
 * if (result.success) {
 *   const names = pluck(result.data, 'name')
 *   // ['Alice', 'Bob', 'Charlie']
 *   
 *   console.log('Found', names.length, 'people')
 *   names.forEach(name => console.log(name))
 * }
 * ```
 * 
 * @example With type coercion
 * ```ts
 * const ages = pluck<number>(result.data, 'age', true)
 * // [25, 30, 42] as numbers, not strings
 * 
 * const averageAge = ages.reduce((a, b) => a + b, 0) / ages.length
 * console.log('Average age:', averageAge)
 * ```
 * 
 * @example Collect URIs for further processing
 * ```ts
 * const productURIs = pluck(result.data, 'product')
 * const labels = await resolveLabels(config, { uris: productURIs })
 * ```
 * 
 * @example With OPTIONAL patterns (undefined filtering)
 * ```ts
 * // Some people have emails, some don't
 * select(['?name', '?email'])
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .optional(triple('?person', 'foaf:mbox', '?email'))
 * 
 * const emails = pluck(result.data, 'email')
 * // Only includes rows where email was bound
 * ```
 */
export function pluck<T = string>(
  response: SparqlResponse,
  variable: string,
  coerce = false
): T[] {
  return response.results.bindings
    .filter((b) => variable in b)
    .map((b) => (coerce ? coerceValue(b[variable]) : b[variable].value) as T)
}

/**
 * Get the first result row, or undefined if no results.
 * 
 * **Common use case:** Queries where you expect exactly one result (or zero) and
 * don't want to write array access logic. Perfect for lookups, existence checks,
 * or queries with LIMIT 1.
 * 
 * **How it works:** Returns the first row transformed to a simple object, or
 * undefined if the result set is empty. No type coercion is applied - use
 * `transformResultsTyped()` first if you need that.
 * 
 * **Safety note:** Returns `undefined` rather than throwing on empty results,
 * so you can safely use optional chaining or nullish coalescing.
 * 
 * @param response - SPARQL response data
 * @returns First result row or undefined
 * 
 * @example Lookup by unique identifier
 * ```ts
 * const result = await select(['?name', '?email'])
 *   .where(triple('?person', 'foaf:accountName', 'alice'))
 *   .where(triple('?person', 'foaf:name', '?name'))
 *   .where(triple('?person', 'foaf:mbox', '?email'))
 *   .limit(1)
 *   .execute(config)
 * 
 * if (result.success) {
 *   const person = first(result.data)
 *   
 *   if (person) {
 *     console.log('Found:', person.name)
 *     console.log('Email:', person.email)
 *   } else {
 *     console.log('No person found with that username')
 *   }
 * }
 * ```
 * 
 * @example With optional chaining
 * ```ts
 * const person = first(result.data)
 * const email = person?.email ?? 'No email'
 * console.log(email)
 * ```
 * 
 * @example Existence check
 * ```ts
 * const exists = first(result.data) !== undefined
 * if (exists) {
 *   console.log('Record found')
 * }
 * ```
 * 
 * @example Safe destructuring
 * ```ts
 * const row = first(result.data)
 * if (!row) {
 *   console.error('Query returned no results')
 *   return
 * }
 * 
 * // TypeScript knows row is defined here
 * const { name, age } = row
 * console.log(name, age)
 * ```
 */
export function first(response: SparqlResponse): Record<string, string> | undefined {
  const bindings = response.results.bindings
  return bindings.length > 0 ? transformResults(response)[0] : undefined
}

/**
 * Check if an ASK query returned true.
 * 
 * **Common use case:** ASK queries return a different response format than SELECT
 * queries. This helper makes it easy to extract the boolean result.
 * 
 * **How it works:** ASK query responses have a `boolean` field instead of result
 * bindings. This function safely extracts that boolean, defaulting to false if
 * the format is unexpected.
 * 
 * **Type safety note:** The response parameter is `unknown` because ASK and SELECT
 * have different response formats. This function handles the type check internally.
 * 
 * @param response - Raw response from ASK query
 * @returns True if pattern exists, false otherwise
 * 
 * @example Basic existence check
 * ```ts
 * const result = await ask()
 *   .where(triple('?person', 'foaf:name', 'Alice'))
 *   .execute(config)
 * 
 * if (result.success) {
 *   const exists = askResult(result.data)
 *   console.log('Alice exists:', exists)
 * }
 * ```
 * 
 * @example Conditional logic
 * ```ts
 * const hasAdults = askResult(
 *   await ask()
 *     .where(triple('?person', 'foaf:age', '?age'))
 *     .filter(v('age').gte(18))
 *     .execute(config)
 *     .then(r => r.success ? r.data : { boolean: false })
 * )
 * 
 * if (hasAdults) {
 *   console.log('Dataset contains adults')
 * }
 * ```
 * 
 * @example Validation check
 * ```ts
 * async function validatePerson(id: string): Promise<boolean> {
 *   const result = await ask()
 *     .where(triple(`<${id}>`, RDF.type, uri(FOAF.Person)))
 *     .execute(config)
 *   
 *   return result.success && askResult(result.data)
 * }
 * 
 * const isValid = await validatePerson('http://example.org/person/123')
 * ```
 */
export function askResult(response: unknown): boolean {
  return (response as { boolean?: boolean }).boolean ?? false
}