/** SPARQL 1.1 Graph Store HTTP Protocol client. @module */

import {
  type BlankNode,
  defaultGraph,
  type GraphTermType,
  namedNode,
  type Quad,
  quad,
} from '@okikio/rdf'
import { parse as parseNTriples, write as writeNTriples } from '@okikio/rdf/ntriples'
import { QueryError } from '../http/error.ts'
import { relabel } from '../result/graph.ts'

/** Graph selected by a Graph Store HTTP Protocol request. */
export type GraphTargetType = {
  /** Selects the protocol default graph when true. */
  readonly default: true
} | {
  /** RDF graph that receives quads produced by Graph Store work. */
  readonly graph: string | URL
}

/** Graph Store client options. */
export interface GraphStoreOptionsType {
  /** SPARQL protocol endpoint used for this client operation. */
  readonly endpoint: string | URL
  /** Caller-supplied Fetch-compatible function used for remote HTTP requests. */
  readonly fetch?: typeof fetch
  /** HTTP headers merged into protocol requests without mutating the caller-supplied Headers object. */
  readonly headers?: HeadersInit
  /** Positive safe-integer transfer limit in bytes, default 64 MiB. Error previews also stop at 16 KiB. */
  readonly maxResponseBytes?: number
}

/** Per-request Graph Store controls. */
export interface GraphStoreRequestOptionsType {
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
  /** HTTP headers merged into protocol requests without mutating the caller-supplied Headers object. */
  readonly headers?: HeadersInit
}

/** Graph Store HTTP Protocol client. */
export interface Client {
  /** SPARQL protocol endpoint used for this client operation. */
  readonly endpoint: URL
  /** Gets all quads from the addressed default or named graph. */
  get(target: GraphTargetType, options?: GraphStoreRequestOptionsType): Promise<Quad[]>
  /** Replaces the addressed graph or resource with the supplied representation. */
  put(
    target: GraphTargetType,
    source: Iterable<Quad>,
    options?: GraphStoreRequestOptionsType,
  ): Promise<void>
  /** Appends or submits the supplied graph representation according to SPARQL Graph Store HTTP semantics. */
  post(
    target: GraphTargetType,
    source: Iterable<Quad>,
    options?: GraphStoreRequestOptionsType,
  ): Promise<void>
  /** Removes the addressed default or named graph from the remote Graph Store. */
  delete(target: GraphTargetType, options?: GraphStoreRequestOptionsType): Promise<void>
}

/** Default response-size limit used when the caller does not provide an override. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/**
 * Creates an import-safe Graph Store HTTP client.
 *
 * The client does not contact the endpoint until `get`, `put`, `post`, or
 * `delete` is called. Response materialization is limited by
 * `maxResponseBytes` so a remote graph cannot grow JavaScript memory without a
 * configured limit.
 *
 * @example
 * ```ts
 * import * as graphStore from '@okikio/sparql/graph-store'
 *
 * const client = graphStore.create({ endpoint: 'https://example.test/data' })
 * const quads = await client.get({ default: true })
 * ```
 */
export function create(options: GraphStoreOptionsType): Client {
  const endpoint = new URL(options.endpoint)
  const fetchImpl = options.fetch ?? fetch
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxResponseBytes must be a positive safe integer.')
  }
  return {
    endpoint,
    /** Reads an N-Triples graph and restores its addressed graph name. */
    async get(target, requestOptions = {}) {
      const response = await send(
        fetchImpl,
        endpoint,
        target,
        'GET',
        undefined,
        options,
        requestOptions,
      )
      const media = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (media !== 'application/n-triples' && media !== 'text/plain') {
        await discard(response)
        throw new QueryError(
          'media',
          `Expected N-Triples Graph Store response, received '${media ?? 'unknown'}'.`,
        )
      }
      const text = await limitedText(
        response,
        maxBytes,
        requestOptions.signal,
      )
      const graph = graphFor(target)
      const values: Quad[] = []
      const labels = new Map<string, BlankNode>()
      try {
        for await (
          const value of parseNTriples(
            text,
            requestOptions.signal ? { signal: requestOptions.signal } : {},
          )
        ) {
          values.push(relabel(quad(value.subject, value.predicate, value.object, graph), labels))
        }
      } catch (cause) {
        requestOptions.signal?.throwIfAborted()
        throw new QueryError('protocol', 'Graph Store endpoint returned malformed N-Triples.', {
          cause,
        })
      }
      return values
    },
    /** Replaces the selected Graph Store graph with the supplied RDF payload. */
    async put(target, source, requestOptions = {}) {
      requestOptions.signal?.throwIfAborted()
      await discard(
        await send(
          fetchImpl,
          endpoint,
          target,
          'PUT',
          body(source, requestOptions.signal),
          options,
          requestOptions,
        ),
      )
    },
    /** Merges the supplied RDF payload into the selected Graph Store graph. */
    async post(target, source, requestOptions = {}) {
      requestOptions.signal?.throwIfAborted()
      await discard(
        await send(
          fetchImpl,
          endpoint,
          target,
          'POST',
          body(source, requestOptions.signal),
          options,
          requestOptions,
        ),
      )
    },
    /** Removes the selected graph through the SPARQL Graph Store Protocol. */
    async delete(target, requestOptions = {}) {
      await discard(
        await send(fetchImpl, endpoint, target, 'DELETE', undefined, options, requestOptions),
      )
    },
  }
}

