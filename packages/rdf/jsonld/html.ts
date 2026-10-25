/** JSON-LD extraction from HTML documents and remote contexts. @module */
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
): HtmlType {
  const base = htmlBase(source, fallbackBase)
  const scripts: JsonLdValueType[] = []
  const fragment = fragmentOf(documentUrl)
  let offset = 0

  while (true) {
    const open = source.slice(offset).search(/<script\b/iu)
    if (open < 0) break
    const start = offset + open
    const end = tagEnd(source, start + 7)
    if (end < 0) break
    const attrs = attributes(source.slice(start + 7, end))
    const type = (attrs.get('type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
    const id = attrs.get('id')
    const close = source.toLowerCase().indexOf('</script', end + 1)
    if (close < 0) break
    const closeEnd = source.indexOf('>', close)

    if (type === 'application/ld+json' && (!fragment || id === fragment)) {
      const value = script(source.slice(end + 1, close))
      if (all && !fragment && Array.isArray(value)) scripts.push(...value)
      else scripts.push(value)
      if (fragment || !all) break
    }
    offset = closeEnd < 0 ? source.length : closeEnd + 1
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
function htmlBase(source: string, documentUrl: string | undefined): string | undefined {
  if (!documentUrl) return undefined
  const fallback = new URL(documentUrl)
  fallback.hash = ''
  let offset = 0
  while (true) {
    const open = source.slice(offset).search(/<base\b/iu)
    if (open < 0) return fallback.href
    const start = offset + open
    const end = tagEnd(source, start + 5)
    if (end < 0) return fallback.href
    const href = attributes(source.slice(start + 5, end)).get('href')
    if (href !== undefined) {
      try {
        return new URL(href, fallback).href
      } catch {
        // HTML ignores an unusable base URL and continues with the fallback.
        return fallback.href
      }
    }
    offset = end + 1
  }
}

/** Finds a start-tag end while respecting quoted attributes. */ function tagEnd(
  text: string,
  offset: number,
) {
  let quote = ''
  for (let i = offset; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return -1
}
/** Parses focused script attributes needed by JSON-LD extraction. */ function attributes(
  value: string,
) {
  const map = new Map<string, string>()
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu
  for (const match of value.matchAll(re)) {
    map.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return map
}
