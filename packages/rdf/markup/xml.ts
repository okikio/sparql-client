/** Strict XML 1.0 host authority for the native no-DTD-processing profile. @module */
import { throwIfAborted } from '../text.ts'
import type {
  MarkupAttributeType,
  MarkupDocumentType,
  MarkupElementType,
  MarkupNodeType,
} from './model.ts'

const XML = 'http://www.w3.org/XML/1998/namespace'
const XMLNS = 'http://www.w3.org/2000/xmlns/'
const NAME =
  /^[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][-.A-Z_a-z0-9\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0300-\u036F\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*$/u
interface ElementType {
  kind: 'element'
  name: string
  attributes: MarkupAttributeType[]
  children: MarkupNodeType[]
  start: number
  end: number
  parent?: MarkupElementType
}
/** XML Char production, also applied to referenced characters. */
function character(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)
}
/** Resolves only XML predefined references and numeric Char references. DTDs are outside this profile. */
function decode(value: string): string {
  return value.replace(/&([^;]*);|&/gu, (source, body: string | undefined) => {
    const predefined: Readonly<Record<string, string>> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    }
    if (body !== undefined && Object.hasOwn(predefined, body)) return predefined[body]!
    if (body !== undefined && /^(?:#[0-9]+|#x[0-9a-fA-F]+)$/u.test(body)) {
      const code = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      if (character(code)) return String.fromCodePoint(code)
    }
    throw new SyntaxError(`Undefined or invalid XML character reference '${source}'.`)
  })
}
/** Validates a namespace-qualified XML name without changing spelling. */
function qname(value: string): string {
  const parts = value.split(':')
  if (parts.length > 2 || !parts.every((part) => NAME.test(part))) {
    throw new SyntaxError(`Invalid XML name '${value}'.`)
  }
  return value
}
/**
 * Parses the explicit XML 1.0 no-DTD-processing profile. Line endings and literal attribute
 * whitespace normalize before entity decoding, so a numeric CR/tab reference
 * retains its referenced character. Offsets index the normalized document text.
 * Standalone DOCTYPE declarations are parsed without fetching an external subset.
 * Internal DTD declarations/default attributes/entities remain unsupported. No
 * external resource or ambient network capability is acquired.
 */