/** Encoded HTTP request body produced for the selected SPARQL Protocol method. */
function body(source: Iterable<Quad>, signal?: AbortSignal): string {
  const values = Array.from(
    source,
    (value) => {
      signal?.throwIfAborted()
      return quad(value.subject, value.predicate, value.object, defaultGraph())
    },
  )
  return writeNTriples(values)
}

/** Sends the prepared SPARQL Protocol request and returns the validated HTTP response. */
async function send(
  fetchImpl: typeof fetch,
  endpoint: URL,
  target: GraphTargetType,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  payload: string | undefined,
  client: GraphStoreOptionsType,
  options: GraphStoreRequestOptionsType,
): Promise<Response> {
  const url = select(endpoint, target)
  const headers = new Headers(client.headers)
  for (const [key, value] of new Headers(options.headers)) headers.set(key, value)
  headers.set('accept', 'application/n-triples')
  if (payload !== undefined) headers.set('content-type', 'application/n-triples; charset=utf-8')
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    throw new QueryError('network', 'Graph Store request failed before a response was received.', {
      cause,
    })
  }
  if (!response.ok) {
    const detail = await limitedText(
      response,
      Math.min(client.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 16 * 1024),
      options.signal,
      true,
    )
    throw new QueryError(
      'http',
      `Graph Store endpoint returned HTTP ${response.status} ${response.statusText}.`,
      {
        status: response.status,
        response: detail.slice(0, 16 * 1024),
      },
    )
  }
  return response
}

/** Returns the endpoint URL with the Graph Store default-graph or named-graph selector. */
function select(endpoint: URL, target: GraphTargetType): URL {
  const url = new URL(endpoint)
  if ('default' in target) {
    const prefix = url.search ? `${url.search.slice(1)}&` : ''
    url.search = `${prefix}default`
  } else {
    url.searchParams.append('graph', String(target.graph))
  }
  return url
}

/** Returns the graph target encoded by the current Graph Store request options. */
function graphFor(target: GraphTargetType): GraphTermType {
  return 'default' in target ? defaultGraph() : namedNode(String(target.graph))
}

/** Reads a bounded response preview for diagnostics without materializing an unbounded body. */
async function limitedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  preview = false,
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0, text = '', complete = false
  const cancel = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const item = await reader.read()
      signal?.throwIfAborted()
      if (item.done) {
        complete = true
        return text + decoder.decode()
      }
      const remaining = maxBytes - bytes
      bytes += item.value.byteLength
      if (bytes > maxBytes || (preview && bytes === maxBytes)) {
        if (preview) return text + decoder.decode(item.value.subarray(0, remaining))
        throw new QueryError('limit', `Graph Store response exceeded ${maxBytes} bytes.`)
      }
      text += decoder.decode(item.value, { stream: true })
    }
  } catch (cause) {
    signal?.throwIfAborted()
    if (cause instanceof QueryError) throw cause
    throw new QueryError('network', 'Graph Store response transfer failed before completion.', {
      cause,
    })
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (!complete) await reader.cancel('Graph Store consumption stopped').catch(() => undefined)
    reader.releaseLock()
  }
}

/** Cancels and drains no further response data after the caller no longer needs the body. */
async function discard(response: Response): Promise<void> {
  if (response.body) await response.body.cancel().catch(() => undefined)
}
