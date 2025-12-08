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