export function parseXml(
  input: string,
  options: { maxNodes: number; maxDepth: number; signal?: AbortSignal },
): MarkupDocumentType {
  const text = input.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n')
  for (const value of text) {
    if (!character(value.codePointAt(0)!)) throw new SyntaxError('Invalid XML character.')
  }
  const children: MarkupNodeType[] = [],
    stack: { node: ElementType; ns: Map<string, string> }[] = []
  let pos = 0, count = 0, roots = 0
  let doctype: string | undefined
  const append = (node: MarkupNodeType) => {
    if (++count > options.maxNodes) {
      throw new RangeError(`Markup input exceeds maxNodes (${options.maxNodes}).`)
    }
    ;(stack.at(-1)?.node.children ?? children).push(node)
  }
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(text[pos] ?? '')) pos++
  }
  const readName = () => {
    const start = pos
    while (pos < text.length && !/[\t\n\r =/>?]/u.test(text[pos]!)) pos++
    return qname(text.slice(start, pos))
  }
  while (pos < text.length) {
    throwIfAborted(options.signal)
    const start = pos
    if (text[pos] !== '<') {
      const end = text.indexOf('<', pos)
      pos = end < 0 ? text.length : end
      const raw = text.slice(start, pos)
      if (raw.includes(']]>')) throw new SyntaxError('XML character data cannot contain ]]> .')
      const value = decode(raw)
      if (!stack.length && !/^[\t\n\r ]*$/u.test(raw)) {
        throw new SyntaxError('Text outside XML document element.')
      }
      if (value) append({ kind: 'text', value, start, end: pos })
      continue
    }
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4)
      if (end < 0 || text.slice(pos + 4, end).includes('--') || text[end - 1] === '-') {
        throw new SyntaxError('Invalid XML comment.')
      }
      pos = end + 3
      continue
    }
    if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2)
      if (end < 0) throw new SyntaxError('Unterminated XML processing instruction.')
      const body = text.slice(pos + 2, end), target = body.split(/[\t\n\r ]/u, 1)[0]!
      qname(target)
      if (target.toLowerCase() === 'xml') {
        if (
          start !== 0 || target !== 'xml' ||
          !/^xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*$/u
            .test(body)
        ) throw new SyntaxError('Unsupported or invalid XML declaration.')
      }
      pos = end + 2
      continue
    }
    if (text.startsWith('<![CDATA[', pos)) {
      if (!stack.length) throw new SyntaxError('CDATA outside XML document element.')
      const end = text.indexOf(']]>', pos + 9)
      if (end < 0) throw new SyntaxError('Unterminated XML CDATA.')
      append({ kind: 'text', value: text.slice(pos + 9, end), start: pos + 9, end })
      pos = end + 3
      continue
    }
    if (text.startsWith('<!DOCTYPE', pos)) {
      if (doctype !== undefined || roots || stack.length) {
        throw new SyntaxError('XML DOCTYPE must occur once before the document element.')
      }
      pos += 9
      const separation = pos
      whitespace()
      if (pos === separation) throw new SyntaxError('Expected whitespace after XML DOCTYPE.')
      const declared = readName()
      whitespace()
      const quoted = (publicId: boolean): string => {
        const quote = text[pos++]
        if (quote !== '"' && quote !== "'") {
          throw new SyntaxError('DOCTYPE identifiers must be quoted.')
        }
        const end = text.indexOf(quote, pos)
        if (end < 0) throw new SyntaxError('Unterminated DOCTYPE identifier.')
        const value = text.slice(pos, end)
        if (publicId && !/^[\r\n a-zA-Z0-9\-'()+,./:=?;!*#@$_%]*$/u.test(value)) {
          throw new SyntaxError('Invalid XML public identifier character.')
        }
        if (!publicId && value.includes('#')) {
          throw new SyntaxError('XML system identifiers cannot contain a fragment.')
        }
        pos = end + 1
        return value
      }
      const separated = () => {
        const before = pos
        whitespace()
        if (before === pos) throw new SyntaxError('Expected DOCTYPE identifier separator.')
      }
      if (text.startsWith('SYSTEM', pos)) {
        pos += 6
        separated()
        quoted(false)
        whitespace()
      } else if (text.startsWith('PUBLIC', pos)) {
        pos += 6
        separated()
        quoted(true)
        separated()
        quoted(false)
        whitespace()
      }
      if (text[pos] === '[') {
        throw new SyntaxError('Native XML profile does not implement internal DTD subsets.')
      }
      if (text[pos++] !== '>') throw new SyntaxError('Invalid XML DOCTYPE declaration.')
      doctype = declared
      continue
    }
    if (text.startsWith('<!', pos)) {
      throw new SyntaxError(
        'Native XML profile does not admit this declaration.',
      )
    }
    if (text.startsWith('</', pos)) {
      pos += 2
      const name = readName()
      whitespace()
      if (text[pos++] !== '>') throw new SyntaxError('Invalid XML end tag.')
      const frame = stack.pop()
      if (!frame || frame.node.name !== name) {
        throw new SyntaxError(`Mismatched XML end tag </${name}>.`)
      }
      frame.node.end = pos
      continue
    }
    pos++
    const name = readName(), attributes: MarkupAttributeType[] = [], seen = new Set<string>()
    let selfClosing = false
    while (true) {
      const before = pos
      whitespace()
      if (text.startsWith('/>', pos)) {
        pos += 2
        selfClosing = true
        break
      }
      if (text[pos] === '>') {
        pos++
        break
      }
      if (pos >= text.length || pos === before) {
        throw new SyntaxError('Expected XML attribute separator or tag end.')
      }
      const start = pos, name = readName()
      whitespace()
      if (seen.has(name)) throw new SyntaxError(`Duplicate XML attribute '${name}'.`)
      seen.add(name)
      if (text[pos++] !== '=') throw new SyntaxError('XML attributes require a value.')
      whitespace()
      const quote = text[pos++]
      if (quote !== '"' && quote !== "'") {
        throw new SyntaxError('XML attribute values must be quoted.')
      }
      const end = text.indexOf(quote, pos)
      if (end < 0) throw new SyntaxError('Unterminated XML attribute value.')
      const raw = text.slice(pos, end)
      if (raw.includes('<')) throw new SyntaxError('XML attribute value contains < .')
      const value = decode(raw.replace(/[\t\n\r]/gu, ' '))
      pos = end + 1
      attributes.push({ name, value, start, end: pos })
    }
    const ns = new Map(stack.at(-1)?.ns ?? [['xml', XML]])
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        const prefix = attribute.name === 'xmlns' ? '' : attribute.name.slice(6)
        if (
          prefix === 'xmlns' || attribute.value === XMLNS ||
          (prefix === 'xml') !== (attribute.value === XML) || (prefix && !attribute.value)
        ) throw new SyntaxError('Invalid XML namespace binding.')
        ns.set(prefix, attribute.value)
      }
    }
    const expanded = new Set<string>()
    const expand = (name: string, attribute: boolean) => {
      const split = name.indexOf(':')
      if (split < 0) return `${attribute ? '' : ns.get('') ?? ''}\u0000${name}`
      const prefix = name.slice(0, split)
      if (prefix === 'xmlns' && attribute) return `${XMLNS}\u0000${name.slice(split + 1)}`
      if (!ns.has(prefix) || prefix === 'xmlns') {
        throw new SyntaxError(`Undeclared XML namespace prefix '${prefix}'.`)
      }
      return `${ns.get(prefix)}\u0000${name.slice(split + 1)}`
    }
    expand(name, false)
    for (const attribute of attributes) {
      const key = expand(attribute.name, true)
      if (expanded.has(key)) throw new SyntaxError('Duplicate expanded XML attribute.')
      expanded.add(key)
    }
    if (!stack.length && roots === 0 && doctype !== undefined && doctype !== name) {
      throw new SyntaxError(
        'XML DOCTYPE name must match the document element in the native profile.',
      )
    }
    if (!stack.length && ++roots > 1) {
      throw new SyntaxError('XML requires exactly one document element.')
    }
    if (stack.length >= options.maxDepth) {
      throw new RangeError(`Markup input exceeds maxDepth (${options.maxDepth}).`)
    }
    const parent = stack.at(-1)?.node
    const node: ElementType = {
      kind: 'element',
      name,
      attributes,
      children: [],
      start,
      end: pos,
      ...(parent ? { parent } : {}),
    }
    append(node)
    if (!selfClosing) stack.push({ node, ns })
  }
  if (stack.length || roots !== 1) {
    throw new SyntaxError('Unclosed or missing XML document element.')
  }
  return { text, children }
}
