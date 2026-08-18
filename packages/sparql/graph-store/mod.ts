/** SPARQL 1.1 Graph Store HTTP Protocol client. @module */

import { defaultGraph, type GraphTermType, namedNode, type Quad, quad } from '@okikio/rdf'
import { parse as parseNTriples, write as writeNTriples } from '@okikio/rdf/ntriples'
import { QueryError } from '../http/error.ts'

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
  /** Maximum response body size accepted before the protocol client aborts decoding. */
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
  return {
    endpoint,
    /** Returns the previously issued or cached value without changing ordering state. */
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
      const text = await limitedText(
        response,
        options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      )
      const graph = graphFor(target)
      const values: Quad[] = []
      for await (
        const value of parseNTriples(
          text,
          requestOptions.signal ? { signal: requestOptions.signal } : {},
        )
      ) {
        values.push(quad(value.subject, value.predicate, value.object, graph))
      }
      return values
    },
    /** Replaces the selected Graph Store graph with the supplied RDF payload. */
    async put(target, source, requestOptions = {}) {
      await discard(
        await send(fetchImpl, endpoint, target, 'PUT', body(source), options, requestOptions),
      )
    },
    /** Merges the supplied RDF payload into the selected Graph Store graph. */
    async post(target, source, requestOptions = {}) {
      await discard(
        await send(fetchImpl, endpoint, target, 'POST', body(source), options, requestOptions),
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
function body(source: Iterable<Quad>): string {
  const values = Array.from(
    source,
    (value) => quad(value.subject, value.predicate, value.object, defaultGraph()),
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
    const detail = await response.text().catch(() => '')
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
async function limitedText(response: Response, maxBytes: number): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw new QueryError('limit', `Graph Store response exceeded ${maxBytes} bytes.`)
  }
  return new TextDecoder().decode(bytes)
}

/** Cancels and drains no further response data after the caller no longer needs the body. */
async function discard(response: Response): Promise<void> {
  if (response.body) await response.body.cancel().catch(() => undefined)
}
