/** Range-first dependency-free markup scanning shared by RDF/XML, RDFa, and Microdata. @module */

import { chunks, type TextSourceType, throwIfAborted } from './text.ts'

/** Default maximum decoded markup bytes accepted by one parser operation. */
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
/** Default maximum number of element and text nodes accepted by one parser operation. */
const DEFAULT_MAX_NODES = 250_000
/** Default maximum element nesting depth accepted by one parser operation. */
const DEFAULT_MAX_DEPTH = 512

/** HTML elements whose end tags are forbidden. */
const HTML_VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
/** Optional HTML end-tag rules needed by common RDFa and Microdata documents. */
const HTML_CLOSE: Readonly<Record<string, ReadonlySet<string>>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  p: new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'div',
    'dl',
    'fieldset',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'menu',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'ul',
  ]),
  rt: new Set(['rt', 'rp']),
  rp: new Set(['rt', 'rp']),
  option: new Set(['option', 'optgroup']),
  thead: new Set(['tbody', 'tfoot']),
  tbody: new Set(['tbody', 'tfoot']),
  tr: new Set(['tr']),
  th: new Set(['th', 'td']),
  td: new Set(['th', 'td']),
}

/** One decoded markup attribute plus its source range. */
export interface MarkupAttributeType {
  /** Attribute name as exposed to host-language processing. */ readonly name: string
  /** Decoded attribute value. Boolean HTML attributes use an empty string. */ readonly value:
    string
  /** Inclusive UTF-16 source offset where the attribute begins. */ readonly start: number
  /** Exclusive UTF-16 source offset after the attribute. */ readonly end: number
}
/** Text node in the bounded markup tree. */
export interface MarkupTextType {
  /** Stable node discriminator. */ readonly kind: 'text'
  /** Decoded character data. */ readonly value: string
  /** Inclusive source offset. */ readonly start: number
  /** Exclusive source offset. */ readonly end: number
}
/** Element node in the bounded markup tree. */
export interface MarkupElementType {
  /** Stable node discriminator. */ readonly kind: 'element'
  /** Element qualified name, lower-cased only in HTML mode. */ readonly name: string
  /** Decoded attributes in source order. */ readonly attributes: readonly MarkupAttributeType[]
  /** Child nodes in document order. */ readonly children: readonly MarkupNodeType[]
  /** Inclusive start-tag offset. */ readonly start: number
  /** Exclusive matching-end-tag or recovered document offset. */ readonly end: number
  /** Parent element when one exists. */ readonly parent?: MarkupElementType
}
/** Any node represented by the internal markup tree. */
export type MarkupNodeType = MarkupElementType | MarkupTextType
/** Result of bounded markup parsing. */
export interface MarkupDocumentType {
  /** Top-level nodes in source order. */ readonly children: readonly MarkupNodeType[]
  /** Decoded source retained for ranges and XML literals. */ readonly text: string
}
/** Parser limits and host-language mode. */
export interface MarkupOptionsType {
  /** Enables HTML case folding, void elements, and selected recovery. */ readonly html?: boolean
  /** Maximum decoded UTF-8 bytes. */ readonly maxBytes?: number
  /** Maximum total element/text node count. */ readonly maxNodes?: number
  /** Maximum open element nesting depth. */ readonly maxDepth?: number
  /** Caller-owned cancellation signal. */ readonly signal?: AbortSignal
}
/** Source-backed lexical token emitted by the scanner. */
export type MarkupTokenType =
  | {
    /** Selects the `text` variant of MarkupTokenType. */
    readonly kind: 'text'
    /** Zero-based source offset where this MarkupTokenType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupTokenType ends. */
    readonly end: number
  }
  | {
    /** Discriminates the concrete MarkupTokenType variant. */
    readonly kind: 'comment' | 'instruction' | 'declaration'
    /** Zero-based source offset where this MarkupTokenType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupTokenType ends. */
    readonly end: number
  }
  | {
    /** Selects the `cdata` variant of MarkupTokenType. */
    readonly kind: 'cdata'
    /** Zero-based source offset where this MarkupTokenType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupTokenType ends. */
    readonly end: number
    /** Zero-based source offset where CDATA character content begins. */
    readonly contentStart: number
    /** Exclusive source offset where CDATA character content ends. */
    readonly contentEnd: number
  }
  | {
    /** Selects the `start` variant of MarkupTokenType. */
    readonly kind: 'start'
    /** Zero-based source offset where this MarkupTokenType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupTokenType ends. */
    readonly end: number
    /** Zero-based source offset where the start-tag body begins after `<`. */
    readonly bodyStart: number
    /** Exclusive source offset where the start-tag body ends before `>`. */
    readonly bodyEnd: number
  }
  | {
    /** Selects the `end` variant of MarkupTokenType. */
    readonly kind: 'end'
    /** Zero-based source offset where this MarkupTokenType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupTokenType ends. */
    readonly end: number
    /** Zero-based source offset where the end-tag name begins. */
    readonly nameStart: number
    /** Exclusive source offset where the end-tag name ends. */
    readonly nameEnd: number
  }
