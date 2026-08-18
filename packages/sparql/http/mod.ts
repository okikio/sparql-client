/** SPARQL Query/Update HTTP protocol client. @module */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples } from '@okikio/rdf/ntriples'
import type { Quad } from '@okikio/rdf'
import { getQueryText, getUpdateText, type Queryable, type QueryOptionsType } from '../client.ts'
import { decodeBindings, decodeBoolean } from '../result/json.ts'
import { QueryError } from './error.ts'

/** SPARQL Query request transfer mode. */
export type QueryMethodType = 'get' | 'post-form' | 'post-direct'
/** SPARQL Update request transfer mode. */
export type UpdateMethodType = 'post-form' | 'post-direct'

/** Dataset parameters defined by the SPARQL Protocol for query operations. */
export interface QueryDatasetType {
  /** Default graph IRIs sent using the SPARQL Protocol query dataset parameters. */
  readonly defaultGraphUris?: readonly string[]
  /** Named graph IRIs sent using the SPARQL Protocol query dataset parameters. */
  readonly namedGraphUris?: readonly string[]
}

/** Dataset parameters defined by the SPARQL Protocol for update operations. */
export interface UpdateDatasetType {
  /** Default USING graph IRIs sent with a SPARQL Update request. */
  readonly usingGraphUris?: readonly string[]
  /** Named USING graph IRIs sent with a SPARQL Update request. */
  readonly usingNamedGraphUris?: readonly string[]
}

/** Per-request HTTP controls layered on top of the engine-neutral query controls. */
export interface HttpRequestOptionsType extends QueryOptionsType {
  /** HTTP encoding used for SPARQL Query requests. */
  readonly queryMethod?: QueryMethodType
  /** HTTP encoding used for SPARQL Update requests. */
  readonly updateMethod?: UpdateMethodType
  /** Default and named graph parameters attached to SPARQL Query requests. */
  readonly queryDataset?: QueryDatasetType
  /** Using-graph parameters attached to SPARQL Update requests. */
  readonly updateDataset?: UpdateDatasetType
  /** HTTP headers merged into protocol requests without mutating the caller-supplied Headers object. */
  readonly headers?: HeadersInit
}

/** SPARQL endpoint client configuration. */
export interface HttpOptionsType {
  /** SPARQL protocol endpoint used for this client operation. */
  readonly endpoint: string | URL
  /** Optional distinct endpoint used for SPARQL Update requests. */
  readonly updateEndpoint?: string | URL
  /** Caller-supplied Fetch-compatible function used for remote HTTP requests. */
  readonly fetch?: typeof fetch
  /** HTTP headers merged into protocol requests without mutating the caller-supplied Headers object. */
  readonly headers?: HeadersInit
  /** Maximum request duration in milliseconds before the operation aborts its internal request. */
  readonly timeoutMs?: number
  /** Maximum response body size accepted before the protocol client aborts decoding. */
  readonly maxResponseBytes?: number
  /** HTTP encoding used for SPARQL Query requests. */
  readonly queryMethod?: QueryMethodType
  /** HTTP encoding used for SPARQL Update requests. */
  readonly updateMethod?: UpdateMethodType
  /** Default and named graph parameters attached to SPARQL Query requests. */
  readonly queryDataset?: QueryDatasetType
  /** Using-graph parameters attached to SPARQL Update requests. */
  readonly updateDataset?: UpdateDatasetType
}

/** SPARQL HTTP client with explicit result-mode methods. */
export interface Client extends Queryable {
  /** SPARQL protocol endpoint used for this client operation. */
  readonly endpoint: URL
  /** Optional distinct endpoint used for SPARQL Update requests. */
  readonly updateEndpoint: URL
  /** Sends a SELECT-style query and returns decoded solution bindings. */
  queryBindings(
    query: Parameters<Queryable['queryBindings']>[0],
    options?: HttpRequestOptionsType,
  ): ReturnType<Queryable['queryBindings']>
  /** Sends a CONSTRUCT or DESCRIBE query and returns decoded RDF quads. */
  queryQuads(
    query: Parameters<Queryable['queryQuads']>[0],
    options?: HttpRequestOptionsType,
  ): ReturnType<Queryable['queryQuads']>
  /** Sends an ASK query and returns its Boolean result. */
  queryBoolean(
    query: Parameters<Queryable['queryBoolean']>[0],
    options?: HttpRequestOptionsType,
  ): ReturnType<Queryable['queryBoolean']>
  /** Sends a SPARQL Update request and resolves after the endpoint accepts it. */
  update(
    update: Parameters<Queryable['update']>[0],
    options?: HttpRequestOptionsType,
  ): ReturnType<Queryable['update']>
}

/** Default response-size limit used when the caller does not provide an override. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024
/** Maximum query characters retained in protocol diagnostics. */
const QUERY_PREVIEW_LENGTH = 512

