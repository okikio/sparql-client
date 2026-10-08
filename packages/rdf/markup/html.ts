/** Native bounded HTML host profile. Full HTML tree conformance is not claimed. @module */
import { throwIfAborted } from '../text.ts'
import type {
  MarkupAttributeType,
  MarkupDocumentType,
  MarkupElementType,
  MarkupNodeType,
} from './model.ts'
import { references } from './entities.ts'
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

/** Builds the admitted HTML profile tree from decoded input. */
export function parseHtml(
  text: string,
  options: { maxNodes: number; maxDepth: number; signal?: AbortSignal },
): MarkupDocumentType {
  const normalized = text.replace(/\r\n?/gu, '\n').replaceAll('\u0000', '\ufffd')
  return tree(normalized, events(normalized, options), options)
}
/** Emits source-backed lexical markup tokens in one scan. */
export function* tokenize(
  text: string,
  options: { signal?: AbortSignal } = {},
): Generator<MarkupTokenType> {
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
        token = { kind: 'comment', start: open, end: text.length }
      } else token = { kind: 'comment', start: open, end: end + 3 }
    } else if (text.startsWith('<?', open) || text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf('>', open + 2)
      token = { kind: 'comment', start: open, end: end < 0 ? text.length : end + 1 }
    } else if (text.startsWith('</', open)) {
      const end = tagEnd(text, open + 2)
      if (end < 0) {
        pos = open + 1
        continue
      }
      let a = open + 2
      while (/[\t\n\f\r ]/u.test(text[a] ?? '')) a++
      let b = a
      while (b < end && !/[\t\n\f\r >]/u.test(text[b] ?? '')) b++
      token = { kind: 'end', start: open, end: end + 1, nameStart: a, nameEnd: b }
    } else if (text.startsWith('<!', open)) {
      const end = declEnd(text, open + 2)
      token = { kind: 'declaration', start: open, end: end + 1 }
    } else {
      if (!/[A-Za-z]/u.test(text[open + 1] ?? '')) {
        pos = open + 1
        continue
      }
      const end = tagEnd(text, open + 1)
      if (end < 0) {
        pos = open + 1
        continue
      }
      token = { kind: 'start', start: open, end: end + 1, bodyStart: open + 1, bodyEnd: end }
    }
    yield* flush(open)
    yield token
    if (token.kind === 'start') {
      const tag = /^[A-Za-z][^\t\n\f\r />]*/u.exec(text.slice(token.bodyStart, token.bodyEnd))?.[0]
        ?.toLowerCase()
      if (
        tag &&
        ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title', 'textarea']
          .includes(tag)
      ) {
        const close = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, 'giu')
        close.lastIndex = token.end
        const match = close.exec(text), end = match?.index ?? text.length
        const raw = text.slice(token.end, end)
        if (tag === 'script' && /<!--[\s\S]*<script[\t\n\f\r />]/iu.test(raw)) {
          throw new SyntaxError('Native HTML profile excludes double-escaped script data.')
        }
        if (end > token.end) {
          yield tag === 'title' || tag === 'textarea'
            ? { kind: 'text', start: token.end, end }
            : { kind: 'cdata', start: token.end, end, contentStart: token.end, contentEnd: end }
        }
        pos = end
        plain = pos
        continue
      }
    }
    pos = token.end
    plain = pos
  }
  if (plain < text.length) yield { kind: 'text', start: plain, end: text.length }
}

