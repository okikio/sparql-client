// executor.ts

import sparql, {
  raw,
  uri,
  type SparqlValue,
} from './sparql.ts'
import {
  XSD,
  RDF,
  RDFS,
  FOAF,
  SCHEMA,
} from './namespaces.ts'

/**
 * Raw SPARQL JSON binding value.
 *
 * Mirrors the SPARQL 1.1 JSON Results format.
 */
export interface BindingValue {
  type: 'uri' | 'literal' | 'bnode'
  value: string
  'xml:lang'?: string
  datatype?: string
}

/**
 * Map of variable name → binding.
 *
 * Keys are variable names **without** the leading `?`.
 */
export type BindingMap = Record<string, BindingValue>

/**
 * Standard SPARQL JSON result shape.
 *
 * - `head.vars` lists variable names.
 * - `results.bindings` holds rows.
 * - `boolean` is present for ASK queries.
 */
export interface QueryResult<TBind extends BindingMap = BindingMap> {
  head: {
    vars: string[]
  }
  results: {
    bindings: TBind[]
  }
  /**
   * Present for ASK queries.
   */
  boolean?: boolean
}

/* ============================================================================
 * Error types
 * ========================================================================== */

export type QueryErrorKind =
  | 'http'      // non-2xx HTTP status
  | 'timeout'   // request hit a client-side timeout
  | 'abort'     // caller-provided signal aborted the request
  | 'network'   // fetch never got a response (DNS, connection reset, etc.)
  | 'protocol'  // endpoint returned non-JSON / wrong shape when JSON expected
  | 'unknown'   // anything else unexpected

/**
 * Rich error type for SPARQL execution.
 *
 * Everything in here is designed to be safe to log and inspect.
 */
export class QueryError extends Error {
  readonly kind: QueryErrorKind
  readonly status?: number
  readonly responseBody?: unknown
  readonly query: string

  constructor(init: {
    message: string
    kind: QueryErrorKind
    query: string | SparqlValue
    status?: number
    responseBody?: unknown
    cause?: unknown
  }) {
    super(init.message)
    this.name = 'QueryError'
    this.kind = init.kind
    this.status = init.status
    this.responseBody = init.responseBody
    this.query = typeof init.query === 'string' ? init.query : init.query.value
    this.cause = init.cause
  }
}

/** Type guard for handling timeouts specifically. */
export function isTimeoutError(error: unknown): error is QueryError & { kind: 'timeout' } {
  return error instanceof QueryError && error.kind === 'timeout'
}

/** Type guard for user aborts (external AbortSignal). */
export function isAbortError(error: unknown): error is QueryError & { kind: 'abort' } {
  return error instanceof QueryError && error.kind === 'abort'
}

/* ============================================================================
 * Config + low-level execution
 * ========================================================================== */

/**
 * Shared configuration for an executor.
 */
export interface ExecutionConfig {
  /** SPARQL endpoint URL. */
  endpoint: string
  /**
   * Optional fetch implementation (Deno, browser, node-fetch, etc.).
   * Defaults to the global `fetch`.
   */
  fetch?: typeof fetch
  /** Extra headers for every request (auth, tenant, etc.). */
  headers?: HeadersInit
  /**
   * Default timeout in milliseconds for all requests from this executor.
   * - `undefined` / `0` = no default timeout
   */
  timeoutMs?: number
}

/**
 * Per-call options for executing a query.
 *
 * You can override the default timeout, and/or pass an `AbortSignal`.
 */
export interface RequestOptions {
  /**
   * Timeout in milliseconds.
   * - `undefined` → falls back to `ExecutionConfig.timeoutMs`
   * - `0` or `null` → disable timeout for this call
   */
  timeoutMs?: number | null

  /**
   * Optional AbortSignal to cancel the request from the outside.
   *
   * Example:
   * ```ts
   * const controller = new AbortController()
   * const promise = executor.query(query, { signal: controller.signal })
   * controller.abort()
   * ```
   */
  signal?: AbortSignal
}

/**
 * Execute a SPARQL query (SELECT / CONSTRUCT / ASK / UPDATE) against an endpoint.
 *
 * This is the lowest-level building block. Higher-level helpers (builder, update,
 * executor) all use this under the hood.
 *
 * @param config Endpoint + HTTP settings
 * @param query  Text SPARQL or a `SparqlValue` (tagged template / builder output)
 */
