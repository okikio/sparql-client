/** Bounded JSON-LD remote document loading. @module */

import type { DocumentLoaderType, JsonLdValueType, RemoteDocumentType } from './types.ts'

/** Default max documents used when the caller does not provide an override. */
const DEFAULT_MAX_DOCUMENTS = 32
/** Default max bytes used when the caller does not provide an override. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
/** Default max redirects used when the caller does not provide an override. */
const DEFAULT_MAX_REDIRECTS = 5
/** Default timeout ms used when the caller does not provide an override. */
const DEFAULT_TIMEOUT_MS = 10_000
/** Link relation used by JSON-LD document loading to locate an external context. */
const JSON_LD_CONTEXT_REL = 'http://www.w3.org/ns/json-ld#context'

/** Shared cache contract for caller-owned remote JSON-LD documents. */
export interface DocumentCacheType {
  /** Returns the previously issued or cached value without changing ordering state. */
  get(url: string): RemoteDocumentType | undefined
  /** Stores one loaded remote document in the caller-provided JSON-LD cache. */
  set(url: string, value: RemoteDocumentType): void
}

/** Policy for one JSON-LD processing operation's remote-document loader. */
export interface LoaderOptionsType {
  /** Caller-owned loader. When omitted, network access remains disabled unless `remote` is true. */
  readonly loadDocument?: DocumentLoaderType
  /** Fetch implementation for the built-in HTTP(S) loader. */
  readonly fetch?: typeof fetch
  /** Explicitly allow built-in remote HTTP(S) loading. Defaults to false. */
  readonly remote?: boolean
  /** URL policy checked before every request and redirect. */
  readonly allowUrl?: (url: URL) => boolean | Promise<boolean>
  /** Optional caller-owned cross-operation cache. */
  readonly cache?: DocumentCacheType
  /** Maximum number of remote JSON-LD documents admitted by one loader instance. */
  readonly maxDocuments?: number
  /** Maximum decoded bytes admitted by JSON-LD processing. */
  readonly maxBytes?: number
  /** Maximum HTTP redirects followed while loading one remote JSON-LD document. */
  readonly maxRedirects?: number
  /** Maximum elapsed milliseconds allowed for one remote JSON-LD fetch. */
  readonly timeoutMs?: number
  /** Abort signal checked before and during JSON-LD processing. */
  readonly signal?: AbortSignal
}

/**
 * Creates one bounded, deduplicating document loader.
 *
 * Network loading is denied by default. Applications such as Kaiju should pass
 * their existing crawl-aware loader or an explicit URL policy rather than let
 * JSON-LD processing acquire arbitrary network access implicitly.
 */
