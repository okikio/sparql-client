/** Bounded JSON-LD remote document loading. @module */

import type { DocumentLoaderType, JsonLdValueType, RemoteDocumentType } from './types.ts'
import { chunks } from '../text.ts'
import { pending } from '../iteration.ts'

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
  /** Optional caller-owned cross-operation cache. Cached documents obey the same count and byte admission limits as fetched documents. */
  readonly cache?: DocumentCacheType
  /** Maximum number of remote JSON-LD documents admitted by one loader instance. */
  readonly maxDocuments?: number
  /** Maximum serialized UTF-8 bytes per admitted document. Cached and custom-loader values are snapshotted under this bound. */
  readonly maxBytes?: number
  /** Maximum HTTP redirects followed while loading one remote JSON-LD document. */
  readonly maxRedirects?: number
  /** Maximum elapsed milliseconds for URL approval, headers, redirects and body transfer of one remote document. */
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
  if (timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must not exceed the portable timer limit of 2147483647.')
  }
  const inflight = new Map<string, Promise<RemoteDocumentType>>()
  const local = new Map<string, RemoteDocumentType>()
  let documents = 0

  return async (url) => {
    abort(options.signal)
    const admitted = local.get(url)
    if (admitted) return admitted
    const active = inflight.get(url)
    if (active) return await pending(() => active, options.signal)
    if (documents >= maxDocuments) {
      throw new JsonLdLoadError(
        'document-limit',
        `JSON-LD remote document count exceeds maxDocuments (${maxDocuments}).`,
        url,
      )
    }
    documents++

    // Share the validated result, so concurrent waiters cannot bypass size policy.
    const promise = (async () => {
      const cached = options.cache?.get(url)
      const document = admit(cached ?? await pending(() => load(url), options.signal), url)
      abort(options.signal)
      if (!cached) {
        options.cache?.set(url, document)
        if (document.documentUrl !== url) options.cache?.set(document.documentUrl, document)
      }
      local.set(url, document)
      local.set(document.documentUrl, document)
      return document
    })()
    inflight.set(url, promise)
    try {
      return await pending(() => promise, options.signal)
    } catch (error) {
      documents--
      if (options.signal?.aborted) {
        throw new JsonLdLoadError(
          'abort',
          'JSON-LD remote load was aborted.',
          url,
          options.signal.reason,
        )
      }
      throw error
    } finally {
      inflight.delete(url)
    }
  }

  /** Snapshots each new admission once, including caller-owned cache values. */
  function admit(document: RemoteDocumentType, url: string): RemoteDocumentType {
    let snapshot: JsonLdValueType
    try {
      snapshot = snapshotDocument(document.document, maxBytes, options.signal)
    } catch (cause) {
      throw new JsonLdLoadError(
        cause instanceof RangeError ? 'document-size' : 'json',
        'JSON-LD document is invalid or exceeds the configured admission limit.',
        url,
        cause,
      )
    }
    if (
      typeof document.documentUrl !== 'string' ||
      !(document.contextUrl === null || typeof document.contextUrl === 'string')
    ) {
      throw new JsonLdLoadError('json', 'Invalid JSON-LD remote document metadata.', url)
    }
    return Object.freeze({
      document: snapshot,
      documentUrl: document.documentUrl,
      contextUrl: document.contextUrl,
      ...(document.contentType ? { contentType: document.contentType } : {}),
    })
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
    | 'media'
    | 'json'
    | 'timeout'
    | 'abort'
  /** JSON-LD specification error code corresponding to this load failure. */
  readonly code: string
  /** Remote document URL associated with this JSON-LD load failure. */
  readonly url: string

  /** Creates a stable JSON-LD loading failure with the requested URL and underlying cause. */
  constructor(
    kind: JsonLdLoadError['kind'],
    message: string,
    url: string,
    cause?: unknown,
    code = 'loading document failed',
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'JsonLdLoadError'
    this.kind = kind
    this.code = code
    this.url = url
  }
}