/** Structured event consumed by the tree builder and semantic parsers. */
export type MarkupEventType =
  | {
    /** Selects the `text` variant of MarkupEventType. */
    readonly kind: 'text'
    /** Decoded character data carried by this markup text event. */
    readonly value: string
    /** Zero-based source offset where this MarkupEventType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupEventType ends. */
    readonly end: number
  }
  | {
    /** Selects the `start` variant of MarkupEventType. */
    readonly kind: 'start'
    /** Decoded MarkupEventType name used by the parser state. */
    readonly name: string
    /** Decoded attributes attached to this start-tag or open-element record. */
    readonly attributes: readonly MarkupAttributeType[]
    /** Whether the start tag closes itself without entering the open-element stack. */
    readonly selfClosing: boolean
    /** Zero-based source offset where this MarkupEventType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupEventType ends. */
    readonly end: number
  }
  | {
    /** Selects the `end` variant of MarkupEventType. */
    readonly kind: 'end'
    /** Decoded MarkupEventType name used by the parser state. */
    readonly name: string
    /** Zero-based source offset where this MarkupEventType begins. */
    readonly start: number
    /** Exclusive zero-based source offset where this MarkupEventType ends. */
    readonly end: number
  }

/**
 * Parses XML/HTML-like input through source ranges, structured events, then a bounded tree.
 *
 * This follows the event-first architecture used by `@okikio/wikitext`: scanning owns
 * source offsets, semantic consumers do not need a browser DOM, and the tree is only
 * one consumer of the structured event stream.
 */
export async function parseMarkup(
  source: TextSourceType,
  options: MarkupOptionsType = {},
): Promise<MarkupDocumentType> {
  const maxBytes = positive(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
  const maxNodes = positive(options.maxNodes ?? DEFAULT_MAX_NODES, 'maxNodes')
  const maxDepth = positive(options.maxDepth ?? DEFAULT_MAX_DEPTH, 'maxDepth')
  const text = await collect(source, maxBytes, options.signal)
  const config = {
    html: options.html ?? false,
    maxNodes,
    maxDepth,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  return tree(text, events(text, config), config)
}
/** Returns the first attribute value. */
export function attr(element: MarkupElementType, name: string, html = false): string | undefined {
  const target = html ? name.toLowerCase() : name
  return element.attributes.find((v) => (html ? v.name.toLowerCase() : v.name) === target)?.value
}
/** Returns whether an attribute exists even when its value is empty. */
export function hasAttr(element: MarkupElementType, name: string, html = false): boolean {
  const target = html ? name.toLowerCase() : name
  return element.attributes.some((v) => (html ? v.name.toLowerCase() : v.name) === target)
}
/** Concatenates descendant character data in document order. */
export function textContent(element: MarkupElementType): string {
  return element.children.map((v) => v.kind === 'text' ? v.value : textContent(v)).join('')
}
/** Yields descendant elements in source order. */
export function* elements(
  root: MarkupElementType,
  includeRoot = false,
): Generator<MarkupElementType> {
  if (includeRoot) yield root
  for (const child of root.children) {
    if (child.kind === 'element') {
      yield child
      yield* elements(child)
    }
  }
}

/** Emits source-backed lexical markup tokens in one scan. */
export function* tokenize(
  text: string,
  options: Pick<MarkupOptionsType, 'html' | 'signal'> = {},
): Generator<MarkupTokenType> {
  const html = options.html ?? false
  let pos = 0
  let plain = 0
  const flush = function* (end: number) {
    if (end > plain) yield { kind: 'text' as const, start: plain, end }
  }
  while (pos < text.length) {
    throwIfAborted(options.signal)
    const open = text.indexOf('<', pos)
    if (open < 0) break
    let token: MarkupTokenType | undefined
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4)
      if (end < 0) {
        if (!html) throw new SyntaxError('Unterminated markup comment.')
        pos = open + 1
        continue
      }
      token = { kind: 'comment', start: open, end: end + 3 }
    } else if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9)
      if (end < 0) throw new SyntaxError('Unterminated CDATA section.')
      token = { kind: 'cdata', start: open, end: end + 3, contentStart: open + 9, contentEnd: end }
    } else if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2)
      if (end < 0) throw new SyntaxError('Unterminated processing instruction.')
      token = { kind: 'instruction', start: open, end: end + 2 }
    } else if (text.startsWith('</', open)) {
      const end = tagEnd(text, open + 2, html)
      if (end < 0) {
        pos = open + 1
        continue
      }
      let a = open + 2
      while (/\s/u.test(text[a] ?? '')) a++
      let b = a
      while (b < end && !/[\s>]/u.test(text[b] ?? '')) b++
      token = { kind: 'end', start: open, end: end + 1, nameStart: a, nameEnd: b }
    } else if (text.startsWith('<!', open)) {
      const end = declEnd(text, open + 2)
      token = { kind: 'declaration', start: open, end: end + 1 }
    } else {
      const end = tagEnd(text, open + 1, html)
      if (end < 0) {
        pos = open + 1
        continue
      }
      token = { kind: 'start', start: open, end: end + 1, bodyStart: open + 1, bodyEnd: end }
    }
    yield* flush(open)
    yield token
    pos = token.end
    plain = pos
  }
  if (plain < text.length) yield { kind: 'text', start: plain, end: text.length }
}