export async function executeSparql<T = unknown>(
  config: ExecutionConfig,
  query: string | SparqlValue,
  options: RequestOptions = {},
): Promise<T> {
  const {
    endpoint,
    fetch: fetchImpl = fetch,
    headers,
    timeoutMs: defaultTimeout,
  } = config

  const queryText = typeof query === 'string' ? query : query.value
  const effectiveTimeout =
    options.timeoutMs === null
      ? 0
      : options.timeoutMs ?? defaultTimeout ?? 0

  let controller: AbortController | undefined
  let signal: AbortSignal | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let abortedByUser = false

  // Combine timeout + user AbortSignal into a single signal for fetch.
  if (effectiveTimeout > 0 || options.signal) {
    controller = new AbortController()
    signal = controller.signal

    if (effectiveTimeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller!.abort()
      }, effectiveTimeout)
    }

    if (options.signal) {
      if (options.signal.aborted) {
        abortedByUser = true
        controller.abort(options.signal.reason)
      } else {
        options.signal.addEventListener(
          'abort',
          () => {
            abortedByUser = true
            controller!.abort(options.signal?.reason)
          },
          { once: true },
        )
      }
    }
  } else {
    signal = options.signal
  }

  let response: Response

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query; charset=utf-8',
        Accept: 'application/sparql-results+json, application/json',
        ...headers,
      },
      body: queryText,
      signal,
    })
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)

    // Abort / timeout cases – runtime-dependent, so we detect conservatively.
    if (
      err instanceof DOMException ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      if (timedOut) {
        throw new QueryError({
          kind: 'timeout',
          message: `SPARQL request timed out after ${effectiveTimeout}ms`,
          query,
          cause: err,
        })
      }
      if (abortedByUser) {
        throw new QueryError({
          kind: 'abort',
          message: 'SPARQL request was aborted by caller',
          query,
          cause: err,
        })
      }
      throw new QueryError({
        kind: 'network',
        message: 'SPARQL request was aborted or failed before a response was received',
        query,
        cause: err,
      })
    }

    // Typical "cannot fetch" in many environments.
    if (err instanceof TypeError) {
      throw new QueryError({
        kind: 'network',
        message: `Network error while calling SPARQL endpoint: ${err.message}`,
        query,
        cause: err,
      })
    }

    throw new QueryError({
      kind: 'unknown',
      message: 'Unexpected error while calling SPARQL endpoint',
      query,
      cause: err,
    })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  const text = await response.text()

  if (!response.ok) {
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // ignore – keep raw text
    }

    // Treat all non-2xx as HTTP-level failures; the caller can inspect status.
    throw new QueryError({
      kind: 'http',
      message: `SPARQL HTTP ${response.status} ${response.statusText}`,
      status: response.status,
      responseBody: body,
      query,
    })
  }

  // Successful (2xx) with no body – quite common for UPDATEs.
  if (!text) {
    return undefined as T
  }

  // Many endpoints return JSON for SELECT/ASK and raw RDF for CONSTRUCT/DESCRIBE.
  // We try JSON first; if that fails, return raw text.
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new QueryError({
      kind: 'protocol',
      message: 'Expected SPARQL JSON results but endpoint returned non-JSON response',
      status: response.status,
      responseBody: text,
      query,
      cause: err,
    })
  }
}

/* ============================================================================
 * High-level Executor
 * ========================================================================== */

/**
 * High-level executor interface returned by {@link createExecutor}.
 *
 * This is the "one stop shop" you hand to your application code:
 *
 * - `execute` → raw JSON result
 * - `query`   → SELECT/DESCRIBE/CONSTRUCT with typed bindings
 * - `ask`     → boolean ASK queries
 * - `update`  → SPARQL UPDATE (INSERT / DELETE / LOAD / CLEAR / etc.)
 * - `resolveLabels` → best-effort human label for URIs
 * - `fetchProperties` → property map for URIs
 * - `expand` → fuse labels + properties into a single enriched view
 */