/**
 * Creates an import-safe SPARQL HTTP protocol client.
 *
 * Creation only validates and stores endpoint configuration. Network work starts
 * when a query or update method is called. The caller owns any supplied `fetch`
 * implementation and abort signals.
 *
 * @example
 * ```ts
 * import * as http from '@okikio/sparql/http'
 *
 * const client = http.create({ endpoint: 'https://example.test/sparql' })
 * const exists = await client.queryBoolean('ASK { ?s ?p ?o }')
 * ```
 */
export function create(options: HttpOptionsType): Client {
  const endpoint = new URL(options.endpoint)
  const updateEndpoint = new URL(options.updateEndpoint ?? options.endpoint)
  const fetchImpl = options.fetch ?? fetch
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return {
    endpoint,
    updateEndpoint,
    /** Executes a SPARQL tuple query and decodes the JSON bindings result. */
    async queryBindings(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(
        fetchImpl,
        endpoint,
        text,
        'query',
        options,
        queryOptions,
        'application/sparql-results+json; version=1.2, application/sparql-results+json',
      )
      const bindings = decodeBindings(
        await readJson(response, maxResponseBytes, queryOptions.signal, text),
      )
      return array(bindings)
    },
    /** Executes a SPARQL ASK query and decodes the boolean result. */
    async queryBoolean(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(
        fetchImpl,
        endpoint,
        text,
        'query',
        options,
        queryOptions,
        'application/sparql-results+json; version=1.2, application/sparql-results+json',
      )
      return decodeBoolean(await readJson(response, maxResponseBytes, queryOptions.signal, text))
    },
    /** Executes a graph-producing SPARQL query and returns its RDF quad stream. */
    async queryQuads(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(
        fetchImpl,
        endpoint,
        text,
        'query',
        options,
        queryOptions,
        'application/n-quads; version=1.2, application/n-triples; version=1.2, application/n-quads, application/n-triples',
      )
      const mediaType = getMediaType(response.headers.get('content-type'))
      if (!response.body) return array<Quad>([])
      if (mediaType === 'application/n-quads') {
        return parseNQuads(
          response.body,
          queryOptions.signal ? { signal: queryOptions.signal } : {},
        )
      }
      if (mediaType === 'application/n-triples' || mediaType === 'text/plain') {
        return parseNTriples(
          response.body,
          queryOptions.signal ? { signal: queryOptions.signal } : {},
        )
      }
      await response.body.cancel().catch(() => undefined)
      throw new QueryError(
        'media',
        `Unsupported RDF graph result media type '${mediaType || 'unknown'}'.`,
        {
          mediaType,
          query: preview(text),
        },
      )
    },
    /** Sends one SPARQL Update request using the configured protocol mode. */
    async update(update, queryOptions = {}) {
      const text = getUpdateText(update)
      const response = await request(
        fetchImpl,
        updateEndpoint,
        text,
        'update',
        options,
        queryOptions,
        '*/*',
      )
      if (response.body) await response.body.cancel().catch(() => undefined)
    },
  }
}

/** Sends one SPARQL protocol request and normalizes abort, timeout, network, and HTTP failures. */
async function request(
  fetchImpl: typeof fetch,
  endpoint: URL,
  text: string,
  operation: 'query' | 'update',
  client: HttpOptionsType,
  options: HttpRequestOptionsType,
  accept: string,
): Promise<Response> {
  const timeout = options.timeoutMs === null ? 0 : options.timeoutMs ?? client.timeoutMs ?? 0
  const signal = getSignal(options.signal, timeout)
  const headers = new Headers(client.headers)
  for (const [key, value] of new Headers(options.headers)) headers.set(key, value)
  headers.set('accept', accept)
  const target = new URL(endpoint)
  const init = operation === 'query'
    ? queryRequest(
      target,
      text,
      options.queryMethod ?? client.queryMethod ?? 'post-direct',
      options.queryDataset ?? client.queryDataset,
      headers,
    )
    : updateRequest(
      target,
      text,
      options.updateMethod ?? client.updateMethod ?? 'post-direct',
      options.updateDataset ?? client.updateDataset,
      headers,
    )

  let response: Response
  try {
    response = await fetchImpl(target, { ...init, ...(signal ? { signal } : {}) })
  } catch (error) {
    if (signal?.aborted) {
      const timedOut = timeout > 0 && !options.signal?.aborted
      throw new QueryError(
        timedOut ? 'timeout' : 'abort',
        timedOut ? `SPARQL request timed out after ${timeout}ms.` : 'SPARQL request was aborted.',
        {
          query: preview(text),
          cause: error,
        },
      )
    }
    throw new QueryError(
      'network',
      'SPARQL endpoint request failed before a response was received.',
      {
        query: preview(text),
        cause: error,
      },
    )
  }

  if (!response.ok) {
    const responseText = await readText(
      response,
      Math.min(client.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 16 * 1024),
      signal,
    )
    throw new QueryError(
      'http',
      `SPARQL endpoint returned HTTP ${response.status} ${response.statusText}.`,
      {
        status: response.status,
        query: preview(text),
        response: responseText,
      },
    )
  }
  return response
}