/** Converts lexical tokens into decoded start/end/text events. */
function* events(text: string, options: {
  /** Whether markup rules use HTML case-folding and recovery semantics. */
  html: boolean
  /** Maximum markup nodes materialized into the parser consumer tree. */
  maxNodes: number
  /** Maximum nested markup element depth admitted by the parser. */
  maxDepth: number
  /** Abort signal checked before and during this operation. */
  signal?: AbortSignal
}): Generator<MarkupEventType> {
  for (const token of tokenize(text, options)) {
    throwIfAborted(options.signal)
    if (token.kind === 'text') {
      yield {
        kind: 'text',
        value: entities(text.slice(token.start, token.end), options.html),
        start: token.start,
        end: token.end,
      }
    } else if (token.kind === 'cdata') {
      yield {
        kind: 'text',
        value: text.slice(token.contentStart, token.contentEnd),
        start: token.contentStart,
        end: token.contentEnd,
      }
    } else if (token.kind === 'end') {
      yield {
        kind: 'end',
        name: name(text.slice(token.nameStart, token.nameEnd), options.html),
        start: token.start,
        end: token.end,
      }
    } else if (token.kind === 'start') {
      const parsed = start(text, token.bodyStart, token.bodyEnd, options.html)
      yield { kind: 'start', ...parsed, start: token.start, end: token.end }
    }
  }
}
/** Mutable open element used only while the tree stack is active. */
interface OpenType {
  /** Selects the `element` variant of OpenType. */
  kind: 'element'
  /** Decoded OpenType name used by the parser state. */
  name: string
  /** Decoded attributes attached to this start-tag or open-element record. */
  attributes: readonly MarkupAttributeType[]
  /** Child markup nodes accumulated while this element remains open. */
  children: MarkupNodeType[]
  /** Zero-based source offset where this OpenType begins. */
  start: number
  /** Exclusive zero-based source offset where this OpenType ends. */
  end: number
  /** Open parent element used to restore parser stack context. */
  parent?: OpenType
}
/** Materializes structured events into the semantic consumer tree. */
function tree(text: string, input: Iterable<MarkupEventType>, options: {
  /** Whether markup rules use HTML case-folding and recovery semantics. */
  html: boolean
  /** Maximum markup nodes materialized into the parser consumer tree. */
  maxNodes: number
  /** Maximum nested markup element depth admitted by the parser. */
  maxDepth: number
  /** Abort signal checked before and during this operation. */
  signal?: AbortSignal
}): MarkupDocumentType {
  const roots: MarkupNodeType[] = []
  const stack: OpenType[] = []
  let count = 0
  const append = (node: MarkupNodeType) => {
    if (++count > options.maxNodes) {
      throw new RangeError(`Markup input exceeds maxNodes (${options.maxNodes}).`)
    }
    const p = stack.at(-1)
    ;(p ? p.children : roots).push(node)
  }
  for (const event of input) {
    throwIfAborted(options.signal)
    if (event.kind === 'text') {
      if (!event.value) continue
      const list = stack.at(-1)?.children ?? roots
      const prev = list.at(-1)
      if (prev?.kind === 'text') {
        ;(prev as {
          /** Accumulated character data for the previous adjacent text node. */
          value: string
          /** Exclusive zero-based source offset where this tree ends. */
          end: number
        }).value += event.value
        ;(prev as {
          /** Exclusive zero-based source offset where this tree ends. */
          end: number
        }).end = event.end
      } else append({ kind: 'text', value: event.value, start: event.start, end: event.end })
      continue
    }
    if (event.kind === 'start') {
      if (options.html) {
        const current = stack.at(-1)?.name
        if (current && HTML_CLOSE[current]?.has(event.name)) {
          const closed = stack.pop()
          if (closed) closed.end = event.start
        }
      }
      if (stack.length >= options.maxDepth) {
        throw new RangeError(`Markup input exceeds maxDepth (${options.maxDepth}).`)
      }
      const parent = stack.at(-1)
      const node: OpenType = {
        kind: 'element',
        name: event.name,
        attributes: event.attributes,
        children: [],
        start: event.start,
        end: event.end,
        ...(parent ? { parent } : {}),
      }
      append(node as MarkupElementType)
      if (!event.selfClosing && !(options.html && HTML_VOID.has(event.name))) stack.push(node)
      continue
    }
    if (!options.html) {
      const top = stack.at(-1)
      if (!top || top.name !== event.name) {
        throw new SyntaxError(`Mismatched XML end tag </${event.name}>.`)
      }
      top.end = event.end
      stack.pop()
    } else {for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name !== event.name) continue
        for (let j = stack.length - 1; j >= i; j--) stack[j]!.end = event.end
        stack.length = i
        break
      }}
  }
  if (!options.html && stack.length) {
    throw new SyntaxError(`Unclosed XML element <${stack.at(-1)!.name}>.`)
  }
  for (const open of stack) open.end = text.length
  return { children: roots, text }
}
/** Parses one start-tag body and preserves attribute ranges. */
function start(text: string, from: number, to: number, html: boolean): {
  /** Decoded start name used by the parser state. */
  name: string
  /** Decoded attributes attached to this start-tag or open-element record. */
  attributes: MarkupAttributeType[]
  /** Whether the start tag closes itself without entering the open-element stack. */
  selfClosing: boolean
} {
  let i = from
  while (/\s/u.test(text[i] ?? '')) i++
  const ns = i
  while (i < to && !/[\s/>]/u.test(text[i] ?? '')) i++
  const element = name(text.slice(ns, i), html)
  const attrs: MarkupAttributeType[] = []
  let selfClosing = false
  while (i < to) {
    while (/\s/u.test(text[i] ?? '')) i++
    if (text[i] === '/') {
      selfClosing = true
      i++
      continue
    }
    if (i >= to) break
    const s = i
    while (i < to && !/[\s=/>]/u.test(text[i] ?? '')) i++
    const raw = text.slice(s, i)
    if (!raw) {
      i++
      continue
    }
    while (/\s/u.test(text[i] ?? '')) i++
    let value = ''
    if (text[i] === '=') {
      i++
      while (/\s/u.test(text[i] ?? '')) i++
      const q = text[i]
      if (q === '"' || q === "'") {
        i++
        const vs = i
        while (i < to && text[i] !== q) i++
        if (i >= to) throw new SyntaxError(`Unterminated quoted attribute ${raw}.`)
        value = text.slice(vs, i)
        i++
      } else {
        const vs = i
        while (i < to && !/[\s>]/u.test(text[i] ?? '')) i++
        value = text.slice(vs, i)
      }
    }
    attrs.push({ name: name(raw, html), value: entities(value, html), start: s, end: i })
  }
  return { name: element, attributes: attrs, selfClosing }
}
/** Finds a tag terminator while ignoring quoted greater-than characters. */
function tagEnd(text: string, offset: number, html: boolean): number {
  let q = ''
  for (let i = offset; i < text.length; i++) {
    const c = text[i]!
    if (q) {
      if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      continue
    }
    if (c === '>') return i
  }
  if (html) return -1
  throw new SyntaxError('Unterminated markup tag.')
}
/** Finds a declaration terminator while respecting quotes and internal subsets. */
function declEnd(text: string, offset: number): number {
  let q = ''
  let depth = 0
  for (let i = offset; i < text.length; i++) {
    const c = text[i]!
    if (q) {
      if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    else if (c === '>' && depth === 0) return i
  }
  throw new SyntaxError('Unterminated markup declaration.')
}
/** Applies host-language case normalization. */ function name(
  value: string,
  html: boolean,
): string {
  return html ? value.toLowerCase() : value
}
/** Decodes XML entities plus a small deterministic HTML named-entity set. */
function entities(value: string, html: boolean): string {
  if (!value.includes('&')) return value
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    ...(html ? { nbsp: '\u00a0', copy: '©', reg: '®' } : {}),
  }
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/giu, (source, body: string) => {
    if (body[0] === '#') {
      const n = body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : '\ufffd'
    }
    return named[body.toLowerCase()] ?? source
  })
}
/** Reads and decodes source chunks under one byte limit. */
async function collect(
  source: TextSourceType,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let bytes = 0
  let out = ''
  for await (const chunk of chunks(source, signal)) {
    throwIfAborted(signal)
    if (typeof chunk === 'string') {
      bytes += encoder.encode(chunk).byteLength
      out += chunk
    } else {
      bytes += chunk.byteLength
      out += decoder.decode(chunk, { stream: true })
    }
    if (bytes > maxBytes) throw new RangeError(`Markup input exceeds maxBytes (${maxBytes}).`)
  }
  return out + decoder.decode()
}
/** Validates a positive parser limit. */ function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`)
  }
  return value
}