/** Fully resolved remote-fetch policy passed through every redirect so limits and URL approval cannot be bypassed mid-chain. */
interface FetchOptionsType {
  /** Fetch implementation used to load remote JSON-LD documents. */
  readonly fetch: typeof fetch
  /** Caller policy that decides whether a resolved remote URL may be fetched. */
  readonly allowUrl?: (url: URL) => boolean | Promise<boolean>
  /** Maximum serialized UTF-8 bytes per admitted document. Cached and custom-loader values are snapshotted under this bound. */
  readonly maxBytes: number
  /** Maximum HTTP redirects followed while loading one remote JSON-LD document. */
  readonly maxRedirects: number
  /** Maximum elapsed milliseconds across URL approval, headers, redirects, and body transfer of one document. */
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
  // One remote document owns one deadline. Redirects and URL approval cannot
  // restart the budget or outlive it by ignoring the supplied signal.
  const timed = timeout(options.signal, options.timeoutMs)
  try {
    for (let redirects = 0;; redirects++) {
      try {
        abort(timed.signal)
        if (options.allowUrl && !(await pending(() => options.allowUrl!(current), timed.signal))) {
          throw new JsonLdLoadError(
            'url',
            `JSON-LD remote URL is not allowed: ${current.href}`,
            current.href,
          )
        }
        const response = await fetchResponse(current, options.fetch, timed.signal)
        if (response.status >= 300 && response.status < 400) {
          await pending(() => response.body?.cancel(), timed.signal)
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
          current = redirectUrl(location, current)
          continue
        }
        if (!response.ok) {
          await pending(() => response.body?.cancel(), timed.signal)
          throw new JsonLdLoadError(
            'http',
            `JSON-LD remote load returned HTTP ${response.status}.`,
            current.href,
          )
        }

        const contentLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          await pending(() => response.body?.cancel(), timed.signal)
          throw new JsonLdLoadError(
            'document-size',
            `JSON-LD remote document exceeds maxBytes (${options.maxBytes}).`,
            current.href,
          )
        }
        const bytes = await read(response, options.maxBytes, timed.signal, current.href)

        const contentType = mediaType(response.headers.get('content-type'))
        const link = response.headers.get('link')
        if (!jsonMedia(contentType)) {
          const alternate = alternateLink(link, current)
          if (alternate) {
            if (redirects >= options.maxRedirects) {
              throw new JsonLdLoadError(
                'redirect-limit',
                `JSON-LD redirects and alternate documents exceed maxRedirects (${options.maxRedirects}).`,
                current.href,
              )
            }
            current = toHttpUrl(alternate)
            continue
          }
        }
        if (!jsonMedia(contentType) && !htmlMedia(contentType)) {
          throw new JsonLdLoadError(
            'media',
            `JSON-LD remote document has unsupported Content-Type '${contentType || '(missing)'}'.`,
            current.href,
          )
        }

        let document: JsonLdValueType
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          document = htmlMedia(contentType) ? text : JSON.parse(text) as JsonLdValueType
        } catch (error) {
          throw new JsonLdLoadError(
            'json',
            'Remote JSON-LD document is not valid UTF-8 JSON or HTML text.',
            current.href,
            error,
          )
        }

        return {
          contextUrl: jsonMedia(contentType) && contentType !== 'application/ld+json'
            ? contextLink(link, current)
            : null,
          documentUrl: responseDocumentUrl(response.url, current),
          document,
          contentType,
        }
      } catch (error) {
        if (options.signal?.aborted) {
          throw new JsonLdLoadError(
            'abort',
            'JSON-LD remote load was aborted.',
            current.href,
            error,
          )
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
      }
    }
  } finally {
    timed.dispose()
  }
}

/**
 * Races header acquisition even when an injected Fetch ignores its signal.
 * A response that arrives after terminal abort belongs to this acquisition and
 * must be retired without consuming or caching its document bytes.
 */
async function fetchResponse(
  url: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  const acquisition = Promise.resolve().then(() => {
    signal.throwIfAborted()
    return fetchImpl(url, {
      headers: { Accept: 'application/ld+json, application/json;q=0.9' },
      redirect: 'manual',
      signal,
    })
  }).then((response) => {
    if (signal.aborted) {
      void response.body?.cancel(signal.reason).catch(() => undefined)
      throw signal.reason
    }
    return response
  })
  return await pending(() => acquisition, signal)
}

/**
 * Admits bounded response bytes and cancels the reader on limits, abort or timeout.
 * The deadline remains owned by fetchDocument until this body read also settles.
 */
async function read(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  url: string,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const parts: Uint8Array[] = []
  let length = 0
  for await (const part of chunks(response.body, signal)) {
    const bytes = part as Uint8Array
    length += bytes.byteLength
    if (length > maxBytes) {
      throw new JsonLdLoadError(
        'document-size',
        `JSON-LD remote document exceeds maxBytes (${maxBytes}).`,
        url,
      )
    }
    parts.push(bytes)
  }
  const value = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    value.set(part, offset)
    offset += part.byteLength
  }
  return value
}

/**
 * Resolves one redirect target while preserving an inherited URI fragment.
 *
 * RFC 9110 requires a 3xx `Location` value without a fragment component to
 * inherit the fragment from the reference that produced the current request.
 * An explicit `#` in `Location` suppresses that inheritance, including an
 * explicitly empty fragment.
 */
function redirectUrl(location: string, current: URL): URL {
  const next = toHttpUrl(new URL(location, current).href)
  if (!location.includes('#') && current.hash) next.hash = current.hash
  return next
}

/**
 * Keeps the request fragment on the final document URL when Fetch omits it.
 *
 * HTTP does not send URI fragments to the server, so native Fetch response
 * URLs normally omit them. JSON-LD's HTML algorithm still needs the original
 * fragment to select one `application/ld+json` script by `id`. Redirect logic
 * updates `current` first, so this copies only the fragment that belongs to the
 * final request URL.
 */
function responseDocumentUrl(responseUrl: string, current: URL): string {
  if (!responseUrl) return current.href
  const url = new URL(responseUrl)
  if (!url.hash && current.hash) url.hash = current.hash
  return url.href
}

/** Returns a normalized HTTP Content-Type without parameters. */
function mediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

