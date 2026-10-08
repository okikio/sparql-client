import { pending } from '@okikio/rdf/stream'
import { acquire, result } from '../result/stream.ts'
/** SPARQL Query/Update HTTP protocol client. @module */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples } from '@okikio/rdf/ntriples'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import type { BlankNode, Quad } from '@okikio/rdf'
import { getQueryText, getUpdateText, type Queryable, type QueryOptionsType } from '../client.ts'
import { decodeBindings, decodeBoolean } from '../result/json.ts'
import { relabel } from '../result/graph.ts'
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
  /** Request deadline in whole milliseconds, 0 to 2^31-1; zero disables the deadline. */
  readonly timeoutMs?: number
  /** Positive safe-integer byte limit accepted before the protocol client aborts decoding. */
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
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new RangeError('maxResponseBytes must be a positive safe integer.')
  }
  deadline(options.timeoutMs ?? 0)

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
      const value = await readJson(response, maxResponseBytes)
      try {
        return result(
          decodeBindings(value),
          queryOptions.signal ? { signal: queryOptions.signal } : {},
        )
      } catch (cause) {
        throw new QueryError('protocol', 'SPARQL endpoint returned invalid bindings results.', {
          query: preview(text),
          cause,
        })
      }
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
      const value = await readJson(response, maxResponseBytes)
      try {
        return decodeBoolean(value)
      } catch (cause) {
        throw new QueryError('protocol', 'SPARQL endpoint returned invalid boolean results.', {
          query: preview(text),
          cause,
        })
      }
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
        'application/n-quads; version=1.2, application/n-triples; version=1.2, application/n-quads, application/n-triples, text/turtle',
      )
      const mediaType = getMediaType(response.response.headers.get('content-type'))
      if (!response.response.body) return result<Quad>([])
      if (
        mediaType !== 'application/n-quads' && mediaType !== 'application/n-triples' &&
        mediaType !== 'text/plain' && mediaType !== 'text/turtle'
      ) {
        void response.response.body.cancel().catch(() => undefined)
        throw new QueryError(
          'media',
          `Unsupported RDF graph result media type '${mediaType || 'unknown'}'.`,
          { mediaType, query: preview(text) },
        )
      }
      const lifecycle = new AbortController()
      const signal = response.signal
        ? AbortSignal.any([response.signal, lifecycle.signal])
        : lifecycle.signal
      const context = { ...response, signal }
      const owned = limitBody(response.response.body, maxResponseBytes, context)
      const body = owned.stream
      const source = mediaType === 'application/n-quads'
        ? parseNQuads(body, { signal })
        : mediaType === 'text/turtle'
        ? parseTurtle(body, { signal, baseIri: response.url })
        : parseNTriples(body, { signal })
      return result(graph(source, context), {
        signal,
        release(reason) {
          lifecycle.abort(reason)
          return owned.stop(reason)
        },
      })
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
      if (response.response.body) void response.response.body.cancel().catch(() => undefined)
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
): Promise<ResponseType> {
  const timeout = options.timeoutMs === null ? 0 : options.timeoutMs ?? client.timeoutMs ?? 0
  const signal = getSignal(options.signal, timeout)
  const context: RequestType = {
    query: text,
    timeoutMs: timeout,
    ...(signal ? { signal } : {}),
    ...(options.signal ? { callerSignal: options.signal } : {}),
  }
  if (signal?.aborted) throw abortError(context, signal.reason)
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
    response = await acquire(
      () => fetchImpl(target, { ...init, ...(signal ? { signal } : {}) }),
      (value, reason) => value.body?.cancel(reason),
      signal,
      options.onCleanup,
    )
  } catch (error) {
    if (signal?.aborted) throw abortError(context, error)
    throw new QueryError(
      'network',
      'SPARQL endpoint request failed before a response was received.',
      { query: preview(text), cause: error },
    )
  }

  if (!response.ok) {
    const responseText = await readText(
      response,
      Math.min(client.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 16 * 1024),
      context,
      true,
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
  return { response, url: response.url || target.href, ...context }
}

/** Request-scoped signal and timeout metadata retained through response-body consumption. */
interface RequestType {
  /** Original query/update text used only for bounded diagnostics. */
  readonly query: string
  /** Effective caller/timeout signal used for fetch and body reads. */
  readonly signal?: AbortSignal
  /** Caller-owned signal, used to distinguish an explicit abort from the internal timeout. */
  readonly callerSignal?: AbortSignal
  /** Effective timeout in milliseconds, or zero when disabled. */
  readonly timeoutMs: number
}

/** Successful HTTP response plus the request lifetime that remains authoritative while its body is read. */
interface ResponseType extends RequestType {
  /** Actual retrieval identity, including redirects; injected fetch falls back to the request target. */
  readonly url: string
  /** Fetch response whose body is still governed by the combined request signal. */
  readonly response: Response
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
async function readJson(response: ResponseType, limit: number): Promise<unknown> {
  const mediaType = getMediaType(response.response.headers.get('content-type'))
  if (
    mediaType !== 'application/sparql-results+json' && mediaType !== 'application/json' &&
    mediaType !== ''
  ) {
    if (response.response.body) void response.response.body.cancel().catch(() => undefined)
    throw new QueryError('media', `Expected SPARQL JSON results but received '${mediaType}'.`, {
      mediaType,
      query: preview(response.query),
    })
  }
  const text = await readText(response.response, limit, response)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new QueryError('protocol', 'SPARQL endpoint returned malformed JSON results.', {
      query: preview(response.query),
      response: text.slice(0, 1024),
      cause: error,
    })
  }
}

/** Reads a bounded HTTP response body as UTF-8 text. */
async function readText(
  response: Response,
  limit: number,
  request?: RequestType,
  previewOnly = false,
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  // A replacement character would change a successful RDF term's identity.
  // Error previews are diagnostic text and may be cut inside a UTF-8 sequence.
  const decoder = new TextDecoder('utf-8', { fatal: !previewOnly })
  const decode = (value?: Uint8Array, stream = false): string => {
    try {
      return decoder.decode(value, { stream })
    } catch (cause) {
      throw new QueryError('protocol', 'SPARQL endpoint returned malformed UTF-8.', { cause })
    }
  }
  let bytes = 0
  let text = ''
  let complete = false
  try {
    while (true) {
      const item = await readBody(reader, request?.signal)
      if (item.done) {
        complete = true
        break
      }
      const remaining = limit - bytes
      bytes += item.value.byteLength
      if (bytes > limit || (previewOnly && bytes === limit)) {
        if (previewOnly) return text + decode(item.value.subarray(0, remaining))
        throw new QueryError('limit', `SPARQL response exceeded ${limit} bytes.`)
      }
      text += decode(item.value, true)
    }
    return text + decode()
  } catch (error) {
    if (request?.signal?.aborted) throw abortError(request, error)
    if (error instanceof QueryError) throw error
    throw new QueryError('network', 'SPARQL response transfer failed before completion.', {
      ...(request ? { query: preview(request.query) } : {}),
      cause: error,
    })
  } finally {
    if (!complete) {
      void reader.cancel(
        request?.signal?.aborted
          ? request.signal.reason
          : 'SPARQL response consumption stopped before completion',
      ).catch(() => undefined)
    }
    reader.releaseLock()
  }
}

/** Owns the acquired body reader before a result is ever iterated. */
interface BodyType {
  readonly stream: ReadableStream<Uint8Array>
  readonly stop: (reason: unknown) => Promise<void>
}

/** Bounded consumption and actual cooperative cleanup have separate completion authority. */
function limitBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
  request: RequestType,
): BodyType {
  const reader = body.getReader()
  let bytes = 0
  let released = false
  let stopping: Promise<void> | undefined
  const release = (): void => {
    if (released) return
    released = true
    request.signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  const stop = (reason: unknown): Promise<void> => {
    if (stopping) return stopping
    if (released) return Promise.resolve()
    stopping = reader.cancel(reason)
    void stopping.catch(() => undefined)
    // Terminal cancellation releases the lock even when upstream cancel never settles.
    release()
    return stopping
  }
  const cancel = (): void => {
    void stop(request.signal?.reason)
  }
  request.signal?.addEventListener('abort', cancel, { once: true })
  if (request.signal?.aborted) cancel()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await pending(() => reader.read(), request.signal)
        if (item.done) {
          release()
          controller.close()
          return
        }
        bytes += item.value.byteLength
        if (bytes > limit) {
          throw new QueryError('limit', `SPARQL response exceeded ${limit} bytes.`, {
            query: preview(request.query),
          })
        }
        controller.enqueue(item.value)
      } catch (error) {
        void stop(error)
        controller.error(request.signal?.aborted ? abortError(request, error) : error)
      }
    },
    cancel: stop,
  }, { highWaterMark: 0 })
  return { stream, stop }
}