/** Builds one SPARQL Query request using a standards-defined transfer mode. */
function queryRequest(
  url: URL,
  text: string,
  method: QueryMethodType,
  dataset: QueryDatasetType | undefined,
  headers: Headers,
): RequestInit {
  const params = new URLSearchParams()
  addQueryDataset(params, dataset)
  if (method === 'get') {
    params.append('query', text)
    append(url, params)
    return { method: 'GET', headers }
  }
  if (method === 'post-form') {
    params.append('query', text)
    headers.set('content-type', 'application/x-www-form-urlencoded; charset=utf-8')
    return { method: 'POST', headers, body: params }
  }
  addQueryDataset(url.searchParams, dataset)
  headers.set('content-type', 'application/sparql-query; charset=utf-8')
  return { method: 'POST', headers, body: text }
}

/** Builds one SPARQL Update request using a standards-defined transfer mode. */
function updateRequest(
  url: URL,
  text: string,
  method: UpdateMethodType,
  dataset: UpdateDatasetType | undefined,
  headers: Headers,
): RequestInit {
  const params = new URLSearchParams()
  addUpdateDataset(params, dataset)
  if (method === 'post-form') {
    params.append('update', text)
    headers.set('content-type', 'application/x-www-form-urlencoded; charset=utf-8')
    return { method: 'POST', headers, body: params }
  }
  addUpdateDataset(url.searchParams, dataset)
  headers.set('content-type', 'application/sparql-update; charset=utf-8')
  return { method: 'POST', headers, body: text }
}

/** Adds SPARQL Query dataset parameters to the request URL or form body. */
function addQueryDataset(params: URLSearchParams, value?: QueryDatasetType): void {
  for (const iri of value?.defaultGraphUris ?? []) params.append('default-graph-uri', iri)
  for (const iri of value?.namedGraphUris ?? []) params.append('named-graph-uri', iri)
}

/** Adds SPARQL Update USING dataset parameters to the request form body. */
function addUpdateDataset(params: URLSearchParams, value?: UpdateDatasetType): void {
  for (const iri of value?.usingGraphUris ?? []) params.append('using-graph-uri', iri)
  for (const iri of value?.usingNamedGraphUris ?? []) params.append('using-named-graph-uri', iri)
}

/** Appends one encoded protocol field without replacing earlier repeated values. */
function append(url: URL, params: URLSearchParams): void {
  for (const [key, value] of params) url.searchParams.append(key, value)
}

/** Reads a bounded HTTP response body and decodes it as JSON. */
async function readJson(
  response: Response,
  limit: number,
  signal: AbortSignal | undefined,
  query: string,
): Promise<unknown> {
  const mediaType = getMediaType(response.headers.get('content-type'))
  if (
    mediaType !== 'application/sparql-results+json' && mediaType !== 'application/json' &&
    mediaType !== ''
  ) {
    if (response.body) await response.body.cancel().catch(() => undefined)
    throw new QueryError('media', `Expected SPARQL JSON results but received '${mediaType}'.`, {
      mediaType,
      query: preview(query),
    })
  }
  const text = await readText(response, limit, signal)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new QueryError('protocol', 'SPARQL endpoint returned malformed JSON results.', {
      query: preview(query),
      response: text.slice(0, 1024),
      cause: error,
    })
  }
}

/** Reads a bounded HTTP response body as UTF-8 text. */
async function readText(response: Response, limit: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let complete = false
  try {
    while (true) {
      const item = await readBody(reader, signal)
      if (item.done) {
        complete = true
        break
      }
      bytes += item.value.byteLength
      if (bytes > limit) {
        await reader.cancel('SPARQL response size limit exceeded').catch(() => undefined)
        throw new QueryError('limit', `SPARQL response exceeded ${limit} bytes.`)
      }
      text += decoder.decode(item.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    if (!complete) {
      await reader.cancel('SPARQL response consumption stopped before completion').catch(() =>
        undefined
      )
    }
    reader.releaseLock()
  }
}

/** Reads one chunk from the response stream while preserving cancellation. */
function readBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read()
  if (signal.aborted) {
    void reader.cancel(signal.reason).catch(() => undefined)
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      if (settled) return
      settled = true
      finish()
      void reader.cancel(signal.reason).catch(() => undefined)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then((value) => {
      if (!settled) {
        settled = true
        finish()
        resolve(value)
      }
    }, (error) => {
      if (!settled) {
        settled = true
        finish()
        reject(error)
      }
    })
  })
}

/** Returns the caller signal or a timeout-linked signal for the current request. */
function getSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal && timeout) return AbortSignal.any([signal, timeout])
  return signal ?? timeout
}

/** Returns the normalized response media type without parameters. */
function getMediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

/** Returns a bounded query preview suitable for diagnostics. */
function preview(query: string): string {
  return query.length <= QUERY_PREVIEW_LENGTH ? query : `${query.slice(0, QUERY_PREVIEW_LENGTH)}…`
}

/** Normalizes a scalar-or-array input into a readonly array. */
async function* array<T>(values: readonly T[]): AsyncGenerator<T> {
  yield* values
}

export { QueryError } from './error.ts'
export type { QueryErrorKindType } from './error.ts'