export interface Executor {
  /** Low-level "give me the raw SPARQL JSON result" call. */
  execute<TBind extends BindingMap = BindingMap>(
    query: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<QueryResult<TBind>>

  /** SELECT / DESCRIBE / CONSTRUCT helper returning coerced rows. */
  query<TBind extends BindingMap = BindingMap>(
    query: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<Array<{ [K in keyof TBind]: unknown }>>

  /** ASK helper – returns the boolean. */
  ask(
    query: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<boolean>

  /** SPARQL UPDATE – throws on error, otherwise resolves to void. */
  update(
    query: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<void>

  /** Resolve human-readable labels for URIs. */
  resolveLabels(
    uris: string[],
    config?: LabelResolutionConfig,
  ): Promise<Record<string, string>>

  /** Fetch selected properties for URIs. */
  fetchProperties(
    uris: string[],
    config: PropertyFetchConfig,
  ): Promise<Record<string, Record<string, unknown>>>

  /** Merge labels + properties into a richer representation. */
  expand(
    uris: string[],
    config?: ExpandConfig,
  ): Promise<ExpandResult[]>
}

/** Internal helper type for passing `execute` into helpers. */
type ExecuteFn = <TBind extends BindingMap = BindingMap>(
  query: string | SparqlValue,
  options?: RequestOptions,
) => Promise<QueryResult<TBind>>

/**
 * Create an {@link Executor} bound to a specific SPARQL endpoint.
 *
 * @example Simple usage
 * ```ts
 * const executor = createExecutor({ endpoint: 'https://dbpedia.org/sparql' })
 *
 * const rows = await executor.query<{ name: BindingValue }>(
 *   `SELECT ?name WHERE { dbr:Toronto foaf:name ?name } LIMIT 10`
 * )
 *
 * console.log(rows[0].name) // "Toronto" (after coercion)
 * ```
 */
export function createExecutor(config: ExecutionConfig): Executor {
  /**
   * Core execution that always returns SPARQL JSON shape. This is the one
   * everything else builds upon.
   */
  async function execute<TBind extends BindingMap = BindingMap>(
    query: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<QueryResult<TBind>> {
    const json = await executeSparql<QueryResult<TBind>>(config, query, options)

    // For ASK, some endpoints still embed results in this structure, others
    // return { boolean }. We try to normalize here.

    // When the endpoint is properly configured, we should get JSON with
    // { head, results } for SELECT and { boolean } for ASK.
    if (
      !json ||
      typeof json !== 'object' ||
      !('results' in json) ||
      !('head' in json)
    ) {
      throw new QueryError({
        kind: 'protocol',
        message: 'SPARQL endpoint returned JSON that does not match SPARQL Results format',
        query,
        responseBody: json,
      })
    }

    return json
  }

  /**
   * SELECT / DESCRIBE / CONSTRUCT helper that:
   * - runs the query
   * - coerces literals into JS types
   * - returns an array of rows
   */
  async function query<TBind extends BindingMap = BindingMap>(
    q: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<Array<{ [K in keyof TBind]: unknown }>> {
    const result = await execute<TBind>(q, options)
    return transformResults(result)
  }

  /**
   * ASK helper – returns the boolean or `false` if the server didn't provide it.
   */
  async function ask(
    q: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<boolean> {
    const result = await execute(q, options)
    return Boolean(result.boolean)
  }

  /**
   * SPARQL UPDATE helper – we treat it as fire-and-forget.
   * Any HTTP/protocol error will throw via `executeSparql`.
   */
  async function update(
    q: string | SparqlValue,
    options?: RequestOptions,
  ): Promise<void> {
    // For UPDATE, we just care that it doesn't throw.
    await executeSparql(config, q, options)
  }

  const execFn: ExecuteFn = execute

  return {
    execute,
    query,
    ask,
    update,
    resolveLabels: (uris, cfg) => resolveLabels(uris, cfg, execFn),
    fetchProperties: (uris, cfg) => fetchProperties(uris, cfg, execFn),
    expand: (uris, cfg) => expand(uris, cfg, execFn),
  }
}

/* ============================================================================
 * Result transformation + coercion
 * ========================================================================== */

/**
 * Transform SPARQL JSON into a more ergonomic JS representation.
 *
 * - Literals are coerced using {@link coerceValue}
 * - URIs stay as strings
 * - Blank nodes stay as strings (bnode IDs)
 */
export function transformResults<TBind extends BindingMap = BindingMap>(
  result: QueryResult<TBind>,
): Array<{ [K in keyof TBind]: unknown }> {
  return result.results.bindings.map((binding) => parseBinding(binding))
}

/**
 * Parse a single binding map into a JS row.
 *
 * Keys are variable names (without `?`) and values are coerced via
 * {@link coerceValue}.
 */
export function parseBinding<TBind extends BindingMap = BindingMap>(
  binding: TBind,
): { [K in keyof TBind]: unknown } {
  const row: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(binding)) {
    row[key] = coerceValue(value)
  }

  return row as { [K in keyof TBind]: unknown }
}

/* ============================================================================
 * Datatype Coercion
 * ========================================================================== */

/**
 * Expanded set of integer-like XSD datatypes.
 *
 * All of these are represented as `number` in JS.
 */
const INTEGER_DATATYPES = new Set<string>([
  XSD.integer,
  XSD.long,
  XSD.int,
  XSD.short,
  XSD.byte,
  XSD.nonNegativeInteger,
  XSD.nonPositiveInteger,
  XSD.positiveInteger,
  XSD.negativeInteger,
  XSD.unsignedLong,
  XSD.unsignedInt,
  XSD.unsignedShort,
  XSD.unsignedByte,
])

/**
 * Decimal / floating-point XSD datatypes.
 *
 * All of these are represented as `number` in JS.
 */
const DECIMAL_DATATYPES = new Set<string>([
  XSD.decimal,
  XSD.float,
  XSD.double,
])

/**
 * Datetime-like XSD datatypes that should be parsed as JS `Date`.
 *
 * We attempt `Date.parse` and fall back to the original string on failure.
 */
const DATETIME_DATATYPES = new Set<string>([
  XSD.dateTime,
  XSD.dateTimeStamp,
])

/**
 * Date-only XSD datatypes. These are still parsed as full JS `Date`
 * (midnight UTC or local, depending on environment).
 */
const DATE_DATATYPES = new Set<string>([
  XSD.date,
])

/**
 * Time-only datatypes (stored as `Date` as well, for now).
 */
const TIME_DATATYPES = new Set<string>([
  XSD.time,
])

/**
 * Coerce a SPARQL JSON binding value into a more natural JS type.
 *
 * - URIs → string
 * - `xsd:boolean` → boolean
 * - integer-like → number
 * - decimal / float / double → number
 * - date / dateTime / dateTimeStamp / time → Date
 * - `rdf:JSON` → parsed JSON (with safe fallback)
 * - everything else → string (original literal value)
 *
 * We deliberately stay conservative for exotic datatypes: if we don't have
 * a clear, widely-understood JS representation, we keep the raw string.
 */
export function coerceValue(bindingValue: BindingValue): unknown {
  const { type, value, datatype } = bindingValue

  // URIs are already natural strings.
  if (type === 'uri') {
    return value
  }

  // Typed literals: try to interpret known datatypes.
  if (datatype) {
    // Integers
    if (datatype === XSD.boolean) {
      return value === 'true' || value === '1'
    }

    // Integers
    if (INTEGER_DATATYPES.has(datatype)) {
      const n = Number.parseInt(value, 10)
      return Number.isNaN(n) ? value : n
    }

    // Decimals / floats / doubles
    if (DECIMAL_DATATYPES.has(datatype)) {
      const n = Number.parseFloat(value)
      return Number.isNaN(n) ? value : n
    }

    // Dates / times
    if (
      DATETIME_DATATYPES.has(datatype) ||
      DATE_DATATYPES.has(datatype) ||
      TIME_DATATYPES.has(datatype)
    ) {
      const ts = Date.parse(value)
      return Number.isNaN(ts) ? value : new Date(ts)
    }

    // RDF JSON literal – use the constant if present in your RDF namespace.
    if ((RDF as Record<string, string>).JSON && datatype === (RDF as Record<string, string>).JSON) {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }

    // AnyURI is already a string representation; keep as-is.
    if (datatype === XSD.anyURI) {
      return value
    }

    // For everything else (HTML, XMLLiteral, gYear, durations, etc.)
    // we fall through and return the raw string.

  }

  // Untyped literals or unsupported datatypes: keep as string.
  return value
}

/* ============================================================================
 * Convenience helpers
 * ========================================================================== */

/**
 * Pluck a single column from result rows.
 *
 * @example Get list of names
 * ```ts
 * const rows = await executor.query<{ name: BindingValue }>(...)
 * const names = pluck(rows, 'name') // string[]
 * ```
 */
export function pluck<T extends Record<string, unknown>, K extends keyof T>(
  rows: T[],
  key: K,
): Array<T[K]> {
  return rows.map((row) => row[key])
}

/**
 * Get the first row (or `undefined`).
 *
 * @example
 * ```ts
 * const rows = await executor.query(...)
 * const firstRow = first(rows)
 * ```
 */
export function first<T>(rows: T[]): T | undefined {
  return rows[0]
}

/* ============================================================================
 * Label resolution
 * ========================================================================== */

/**
 * Default label predicates when resolving human-friendly names.
 *
 * Order matters – we stop at the first non-empty value:
 * 1. `rdfs:label`
 * 2. `foaf:name`
 * 3. `schema:name`
 * 4. `schema:alternateName`
 */
const DEFAULT_LABEL_PREDICATES: readonly string[] = [
  RDFS.label,
  FOAF.name,
  SCHEMA.name,
  SCHEMA.alternateName,
]

/**
 * Configuration for {@link resolveLabels}.
 */
export interface LabelResolutionConfig {
  /**
   * Predicates to try (in order of preference).
   *
   * Defaults to {@link DEFAULT_LABEL_PREDICATES}.
   */
  labelPredicates?: string[]

  /**
   * Batch size for VALUES clause when resolving many URIs.
   *
   * Defaults to 50.
   */
  batchSize?: number
}

/**
 * Resolve best-effort labels for a list of URIs.
 *
 * This is intentionally:
 * - **best-effort** (if no label exists, URI won't be in the result)
 * - **batch-friendly** (uses VALUES to resolve many URIs at once)
 *
 * Uses the `sparql\`...\`` tag internally for safer query construction.
 */
export async function resolveLabels(
  uris: string[],
  config: LabelResolutionConfig | undefined,
  execute: ExecuteFn,
): Promise<Record<string, string>> {
  if (uris.length === 0) return {}

  const labelPredicates =
    config?.labelPredicates && config.labelPredicates.length > 0
      ? config.labelPredicates
      : [...DEFAULT_LABEL_PREDICATES]

  const batchSize = config?.batchSize ?? 50
  const result: Record<string, string> = {}

  const labelVarNames = labelPredicates.map((_, index) => `label${index}`)
  const labelVarList = labelVarNames.map((v) => `?${v}`).join(' ')

  for (let i = 0; i < uris.length; i += batchSize) {
    const batch = uris.slice(i, i + batchSize)

    const optionalPatterns = labelPredicates
      .map((predicate, index) => {
        const varName = labelVarNames[index]
        return `OPTIONAL { ?uri <${predicate}> ?${varName} }`
      })
      .join('\n')

    const query = sparql`
      SELECT ?uri ${raw(labelVarList)} WHERE {
        VALUES ?uri { ${batch.map((u) => uri(u))} }
        ${raw(optionalPatterns)}
      }
    `

    const response = await execute(query)

    for (const binding of response.results.bindings) {
      const uriValue = binding.uri?.value
      if (!uriValue) continue

      const label =
        labelVarNames
          .map((v) => binding[v]?.value)
          .find((v) => v !== undefined && v !== '')

      if (label) {
        result[uriValue] = label
      }
    }
  }

  return result
}

/* ============================================================================
 * Property fetch
 * ========================================================================== */


/**
 * Configuration for {@link fetchProperties}.
 */
export interface PropertyFetchConfig {
  /**
   * List of properties to fetch.
   *
   * `property` can be:
   * - full IRI (`http://example.org/name`)
   * - prefixed name (`schema:name`)
   * - variable (`?property`) – in which case you control the pattern in your query
   *
   * `propertyName` controls the key used in the returned object. Defaults to
   * the property string itself.
   */
  properties: Array<{
    property: string
    propertyName?: string
  }>

  /**
   * Batch size for VALUES clause when fetching many URIs.
   *
   * Defaults to 50.
   */
  batchSize?: number
}

/**
 * Fetch selected properties for each URI.
 *
 * Returns a nested map:
 *
 * ```ts
 * {
 *   "http://example.org/resource/1": {
 *     name: "Example",
 *     createdAt: Date,
 *   },
 *   ...
 * }
 * ```
 */
export async function fetchProperties(
  uris: string[],
  config: PropertyFetchConfig,
  execute: ExecuteFn,
): Promise<Record<string, Record<string, unknown>>> {
  if (uris.length === 0) return {}
  const requestedProperties = config.properties ?? []
  if (requestedProperties.length === 0) return {}

  const batchSize = config.batchSize ?? 50
  const result: Record<string, Record<string, unknown>> = {}

  const propertyVarNames = requestedProperties.map((_, index) => `p${index}`)
  const propertyVarList = propertyVarNames.map((v) => `?${v}`).join(' ')

  for (let i = 0; i < uris.length; i += batchSize) {
    const batch = uris.slice(i, i + batchSize)

    const optionalPatterns = requestedProperties
      .map((prop, index) => {
        let propertyExpr = prop.property

        if (!propertyExpr.startsWith('?')) {
          if (!propertyExpr.includes(':') && !propertyExpr.startsWith('<')) {
            propertyExpr = `<${propertyExpr}>`
          }
        }

        const varName = propertyVarNames[index]
        return `OPTIONAL { ?uri ${propertyExpr} ?${varName} }`
      })
      .join('\n')

    const query = sparql`
      SELECT ?uri ${raw(propertyVarList)} WHERE {
        VALUES ?uri { ${batch.map((u) => uri(u))} }
        ${raw(optionalPatterns)}
      }
    `

    const response = await execute(query)

    for (const binding of response.results.bindings) {
      const uriValue = binding.uri?.value
      if (!uriValue) continue

      const entry = (result[uriValue] ??= {})

      requestedProperties.forEach((prop, index) => {
        const varName = propertyVarNames[index]
        const bindingValue = binding[varName]
        if (!bindingValue) return

        const key = prop.propertyName ?? prop.property
        entry[key] = coerceValue(bindingValue)
      })
    }
  }

  return result
}

/* ============================================================================
 * Expand (labels + properties)
 * ========================================================================== */

/**
 * Result of {@link expand}.
 *
 * Each expanded item includes:
 * - `uri` – the original resource URI
 * - `label` – resolved human label (if any)
 * - `properties` – fetched properties keyed by name
 */
export interface ExpandResult {
  uri: string
  label?: string
  properties: Record<string, unknown>
}

/**
 * How to handle the base URI list when some URIs have no data.
 */
export type ExpandMode =
  | 'all' // include all URIs passed in
  | 'withData' // only URIs that have label or properties

/**
 * Configuration for {@link expand}.
 */
export interface ExpandConfig {
  labels?: LabelResolutionConfig
  properties?: PropertyFetchConfig
  /**
   * Whether to return entries for URIs that have no label and no properties.
   *
   * - `'all'` (default) – keep them with empty properties and no label
   * - `'withData'`      – filter out completely
   */
  mode?: ExpandMode
}

/**
 * Expand URIs into richer objects with:
 *
 * - a human-friendly `label` (using {@link resolveLabels})
 * - selected `properties` (using {@link fetchProperties})
 *
 * @example Basic expansion
 * ```ts
 * const expanded = await executor.expand(
 *   [
 *     'http://knowledge.graph/narrative#Product/123',
 *     'http://knowledge.graph/narrative#Product/456',
 *   ],
 *   {
 *     properties: {
 *       properties: [
 *         { property: 'schema:releaseDate', propertyName: 'releaseDate' },
 *         { property: 'schema:isbn', propertyName: 'isbn' },
 *       ],
 *     },
 *   },
 * )
 *
 * // → [{ uri, label, properties: { releaseDate: Date, isbn: string } }, ...]
 * ```
 */
export async function expand(
  uris: string[],
  config: ExpandConfig | undefined,
  execute: ExecuteFn,
): Promise<ExpandResult[]> {
  if (uris.length === 0) return []

  const mode: ExpandMode = config?.mode ?? 'all'

  const [labels, props] = await Promise.all([
    resolveLabels(uris, config?.labels, execute),
    config?.properties
      ? fetchProperties(uris, config.properties, execute)
      : Promise.resolve<Record<string, Record<string, unknown>>>({}),
  ])

  const results: ExpandResult[] = []

  for (const uriValue of uris) {
    const label = labels[uriValue]
    const properties = props[uriValue] ?? {}

    const hasData =
      typeof label === 'string' || Object.keys(properties).length > 0

    if (mode === 'withData' && !hasData) {
      continue
    }

    results.push({
      uri: uriValue,
      label,
      properties,
    })
  }

  return results
}