/** Converts lexical tokens into decoded start/end/text events. */
function* events(text: string, options: {
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
        value: entities(text.slice(token.start, token.end)),
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
        name: name(text.slice(token.nameStart, token.nameEnd)),
        start: token.start,
        end: token.end,
      }
    } else if (token.kind === 'start') {
      const parsed = start(text, token.bodyStart, token.bodyEnd)
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
  let foster = false
  /** The nearest open table controls insertion mode; nested cell tables are independent. */
  const table = () => stack.findLastIndex((node) => node.name === 'table')
  const mode = (): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const name = stack[i]!.name
      if (['td', 'th'].includes(name)) return 'cell'
      if (['caption', 'colgroup', 'tr', 'tbody', 'thead', 'tfoot', 'table'].includes(name)) {
        return name
      }
    }
    return 'body'
  }
  /** Pop recovery frames without moving their already attached tree children. */
  const close = (index: number, end: number) => {
    for (let i = index; i < stack.length; i++) stack[i]!.end = end
    stack.length = index
  }
  /** Clear transient in-body frames before accepting a structural table child. */
  const context = (names: readonly string[], end: number) => {
    while (stack.length && !names.includes(stack.at(-1)!.name)) close(stack.length - 1, end)
  }
  const append = (node: MarkupNodeType) => {
    if (++count > options.maxNodes) {
      throw new RangeError(`Markup input exceeds maxNodes (${options.maxNodes}).`)
    }
    const parent = stack.at(-1)
    if (foster && parent && ['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(parent.name)) {
      const index = table()
      const target = stack[index]
      if (target) {
        const siblings = target.parent?.children ?? roots
        const position = siblings.indexOf(target)
        siblings.splice(position < 0 ? siblings.length : position, 0, node)
        if (node.kind === 'element') {
          const mutable = node as OpenType
          if (target.parent) mutable.parent = target.parent
          else delete mutable.parent
        }
        return
      }
    }
    ;(parent ? parent.children : roots).push(node)
  }
  /** Implicit structural nodes consume the same node/depth budget as source tags. */
  const implicit = (name: string, event: MarkupEventType) => {
    if (stack.length >= options.maxDepth) {
      throw new RangeError(`Markup input exceeds maxDepth (${options.maxDepth}).`)
    }
    const parent = stack.at(-1)
    const node: OpenType = {
      kind: 'element',
      name,
      attributes: [],
      children: [],
      start: event.start,
      end: event.start,
      ...(parent ? { parent } : {}),
    }
    append(node)
    stack.push(node)
  }
  for (const event of input) {
    throwIfAborted(options.signal)
    foster = false
    let ignore = false
    // Reprocessing must pop a context or create one missing structural frame.
    // The bounded stack therefore also bounds work for each input event.
    for (let step = 0;; step++) {
      if (step > options.maxDepth + 8) {
        throw new RangeError('HTML table recovery exceeded its work budget.')
      }
      const state = mode()
      const start = event.kind === 'start', end = event.kind === 'end'
      const name = event.kind === 'text' ? '' : event.name
      if (state === 'cell') {
        if (end && ['td', 'th'].includes(name)) {
          const index = stack.findLastIndex((node) => node.name === name)
          if (index > table()) close(index, event.end)
          ignore = true
          break
        }
        if (
          (start &&
            ['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(
              name,
            )) || (end && ['table', 'tbody', 'tfoot', 'thead', 'tr'].includes(name))
        ) {
          const index = stack.findLastIndex((node) => node.name === 'td' || node.name === 'th')
          if (index > table()) {
            close(index, event.start)
            continue
          }
          ignore = true
          break
        }
        break
      }
      if (state === 'caption') {
        if (
          (end && name === 'caption') ||
          (start &&
            ['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(
              name,
            )) ||
          (end && name === 'table')
        ) {
          const index = stack.findLastIndex((node) => node.name === 'caption')
          close(index, event.start)
          if (end && name === 'caption') {
            ignore = true
            break
          }
          continue
        }
        break
      }
      if (state === 'colgroup') {
        if (event.kind === 'text' && /^[\t\n\f\r ]*$/u.test(event.value)) break
        if (start && name === 'col') break
        if (end && name === 'col') {
          ignore = true
          break
        }
        close(stack.findLastIndex((node) => node.name === 'colgroup'), event.start)
        if (end && name === 'colgroup') {
          ignore = true
          break
        }
        continue
      }
      if (state === 'tr') {
        if (start && ['td', 'th'].includes(name)) {
          context(['tr'], event.start)
          break
        }
        if (
          (end && name === 'tr') ||
          (start &&
            ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr'].includes(name)) ||
          (end && ['table', 'tbody', 'tfoot', 'thead'].includes(name))
        ) {
          close(stack.findLastIndex((node) => node.name === 'tr'), event.start)
          if (end && name === 'tr') {
            ignore = true
            break
          }
          continue
        }
      }
      if (['tbody', 'thead', 'tfoot'].includes(state)) {
        if (start && name === 'tr') {
          context(['tbody', 'thead', 'tfoot'], event.start)
          break
        }
        if (start && ['td', 'th'].includes(name)) {
          context(['tbody', 'thead', 'tfoot'], event.start)
          implicit('tr', event)
          continue
        }
        if (
          (end && name === state) ||
          (start && ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead'].includes(name)) ||
          (end && name === 'table')
        ) {
          close(stack.findLastIndex((node) => node.name === state), event.start)
          if (end && name === state) {
            ignore = true
            break
          }
          continue
        }
      }
      if (['table', 'tr', 'tbody', 'thead', 'tfoot'].includes(state)) {
        if (start && ['caption', 'colgroup', 'tbody', 'thead', 'tfoot'].includes(name)) {
          context(['table'], event.start)
          break
        }
        if (start && name === 'col') {
          context(['table'], event.start)
          implicit('colgroup', event)
          continue
        }
        if (start && ['tr', 'td', 'th'].includes(name)) {
          context(['table'], event.start)
          implicit('tbody', event)
          continue
        }
        if ((end && name === 'table') || (start && name === 'table')) {
          close(table(), event.start)
          if (end) {
            ignore = true
            break
          }
          continue
        }
        if (
          end &&
          [
            'body',
            'caption',
            'col',
            'colgroup',
            'html',
            'tbody',
            'td',
            'tfoot',
            'th',
            'thead',
            'tr',
          ].includes(name)
        ) {
          ignore = true
          break
        }
        if (start && name === 'form') {
          throw new SyntaxError('Native HTML profile excludes form-pointer rules inside tables.')
        }
        if (start && ['script', 'style'].includes(name)) break
        if (
          start && name === 'input' && event.kind === 'start' &&
          event.attributes.some((attribute) =>
            attribute.name === 'type' && attribute.value.toLowerCase() === 'hidden'
          )
        ) break
        if (event.kind === 'text' && /^[\t\n\f\r ]*$/u.test(event.value)) break
        foster = true
      } else if (
        state === 'body' && (start || end) &&
        ['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(name)
      ) ignore = true
      break
    }
    if (ignore) continue
    if (event.kind === 'text') {
      if (!event.value) continue
      const list = stack.at(-1)?.children ?? roots
      const prev = list.at(-1)
      if (!foster && prev?.kind === 'text') {
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
      {
        if (['template', 'svg', 'math', 'frameset', 'plaintext'].includes(event.name)) {
          throw new SyntaxError(`Native HTML profile excludes <${event.name}> tree semantics.`)
        }
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
      if (!HTML_VOID.has(event.name)) stack.push(node)
      continue
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.name !== event.name) continue
      if (
        i !== stack.length - 1 &&
        ['b', 'i', 'em', 'strong', 'a', 'font', 'nobr', 's', 'u'].includes(event.name)
      ) throw new SyntaxError('Native HTML profile excludes misnested formatting adoption.')
      for (let j = stack.length - 1; j >= i; j--) stack[j]!.end = event.end
      stack.length = i
      break
    }
  }
  for (const open of stack) open.end = text.length
  return { children: roots, text }
}
/** Parses one start-tag body and preserves attribute ranges. */
function start(text: string, from: number, to: number): {
  /** Decoded start name used by the parser state. */
  name: string
  /** Decoded attributes attached to this start-tag or open-element record. */
  attributes: MarkupAttributeType[]
  /** Whether the start tag closes itself without entering the open-element stack. */
  selfClosing: boolean
} {
  let i = from
  while (/[\t\n\f\r ]/u.test(text[i] ?? '')) i++
  const ns = i
  while (i < to && !/[\t\n\f\r />]/u.test(text[i] ?? '')) i++
  const element = name(text.slice(ns, i))
  const attrs: MarkupAttributeType[] = []
  const seenAttributes = new Set<string>()
  let selfClosing = false
  while (i < to) {
    while (/[\t\n\f\r ]/u.test(text[i] ?? '')) i++
    if (text[i] === '/') {
      selfClosing = true
      i++
      continue
    }
    if (i >= to) break
    const s = i
    while (i < to && !/[\t\n\f\r =/>]/u.test(text[i] ?? '')) i++
    const raw = text.slice(s, i)
    if (!raw) {
      i++
      continue
    }
    while (/[\t\n\f\r ]/u.test(text[i] ?? '')) i++
    let value = ''
    if (text[i] === '=') {
      i++
      while (/[\t\n\f\r ]/u.test(text[i] ?? '')) i++
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
        while (i < to && !/[\t\n\f\r >]/u.test(text[i] ?? '')) i++
        value = text.slice(vs, i)
      }
    }
    if (!seenAttributes.has(name(raw))) {
      seenAttributes.add(name(raw))
      attrs.push({ name: name(raw), value: entities(value, true), start: s, end: i })
    }
  }
  return { name: element, attributes: attrs, selfClosing }
}
/** Finds a tag terminator while ignoring quoted greater-than characters. */
function tagEnd(text: string, offset: number): number {
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
  return -1
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
): string {
  return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
}
/**
 * WHATWG character-reference consumption: longest case-sensitive named match;
 * ambiguous semicolonless references stay literal in attributes. Numeric HTML
 * references use replacement and the legacy Windows-1252 control mapping.
 */
function entities(value: string, attribute = false): string {
  const controls: Readonly<Record<number, number>> = {
    128: 8364,
    130: 8218,
    131: 402,
    132: 8222,
    133: 8230,
    134: 8224,
    135: 8225,
    136: 710,
    137: 8240,
    138: 352,
    139: 8249,
    140: 338,
    142: 381,
    145: 8216,
    146: 8217,
    147: 8220,
    148: 8221,
    149: 8226,
    150: 8211,
    151: 8212,
    152: 732,
    153: 8482,
    154: 353,
    155: 8250,
    156: 339,
    158: 382,
    159: 376,
  }
  let output = '', offset = 0
  while (offset < value.length) {
    const amp = value.indexOf('&', offset)
    if (amp < 0) return output + value.slice(offset)
    output += value.slice(offset, amp)
    const numeric = /^&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/u.exec(value.slice(amp))
    if (numeric) {
      let code = Number.parseInt(numeric[1] ?? numeric[2]!, numeric[1] === undefined ? 10 : 16)
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd
      code = controls[code] ?? code
      output += String.fromCodePoint(code)
      offset = amp + numeric[0].length
      continue
    }
    let matched = ''
    // The normative table's longest spelling is 32 characters, including ';'.
    for (let length = Math.min(32, value.length - amp - 1); length > 0; length--) {
      const name = value.slice(amp + 1, amp + 1 + length)
      if (Object.hasOwn(references, name)) {
        matched = name
        break
      }
    }
    if (
      matched &&
      !(attribute && !matched.endsWith(';') &&
        /[=A-Za-z0-9]/u.test(value[amp + 1 + matched.length] ?? ''))
    ) {
      output += references[matched]
      offset = amp + 1 + matched.length
    } else {
      output += '&'
      offset = amp + 1
    }
  }
  return output
}
