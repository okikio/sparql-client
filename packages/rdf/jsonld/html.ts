/** JSON-LD extraction from HTML documents and remote contexts. @module */
import { throwIfAborted } from '../text.ts'
import { parseXml } from '../markup/xml.ts'
import { parseHtml } from '../markup/html.ts'
import { attr, elements, type MarkupElementType, textContent } from '../markup/model.ts'
import { JsonLdError } from './context.ts'
import type { JsonLdValueType } from './types.ts'
/** JSON-LD document and document base extracted from one HTML source. */
export interface HtmlType {
  /** Parsed JSON-LD script content selected by the HTML content algorithm. */
  readonly document: JsonLdValueType
  /** Document Base URL after applying the first valid HTML `base[href]`. */
  readonly base?: string
}

/**
 * Extracts JSON-LD script content using the JSON-LD HTML content algorithm.
 *
 * The script body is raw text. HTML character references such as `&lt;` stay
 * unchanged inside JSON strings because HTML does not decode character
 * references in script data. A fragment selects exactly one script by `id`;
 * without a fragment, `extractAllScripts` selects every JSON-LD script and
 * merges array-valued script documents into the resulting document array.
 */
export function html(
  source: string,
  documentUrl: string | undefined,
  all: boolean,
  fallbackBase = documentUrl,
  policy: { readonly maxBytes?: number; readonly signal?: AbortSignal; readonly xml?: boolean } =
    {},
): HtmlType {
  const maxBytes = policy.maxBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer.')
  }
  let bytes = 0
  for (let offset = 0; offset < source.length; offset += 16 * 1024) {
    throwIfAborted(policy.signal)
    bytes += new TextEncoder().encode(source.slice(offset, offset + 16 * 1024)).byteLength
    if (bytes > maxBytes) throw new RangeError(`JSON-LD host input exceeds maxBytes (${maxBytes}).`)
  }
  const parse = policy.xml ? parseXml : parseHtml
  const document = parse(source, {
    maxNodes: 250_000,
    maxDepth: 512,
    ...(policy.signal ? { signal: policy.signal } : {}),
  })
  const nodes: MarkupElementType[] = []
  for (const root of document.children) {
    if (root.kind === 'element') nodes.push(...elements(root, true))
  }
  const base = htmlBase(nodes, fallbackBase)
  const scripts: JsonLdValueType[] = []
  const fragment = fragmentOf(documentUrl)
  for (const element of nodes) {
    if (element.name !== 'script') continue
    const type = (attr(element, 'type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
    if (type !== 'application/ld+json' || (fragment && attr(element, 'id') !== fragment)) continue
    const value = script(textContent(element))
    if (all && !fragment && Array.isArray(value)) scripts.push(...value)
    else scripts.push(value)
    if (fragment || !all) break
  }

  if (scripts.length === 0) {
    if (all && !fragment) return { document: [], ...(base ? { base } : {}) }
    throw new JsonLdError(
      'loading document failed',
      fragment
        ? `HTML document has no application/ld+json script with id '${fragment}'.`
        : 'HTML document has no application/ld+json script.',
    )
  }
  return {
    document: all && !fragment ? scripts : scripts[0]!,
    ...(base ? { base } : {}),
  }
}

/** Parses one JSON-LD script body and reports the specification error code. */
function script(source: string): JsonLdValueType {
  try {
    return JSON.parse(source) as JsonLdValueType
  } catch (error) {
    throw new JsonLdError(
      'invalid script element',
      'HTML JSON-LD script is not valid JSON.',
      error,
    )
  }
}

/** Returns the decoded fragment identifier used to select one HTML script. */
function fragmentOf(documentUrl: string | undefined): string {
  if (!documentUrl) return ''
  const raw = new URL(documentUrl).hash.slice(1)
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Resolves the first valid HTML `base[href]` against the fetched document URL. */
function htmlBase(
  nodes: readonly MarkupElementType[],
  documentUrl: string | undefined,
): string | undefined {
  if (!documentUrl) return undefined
  const fallback = new URL(documentUrl)
  fallback.hash = ''
  for (const element of nodes) {
    if (element.name !== 'base') continue
    const href = attr(element, 'href')
    if (href === undefined) continue
    try {
      return new URL(href, fallback).href
    } catch {
      return fallback.href
    }
  }
  return fallback.href
}