/** Returns whether a media type is JSON or uses the registered `+json` suffix. */
function jsonMedia(value: string): boolean {
  return value === 'application/json' || value.endsWith('+json')
}

/** Returns whether a media type uses the optional JSON-LD HTML extraction path. */
function htmlMedia(value: string): boolean {
  return value === 'text/html' || value === 'application/xhtml+xml'
}

/** Resolves the JSON-LD alternate document advertised by one HTTP Link field. */
function alternateLink(header: string | null, base: URL): string | null {
  if (!header) return null
  let alternate: string | null = null
  for (const value of splitLinks(header)) {
    const match = /^\s*<([^>]+)>\s*(.*)$/u.exec(value)
    if (!match) continue
    const parameters = match[2] ?? ''
    const rel = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/iu.exec(parameters)
    const relations = (rel?.[1] ?? rel?.[2] ?? '').split(/\s+/u)
    const type = /(?:^|;)\s*type\s*=\s*(?:"([^"]*)"|([^;\s]+))/iu.exec(parameters)
    const media = (type?.[1] ?? type?.[2] ?? '').toLowerCase()
    if (!relations.includes('alternate') || media !== 'application/ld+json') continue
    if (alternate !== null) {
      throw new JsonLdLoadError(
        'http',
        'Remote document contains more than one JSON-LD alternate Link relation.',
        base.href,
      )
    }
    alternate = new URL(match[1]!, base).href
  }
  return alternate
}

/** Extracts the JSON-LD context Link relation used for ordinary JSON response types. */
function contextLink(header: string | null, base: URL): string | null {
  if (!header) return null
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
        undefined,
        'multiple context link headers',
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

/**
 * Copies only JSON data, admitting serialized UTF-8 bytes before allocating descendants.
 * The explicit stack avoids recursive host call stacks. Cycles and accessors are
 * rejected; aliases are copied as JSON would serialize them. The byte bound also
 * bounds node/edge work because every admitted entry costs at least one byte.
 */
function snapshotDocument(
  value: JsonLdValueType,
  limit: number,
  signal?: AbortSignal,
): JsonLdValueType {
  const holder: { value?: JsonLdValueType } = {}
  const active = new Set<object>()
  type Frame = { input: unknown; set: (value: JsonLdValueType) => void } | {
    exit: object
    output: object
  }
  const stack: Frame[] = [{
    input: value,
    set: (output) => {
      holder.value = output
    },
  }]
  let bytes = 0
  const admit = (count: number) => {
    bytes += count
    if (bytes > limit) throw new RangeError('JSON-LD document byte limit exceeded.')
  }
  const string = (text: string) => {
    admit(2)
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (
        code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 ||
        code === 13
      ) admit(2)
      else if (code < 32) admit(6)
      else if (code < 128) admit(1)
      else if (code < 2048) admit(2)
      else if (
        code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 &&
        text.charCodeAt(index + 1) <= 0xdfff
      ) {
        admit(4)
        index++
      } else admit(code >= 0xd800 && code <= 0xdfff ? 6 : 3)
    }
  }
  while (stack.length) {
    abort(signal)
    const frame = stack.pop()!
    if ('exit' in frame) {
      active.delete(frame.exit)
      Object.freeze(frame.output)
      continue
    }
    const input = frame.input
    if (input === null) {
      admit(4)
      frame.set(null)
      continue
    }
    if (typeof input === 'string') {
      string(input)
      frame.set(input)
      continue
    }
    if (typeof input === 'boolean') {
      admit(input ? 4 : 5)
      frame.set(input)
      continue
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      admit(String(input).length)
      frame.set(input)
      continue
    }
    if (typeof input !== 'object' || input === null || active.has(input)) {
      throw new TypeError('Expected acyclic JSON data.')
    }
    if (
      !Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) throw new TypeError('Expected plain JSON object.')
    active.add(input)
    const output: JsonLdValueType[] | Record<string, JsonLdValueType> = Array.isArray(input)
      ? []
      : Object.create(null)
    frame.set(output)
    const keys: string[] = []
    admit(2)
    for (const name in input) {
      if (!Object.hasOwn(input, name)) continue
      abort(signal)
      if (keys.length) admit(1)
      if (!Array.isArray(input)) {
        string(name)
        admit(1)
      }
      // A pending value itself costs at least one serialized byte.
      if (keys.length >= limit - bytes + 1) {
        throw new RangeError('JSON-LD document byte limit exceeded.')
      }
      keys.push(name)
    }
    if (Array.isArray(input) && keys.length !== input.length) {
      throw new TypeError('Sparse or extended arrays are not JSON data.')
    }
    stack.push({ exit: input, output })
    for (let index = keys.length - 1; index >= 0; index--) {
      const name = keys[index]!
      const descriptor = Object.getOwnPropertyDescriptor(input, name)!
      if (!('value' in descriptor)) throw new TypeError('JSON-LD data cannot contain accessors.')
      stack.push({
        input: descriptor.value,
        set: (child) => {
          if (Array.isArray(output)) output[Number(name)] = child
          else output[name] = child
        },
      })
    }
  }
  return holder.value!
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
  if (signal?.aborted) throw signal.reason
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