export function createDocumentLoader(options: LoaderOptionsType = {}): DocumentLoaderType {
  const maxDocuments = positive(options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS, 'maxDocuments')
  const maxBytes = positive(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
  const maxRedirects = nonNegative(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS, 'maxRedirects')
  const timeoutMs = nonNegative(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const inflight = new Map<string, Promise<RemoteDocumentType>>()
  const local = new Map<string, RemoteDocumentType>()
  let documents = 0

  return async (url) => {
    abort(options.signal)
    const cached = local.get(url) ?? options.cache?.get(url)
    if (cached) return cached
    const pending = inflight.get(url)
    if (pending) return await pending
    if (++documents > maxDocuments) {
      throw new JsonLdLoadError(
        'document-limit',
        `JSON-LD remote document count exceeds maxDocuments (${maxDocuments}).`,
        url,
      )
    }

    const promise = load(url)
    inflight.set(url, promise)
    try {
      const document = await promise
      const bytes = measure(document.document)
      if (bytes > maxBytes) {
        throw new JsonLdLoadError(
          'document-size',
          `JSON-LD remote document exceeds maxBytes (${maxBytes}).`,
          url,
        )
      }
      local.set(url, document)
      local.set(document.documentUrl, document)
      options.cache?.set(url, document)
      if (document.documentUrl !== url) options.cache?.set(document.documentUrl, document)
      return document
    } finally {
      inflight.delete(url)
    }
  }

  /** Resolves one remote JSON-LD document through the bounded cache/deduplication and redirect policy. */
  async function load(url: string): Promise<RemoteDocumentType> {
    if (options.loadDocument) return await options.loadDocument(url)
    if (!options.remote) {
      throw new JsonLdLoadError(
        'remote-disabled',
        'Remote JSON-LD document loading is disabled.',
        url,
      )
    }
    const fetchOptions: FetchOptionsType = {
      fetch: options.fetch ?? fetch,
      maxBytes,
      maxRedirects,
      timeoutMs,
      ...(options.allowUrl ? { allowUrl: options.allowUrl } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }
    return await fetchDocument(url, fetchOptions)
  }
}

/** Stable failure from the bounded remote-document layer. */
export class JsonLdLoadError extends Error {
  /** Discriminates the concrete JsonLdLoadError variant. */
  readonly kind:
    | 'remote-disabled'
    | 'url'
    | 'document-limit'
    | 'document-size'
    | 'redirect-limit'
    | 'http'
    | 'json'
    | 'timeout'
    | 'abort'
  /** Remote document URL associated with this JSON-LD load failure. */
  readonly url: string

  /** Creates a stable JSON-LD loading failure with the requested URL and underlying cause. */
  constructor(kind: JsonLdLoadError['kind'], message: string, url: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'JsonLdLoadError'
    this.kind = kind
    this.url = url
  }
}

/** Fully resolved remote-fetch policy passed through every redirect so limits and URL approval cannot be bypassed mid-chain. */
interface FetchOptionsType {
  /** Fetch implementation used to load remote JSON-LD documents. */
  readonly fetch: typeof fetch
  /** Caller policy that decides whether a resolved remote URL may be fetched. */
  readonly allowUrl?: (url: URL) => boolean | Promise<boolean>
  /** Maximum decoded bytes admitted by JSON-LD processing. */
  readonly maxBytes: number
  /** Maximum HTTP redirects followed while loading one remote JSON-LD document. */
  readonly maxRedirects: number
  /** Maximum elapsed milliseconds allowed for one remote JSON-LD fetch. */
  readonly timeoutMs: number
  /** Abort signal checked before and during JSON-LD processing. */
  readonly signal?: AbortSignal
}

/** Fetches one JSON-LD document while applying redirect, byte, timeout, and URL policy. */
async function fetchDocument(
  input: string,
  options: FetchOptionsType,
): Promise<RemoteDocumentType> {
  let current = toHttpUrl(input)
  for (let redirects = 0;; redirects++) {
    abort(options.signal)
    if (options.allowUrl && !(await options.allowUrl(current))) {
      throw new JsonLdLoadError(
        'url',
        `JSON-LD remote URL is not allowed: ${current.href}`,
        current.href,
      )
    }

    const timed = timeout(options.signal, options.timeoutMs)
    let response: Response
    try {
      response = await options.fetch(current, {
        headers: { Accept: 'application/ld+json, application/json;q=0.9' },
        redirect: 'manual',
        signal: timed.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw new JsonLdLoadError('abort', 'JSON-LD remote load was aborted.', current.href, error)
      }
      if (timed.expired()) {
        throw new JsonLdLoadError(
          'timeout',
          `JSON-LD remote load exceeded ${options.timeoutMs}ms.`,
          current.href,
          error,
        )
      }
      throw error
    } finally {
      timed.dispose()
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= options.maxRedirects) {
        throw new JsonLdLoadError(
          'redirect-limit',
          `JSON-LD redirects exceed maxRedirects (${options.maxRedirects}).`,
          current.href,
        )
      }
      const location = response.headers.get('location')
      if (!location) {
        throw new JsonLdLoadError(
          'http',
          `JSON-LD redirect ${response.status} has no Location header.`,
          current.href,
        )
      }
      current = toHttpUrl(new URL(location, current).href)
      continue
    }
    if (!response.ok) {
      throw new JsonLdLoadError(
        'http',
        `JSON-LD remote load returned HTTP ${response.status}.`,
        current.href,
      )
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      throw new JsonLdLoadError(
        'document-size',
        `JSON-LD remote document exceeds maxBytes (${options.maxBytes}).`,
        current.href,
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > options.maxBytes) {
      throw new JsonLdLoadError(
        'document-size',
        `JSON-LD remote document exceeds maxBytes (${options.maxBytes}).`,
        current.href,
      )
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    let document: JsonLdValueType
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      document = contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
        ? text
        : JSON.parse(text) as JsonLdValueType
    } catch (error) {
      throw new JsonLdLoadError(
        'json',
        'Remote JSON-LD document is not valid UTF-8 JSON or HTML text.',
        current.href,
        error,
      )
    }

    return {
      contextUrl: contextLink(
        response.headers.get('link'),
        response.headers.get('content-type'),
        current,
      ),
      documentUrl: response.url || current.href,
      document,
    }
  }
}

/** Extracts the JSON-LD context Link relation used for non-JSON-LD response types. */
function contextLink(header: string | null, contentType: string | null, base: URL): string | null {
  if (!header || contentType?.toLowerCase().includes('application/ld+json')) return null
  let context: string | null = null
  for (const value of splitLinks(header)) {
    const match = /^\s*<([^>]+)>\s*(.*)$/u.exec(value)
    if (!match) continue
    const parameters = match[2] ?? ''
    const rel = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/iu.exec(parameters)
    const relations = (rel?.[1] ?? rel?.[2] ?? '').split(/\s+/u)
    if (!relations.includes(JSON_LD_CONTEXT_REL)) continue
    if (context !== null) {
      throw new JsonLdLoadError(
        'http',
        'Remote document contains more than one JSON-LD context Link relation.',
        base.href,
      )
    }
    context = new URL(match[1]!, base).href
  }
  return context
}

/** Splits an HTTP Link field without treating commas inside quoted strings or IRIs as separators. */
function splitLinks(value: string): string[] {
  const result: string[] = []
  let start = 0
  let quoted = false
  let angle = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (char === '"' && value[index - 1] !== '\\') quoted = !quoted
    else if (!quoted && char === '<') angle = true
    else if (!quoted && char === '>') angle = false
    else if (!quoted && !angle && char === ',') {
      result.push(value.slice(start, index))
      start = index + 1
    }
  }
  result.push(value.slice(start))
  return result
}

/** Converts one input into an allowed built-in HTTP(S) URL. */
function toHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new JsonLdLoadError('url', `Invalid JSON-LD remote URL '${value}'.`, value, error)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new JsonLdLoadError(
      'url',
      `Unsupported JSON-LD remote URL protocol '${url.protocol}'.`,
      url.href,
    )
  }
  return url
}

/** Estimates already-loaded document bytes to enforce custom-loader output limits too. */
function measure(value: JsonLdValueType): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Creates a disposable timeout signal without transferring ownership of the caller signal. */
function timeout(signal: AbortSignal | undefined, timeoutMs: number): {
  /** Abort signal checked before and during JSON-LD processing. */
  readonly signal: AbortSignal
  /** Returns whether the JSON-LD fetch deadline elapsed before the request completed. */
  expired(): boolean
  /** Releases the timeout resource after the JSON-LD fetch settles. */
  dispose(): void
} {
  const controller = new AbortController()
  let didExpire = false
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = timeoutMs > 0
    ? setTimeout(() => {
      didExpire = true
      controller.abort(new DOMException('Timed out', 'TimeoutError'))
    }, timeoutMs)
    : undefined
  return {
    signal: controller.signal,
    expired: () => didExpire,
    /** Releases the operation timeout when the composed loader signal is no longer needed. */
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    },
  }
}

/** Throws the caller supplied abort reason when cancellation has been requested. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Validates a positive finite loader limit such as bytes, redirects, or context count. */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`)
  }
  return value
}

/** Validates a non-negative finite loader limit that may be explicitly disabled with zero. */
function nonNegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`)
  }
  return value
}
