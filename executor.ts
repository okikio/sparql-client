/**
 * Functional SPARQL executor with discriminated union error handling
 * 
 * Provides:
 * - Type-safe query execution
 * - Discriminated error types
 * - Result transformation utilities
 * - Label resolution for human-readable output
 * - Property fetching for entity details
 */

import type { SparqlValue } from './sparql.ts'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * SPARQL endpoint configuration
 */
export interface ExecutorConfig {
  /** SPARQL endpoint URL */
  readonly endpoint: string
  /** Query timeout in milliseconds (default: 30000) */
  readonly timeout?: number
  /** Additional headers to send with requests */
  readonly headers?: Record<string, string>
}

// ============================================================================
// Error Types (Discriminated Union)
// ============================================================================

/**
 * SPARQL error type discriminant
 * 
 * - syntax: Malformed SPARQL query (400)
 * - timeout: Query execution timeout (AbortError)
 * - unavailable: Cannot connect to endpoint (TypeError)
 * - database: Database returned 5xx error
 * - unknown: Unexpected error
 */
export type SparqlErrorType = 'syntax' | 'timeout' | 'unavailable' | 'database' | 'unknown'

/**
 * SPARQL error details
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
 * Raw SPARQL binding value
 */
export interface SparqlBinding {
  readonly type: string
  readonly value: string
  readonly 'xml:lang'?: string
  readonly datatype?: string
}

/**
 * Raw SPARQL query response
 */
export interface SparqlResponse {
  readonly results: {
    readonly bindings: ReadonlyArray<Record<string, SparqlBinding>>
  }
}

/**
 * Successful query result
 */
export interface SparqlSuccess {
  readonly success: true
  readonly data: SparqlResponse
}

/**
 * Failed query result
 */
export interface SparqlFailure {
  readonly success: false
  readonly error: SparqlError
}

/**
 * Discriminated union of query results
 */
export type SparqlResult = SparqlSuccess | SparqlFailure

// ============================================================================
// Core Execution
// ============================================================================

/**
 * Execute SPARQL query against endpoint
 * 
 * @param config Executor configuration
 * @param query Query to execute (SparqlValue or string)
 * @param overrides Optional config overrides for this query
 * @returns Discriminated union result
 * 
 * @example
 * ```ts
 * const result = await executeSparql(
 *   { endpoint: 'http://localhost:9999/blazegraph/sparql' },
 *   sparql`SELECT * WHERE { ?s ?p ?o } LIMIT 10`
 * );
 * 
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error.type, result.error.message);
 * }
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

  // Create abort controller for timeout
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
 * Create executor function with pre-configured settings
 * 
 * @param config Default executor configuration
 * @returns Executor function
 * 
 * @example
 * ```ts
 * const execute = createExecutor({
 *   endpoint: 'http://localhost:9999/blazegraph/sparql',
 *   timeout: 30000
 * });
 * 
 * const result = await execute(sparql`SELECT * WHERE { ?s ?p ?o } LIMIT 10`);
 * ```
 */
export function createExecutor(config: ExecutorConfig) {
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
 * Transform SPARQL bindings to simple key-value objects
 * 
 * @param response SPARQL response data
 * @returns Array of simple objects
 * 
 * @example
 * ```ts
 * const rows = transformResults(result.data);
 * // [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]
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
 * Extract all URIs from results
 * 
 * @param response SPARQL response data
 * @returns Array of unique URIs
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
 * Label resolution configuration
 */
export interface LabelResolutionConfig {
  /** URIs to resolve labels for */
  readonly uris: string[]
  /** Label predicates to query (default: narrative predicates + common ones) */
  readonly labelPredicates?: string[]
  /** Maximum URIs per batch query (default: 50) */
  readonly maxBatchSize?: number
}

/**
 * Default label predicates (priority order)
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
 * Resolve labels for URIs
 * 
 * @param config Executor configuration
 * @param options Label resolution options
 * @returns Map of URI → array of labels
 * 
 * @example
 * ```ts
 * const labels = await resolveLabels(config, {
 *   uris: ['http://example.org/person/1', 'http://example.org/person/2']
 * });
 * // Map { 'http://example.org/person/1' => ['Alice', 'Alice Smith'], ... }
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
 * Get first label for URI (or fallback to URI fragment/path)
 * 
 * @param labels Label map from resolveLabels
 * @param uri URI to get label for
 * @returns First label or URI fragment
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
 * Property fetching configuration
 */
export interface PropertyFetchConfig {
  /** URIs to fetch properties for */
  readonly uris: string[]
  /** Maximum URIs per batch query (default: 50) */
  readonly maxBatchSize?: number
}

/**
 * Fetch all properties for URIs
 * 
 * @param config Executor configuration
 * @param options Property fetch options
 * @returns Map of URI → Map of predicate → array of values
 * 
 * @example
 * ```ts
 * const properties = await fetchProperties(config, {
 *   uris: ['http://example.org/person/1']
 * });
 * // Map { 'http://example.org/person/1' => Map { 'foaf:name' => ['Alice'], ... } }
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
