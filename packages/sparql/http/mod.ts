/** SPARQL Query/Update HTTP protocol client. @module */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples } from '@okikio/rdf/ntriples'
import type { Quad } from '@okikio/rdf'
import { getQueryText, getUpdateText, type Queryable, type QueryOptionsType } from '../client.ts'
import { readBindings, readBoolean } from '../result/json.ts'
import { QueryError } from './error.ts'

/** SPARQL endpoint client configuration. */
export interface ClientOptionsType {
  readonly endpoint: string | URL
  readonly updateEndpoint?: string | URL
  readonly fetch?: typeof fetch
  readonly headers?: HeadersInit
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

/** SPARQL HTTP client with explicit result-mode methods. */
export interface Client extends Queryable {
  readonly endpoint: URL
  readonly updateEndpoint: URL
}

/** Default max response bytes used when the caller does not provide an override. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024
/** Maximum SPARQL source characters retained in normalized HTTP error details. */
const QUERY_PREVIEW_LENGTH = 512

/** Creates an import-safe SPARQL HTTP protocol client. No request is made until a method is called. */
export function createClient(options: ClientOptionsType): Client {
  const endpoint = new URL(options.endpoint)
  const updateEndpoint = new URL(options.updateEndpoint ?? options.endpoint)
  const fetchImpl = options.fetch ?? fetch
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return {
    endpoint,
    updateEndpoint,
    /** Query bindings through the wrapped engine without transferring engine ownership. */
    async queryBindings(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(fetchImpl, endpoint, text, 'query', options, queryOptions,
        'application/sparql-results+json; version=1.2, application/sparql-results+json')
      const json = await readJson(response, maxResponseBytes, queryOptions.signal, text)
      const bindings = readBindings(json)
      return array(bindings)
    },
    /** Query boolean through the wrapped engine without transferring engine ownership. */
    async queryBoolean(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(fetchImpl, endpoint, text, 'query', options, queryOptions,
        'application/sparql-results+json; version=1.2, application/sparql-results+json')
      return readBoolean(await readJson(response, maxResponseBytes, queryOptions.signal, text))
    },
    /** Query quads through the wrapped engine without transferring engine ownership. */
    async queryQuads(query, queryOptions = {}) {
      const text = getQueryText(query)
      const response = await request(fetchImpl, endpoint, text, 'query', options, queryOptions,
        'application/n-quads; version=1.2, application/n-triples; version=1.2, application/n-quads, application/n-triples')
      const mediaType = getMediaType(response.headers.get('content-type'))
      if (!response.body) return array<Quad>([])
      if (mediaType === 'application/n-quads') return parseNQuads(response.body, queryOptions.signal ? { signal: queryOptions.signal } : {})
      if (mediaType === 'application/n-triples' || mediaType === 'text/plain') {
        return parseNTriples(response.body, queryOptions.signal ? { signal: queryOptions.signal } : {})
      }
      await response.body.cancel().catch(() => undefined)
      throw new QueryError('media', `Unsupported RDF graph result media type '${mediaType || 'unknown'}'.`, {
        mediaType,
        query: preview(text),
      })
    },
    /** Submits one complete SPARQL Update document through the wrapped engine. */
    async update(update, queryOptions = {}) {
      const text = getUpdateText(update)
      const response = await request(fetchImpl, updateEndpoint, text, 'update', options, queryOptions, '*/*')
      if (response.body) await response.body.cancel().catch(() => undefined)
    },
  }
}

/** Sends one SPARQL protocol POST and normalizes abort, timeout, network, and HTTP failures. */
async function request(
  fetchImpl: typeof fetch,
  endpoint: URL,
  text: string,
  operation: 'query' | 'update',
  client: ClientOptionsType,
  options: QueryOptionsType,
  accept: string,
): Promise<Response> {
  const timeout = options.timeoutMs === null ? 0 : options.timeoutMs ?? client.timeoutMs ?? 0
  const signal = getSignal(options.signal, timeout)
  const headers = new Headers(client.headers)
  headers.set('content-type', operation === 'query' ? 'application/sparql-query; charset=utf-8' : 'application/sparql-update; charset=utf-8')
  headers.set('accept', accept)

  let response: Response
  try {
    response = await fetchImpl(endpoint, { method: 'POST', headers, body: text, ...(signal ? { signal } : {}) })
  } catch (error) {
    if (signal?.aborted) {
      const timedOut = timeout > 0 && !options.signal?.aborted
      throw new QueryError(timedOut ? 'timeout' : 'abort', timedOut ? `SPARQL request timed out after ${timeout}ms.` : 'SPARQL request was aborted.', {
        query: preview(text),
        cause: error,
      })
    }
    throw new QueryError('network', 'SPARQL endpoint request failed before a response was received.', {
      query: preview(text),
      cause: error,
    })
  }

  if (!response.ok) {
    const responseText = await readText(response, Math.min(client.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 16 * 1024), signal)
    throw new QueryError('http', `SPARQL endpoint returned HTTP ${response.status} ${response.statusText}.`, {
      status: response.status,
      query: preview(text),
      response: responseText,
    })
  }
  return response
}

/** Read json from the supplied source while preserving caller ownership. */
async function readJson(response: Response, limit: number, signal: AbortSignal | undefined, query: string): Promise<unknown> {
  const mediaType = getMediaType(response.headers.get('content-type'))
  if (mediaType !== 'application/sparql-results+json' && mediaType !== 'application/json' && mediaType !== '') {
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

/** Read text from the supplied source while preserving caller ownership. */
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
    if (!complete) await reader.cancel('SPARQL response consumption stopped before completion').catch(() => undefined)
    reader.releaseLock()
  }
}

/** Reads one response chunk while allowing an already-pending read to be aborted. */
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
    reader.read().then(
      (value) => {
        if (settled) return
        settled = true
        finish()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
  })
}

/** Combines caller cancellation with the configured timeout without inventing a timeout when disabled. */
function getSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal && timeout) return AbortSignal.any([signal, timeout])
  return signal ?? timeout
}

/** Normalizes a Content-Type header to its lowercase media type without parameters. */
function getMediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

/** Bounds query text retained in errors so diagnostics cannot capture an unbounded request body. */
function preview(query: string): string {
  return query.length <= QUERY_PREVIEW_LENGTH ? query : `${query.slice(0, QUERY_PREVIEW_LENGTH)}…`
}

/** Adapts an already-materialized result array to the asynchronous Queryable stream contract. */
async function* array<T>(values: readonly T[]): AsyncGenerator<T> {
  yield* values
}

export { QueryError } from './error.ts'
export type { QueryErrorKind } from './error.ts'