/** Normalizes graph-parser failures that occur after fetch while the response body is still active. */
async function* graph(
  source: AsyncIterable<Quad>,
  request: RequestType,
): AsyncGenerator<Quad> {
  const labels = new Map<string, BlankNode>()
  try {
    for await (const value of source) yield relabel(value, labels)
  } catch (error) {
    if (request.signal?.aborted) throw abortError(request, error)
    if (error instanceof QueryError) throw error
    throw new QueryError(
      error instanceof SyntaxError ? 'protocol' : 'network',
      error instanceof SyntaxError
        ? 'SPARQL endpoint returned malformed RDF results.'
        : 'SPARQL graph transfer failed before completion.',
      { query: preview(request.query), cause: error },
    )
  }
}

/** Creates a stable timeout/abort failure from the combined request signal. */
function abortError(request: RequestType, cause: unknown): QueryError {
  const reason = request.signal?.reason
  const timedOut = reason instanceof DOMException && reason.name === 'TimeoutError'
  return new QueryError(
    timedOut ? 'timeout' : 'abort',
    timedOut
      ? `SPARQL request timed out after ${request.timeoutMs}ms.`
      : 'SPARQL request was aborted.',
    { query: preview(request.query), cause },
  )
}

/** Pending transfer termination does not wait for cooperative upstream cancellation. */
function readBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return pending(() => reader.read(), signal)
}

/** Returns the caller signal or a timeout-linked signal for the current request. */
function getSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  deadline(timeoutMs)
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal && timeout) return AbortSignal.any([signal, timeout])
  return signal ?? timeout
}

/** Keeps timer behavior consistent with the integer range supported by Node and browser timers. */
function deadline(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new RangeError('timeoutMs must be an integer from 0 to 2147483647.')
  }
}

/** Returns the normalized response media type without parameters. */
function getMediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

/** Returns a bounded query preview suitable for diagnostics. */
function preview(query: string): string {
  return query.length <= QUERY_PREVIEW_LENGTH ? query : `${query.slice(0, QUERY_PREVIEW_LENGTH)}…`
}

export { QueryError } from './error.ts'
export type { QueryErrorKindType } from './error.ts'
