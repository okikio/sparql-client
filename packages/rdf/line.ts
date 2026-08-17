/** Shared streaming scanner for RDF 1.2 N-Triples and N-Quads. @module */

import { blankNode, defaultGraph, literal, namedNode, quad } from './factory.ts'
import type { Graph, ObjectTerm, Predicate, Quad, Subject } from './term.ts'
import { chunks, throwIfAborted, type TextSource } from './text.ts'

export type { TextSource } from './text.ts'

/** Source range expressed in UTF-16 code-unit offsets and one-based line/column positions. */
export interface SourceRange {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
}

/** Recoverable parser diagnostic. */
export interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly range: SourceRange
}

/** Parser controls for hostile input and tolerant analysis. */
export interface ParseOptions {
  readonly tolerant?: boolean
  readonly maxLineLength?: number
  readonly maxTripleDepth?: number
  readonly signal?: AbortSignal
}

/** RDF 1.2 version labels understood by the line syntaxes. */
export type RdfVersion = '1.1' | '1.2-basic' | '1.2'

/** Event stream emitted by N-Triples/N-Quads analysis. */
export type ParseEvent =
  | { readonly kind: 'quad'; readonly quad: Quad; readonly range: SourceRange }
  | { readonly kind: 'version'; readonly version: RdfVersion; readonly range: SourceRange }
  | { readonly kind: 'diagnostic'; readonly diagnostic: Diagnostic }

/** Default max line length used when the caller does not provide an override. */
const DEFAULT_MAX_LINE_LENGTH = 8 * 1024 * 1024
/** Default max triple depth used when the caller does not provide an override. */
const DEFAULT_MAX_TRIPLE_DEPTH = 64

/** Internal line record retaining absolute source offsets. */
interface LineRecord {
  /** Decoded source window that contains this logical line. */
  readonly source: string
  /** Inclusive line start within `source`. */
  readonly from: number
  /** Exclusive line end within `source`. */
  readonly to: number
  readonly line: number
  /** Absolute document offset corresponding to `from`. */
  readonly start: number
}

/** Incrementally yields logical lines and cancels a Web Stream on early return. */
export async function* lines(source: TextSource, options: ParseOptions = {}): AsyncGenerator<LineRecord> {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH
  const decoder = new TextDecoder()
  let buffered = ''
  let index = 0
  let base = 0
  let line = 1

  /** Emits every complete line currently available without repeatedly slicing the unconsumed suffix. */
  function* drain(final: boolean): Generator<LineRecord> {
    while (true) {
      const boundary = nextLineBreak(buffered, index, final)
      if (!boundary) return
      const length = boundary.index - index
      if (length > maxLineLength) throw new SyntaxError(`RDF line exceeds maxLineLength (${maxLineLength}).`)
      yield { source: buffered, from: index, to: boundary.index, line, start: base + index }
      index = boundary.index + boundary.length
      line++
      if (index >= 64 * 1024) {
        buffered = buffered.slice(index)
        base += index
        index = 0
      }
    }
  }

  for await (const chunk of chunks(source, options.signal)) {
    throwIfAborted(options.signal)
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    yield* drain(false)

    if (buffered.length - index > maxLineLength && !hasLineBreak(buffered, index)) {
      throw new SyntaxError(`RDF line exceeds maxLineLength (${maxLineLength}).`)
    }
  }

  buffered += decoder.decode()
  yield* drain(true)
  const remaining = buffered.length - index
  if (remaining > maxLineLength) throw new SyntaxError(`RDF line exceeds maxLineLength (${maxLineLength}).`)
  if (remaining > 0) yield { source: buffered, from: index, to: buffered.length, line, start: base + index }
}

/** Parses one N-Triples/N-Quads line into a semantic event. */
export function parseLine(record: LineRecord, allowGraph: boolean, options: ParseOptions = {}): ParseEvent | undefined {
  const cursor = new Cursor(record.source, record.from, record.to, record.start, record.line, options.maxTripleDepth ?? DEFAULT_MAX_TRIPLE_DEPTH)
  cursor.space()
  if (cursor.done || cursor.peek() === '#') return undefined

  const rangeStart = cursor.absolute
  if (cursor.word('VERSION')) {
    cursor.requiredSpace('Expected whitespace after VERSION.')
    const value = cursor.string()
    cursor.space()
    cursor.commentOrEnd()
    if (value !== '1.1' && value !== '1.2-basic' && value !== '1.2') {
      throw cursor.error('rdf-version', `Unsupported RDF version '${value}'.`)
    }
    return {
      kind: 'version',
      version: value,
      range: cursor.range(rangeStart, cursor.absolute),
    }
  }

  const subject = cursor.subject()
  cursor.requiredSpace('Expected whitespace after RDF subject.')
  const predicate = cursor.iri() as Predicate
  cursor.requiredSpace('Expected whitespace after RDF predicate.')
  const object = cursor.object(0)
  cursor.space()

  let graph: Graph = defaultGraph()
  if (allowGraph && cursor.peek() !== '.') {
    graph = cursor.graph()
    cursor.space()
  }

  if (!cursor.take('.')) throw cursor.error('rdf-period', "Expected '.' after RDF statement.")
  cursor.space()
  cursor.commentOrEnd()
  return {
    kind: 'quad',
    quad: quad(subject, predicate, object, graph),
    range: cursor.range(rangeStart, cursor.absolute),
  }
}

/** Converts a parser exception into a source-ranged diagnostic. */
export function diagnostic(error: unknown, record: LineRecord): Diagnostic {
  if (error instanceof ParseError) return { code: error.code, message: error.message, range: error.range }
  return {
    code: 'rdf-syntax',
    message: error instanceof Error ? error.message : String(error),
    range: { start: record.start, end: record.start + record.to - record.from, line: record.line, column: 1 },
  }
}

/** Position-aware parser error used internally and surfaced as diagnostics in tolerant mode. */
class ParseError extends SyntaxError {
  readonly code: string
  readonly range: SourceRange

  /** Creates one source-ranged line-syntax failure for strict throwing or tolerant diagnostic conversion. */
  constructor(code: string, message: string, range: SourceRange) {
    super(message)
    this.name = 'RdfParseError'
    this.code = code
    this.range = range
  }
}

/** Data-oriented cursor over one line. It emits RDF terms directly and builds no token objects. */
class Cursor {
  #index: number
  readonly source: string
  readonly from: number
  readonly to: number
  readonly sourceStart: number
  readonly line: number
  readonly maxTripleDepth: number

  /** Creates a cursor over one logical RDF line with absolute source offsets and a bounded RDF 1.2 triple depth. */
  constructor(source: string, from: number, to: number, sourceStart: number, line: number, maxTripleDepth: number) {
    this.source = source
    this.from = from
    this.to = to
    this.#index = from
    this.sourceStart = sourceStart
    this.line = line
    this.maxTripleDepth = maxTripleDepth
  }

  /** Reports whether the cursor has consumed every code unit in the current logical line. */
  get done(): boolean {
    return this.#index >= this.to
  }

  /** Returns the absolute document offset corresponding to the current line-local cursor position. */
  get absolute(): number {
    return this.sourceStart + this.#index - this.from
  }

  /** Reads a code unit relative to the current cursor without advancing it. */
  peek(offset = 0): string | undefined {
    const index = this.#index + offset
    return index < this.to ? this.source[index] : undefined
  }

  /** Consumes an exact lexical token only when it fits inside this logical line. */
  take(value: string): boolean {
    if (this.#index + value.length > this.to || !this.source.startsWith(value, this.#index)) return false
    this.#index += value.length
    return true
  }

  /** Tests a lexical prefix without reading past this logical line. */
  starts(value: string): boolean {
    return this.#index + value.length <= this.to && this.source.startsWith(value, this.#index)
  }

  /** Consumes a directive word only when followed by line whitespace or end-of-line, rewinding otherwise. */
  word(value: string): boolean {
    const start = this.#index
    if (!this.take(value)) return false
    const next = this.peek()
    if (next !== undefined && !/[ \t]/.test(next)) {
      this.#index = start
      return false
    }
    return true
  }

  /** Consumes N-Triples/N-Quads horizontal whitespace. */
  space(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.#index++
  }

  /** Requires at least one horizontal whitespace character between grammar terms. */
  requiredSpace(message: string): void {
    const start = this.#index
    this.space()
    if (this.#index === start) throw this.error('rdf-whitespace', message)
  }

  /** Reads a legal line-format RDF subject: IRI, blank node, or RDF 1.2 triple term where permitted. */
  subject(): Subject {
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    throw this.error('rdf-subject', 'Expected IRI or blank node as RDF subject.')
  }

  /** Reads a legal N-Quads graph label without allowing the default graph token in source syntax. */
  graph(): Graph {
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    throw this.error('rdf-graph', 'Expected IRI or blank node as RDF graph label.')
  }

  /** Reads an RDF object, including bounded RDF 1.2 nested triple terms. */
  object(depth: number): ObjectTerm {
    if (depth > this.maxTripleDepth) {
      throw this.error('rdf-depth', `Triple term nesting exceeds maxTripleDepth (${this.maxTripleDepth}).`)
    }
    if (this.starts('<<(')) return this.triple(depth + 1)
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    if (this.peek() === '"') return this.literal()
    throw this.error('rdf-object', 'Expected IRI, blank node, literal, or RDF 1.2 triple term as object.')
  }

  /** Decodes one `<IRIREF>` while rejecting forbidden characters and invalid Unicode escapes. */
  iri(): ReturnType<typeof namedNode> {
    const start = this.#index
    if (!this.take('<')) throw this.error('rdf-iri', "Expected '<' to start IRI.")
    let value = ''
    while (!this.done) {
      const char = this.peek()!
      if (char === '>') {
        this.#index++
        return namedNode(value)
      }
      if (char === '\\') {
        value += this.unicodeEscape()
        continue
      }
      if (char <= ' ' || /[<>"{}|^`]/.test(char)) {
        throw this.errorAt('rdf-iri-char', `Invalid character in IRI at column ${this.#index - this.from + 1}.`, start)
      }
      value += char
      this.#index++
    }
    throw this.errorAt('rdf-iri-end', 'Unterminated IRI.', start)
  }

  /** Reads one blank-node label while keeping a trailing statement period outside the label. */
  blank(): ReturnType<typeof blankNode> {
    const start = this.#index
    this.#index += 2
    const first = this.peek()
    if (!first || !/[A-Za-z0-9_\u00C0-\uFFFF]/u.test(first)) {
      throw this.errorAt('rdf-blank', 'Invalid blank-node label.', start)
    }
    let value = ''
    while (!this.done) {
      const char = this.peek()!
      if (!/[A-Za-z0-9_.-\u00B7-\uFFFF]/u.test(char)) break
      value += char
      this.#index++
    }
    if (value.endsWith('.')) {
      this.#index--
      value = value.slice(0, -1)
    }
    return blankNode(value)
  }

  /** Reads a lexical string plus datatype, language, and optional RDF 1.2 direction into one literal. */
  literal(): ReturnType<typeof literal> {
    const value = this.string()
    if (this.take('^^')) return literal(value, this.iri())
    if (this.take('@')) {
      const languageStart = this.#index
      while (/[A-Za-z0-9-]/.test(this.peek() ?? '')) this.#index++
      const raw = this.source.slice(languageStart, this.#index)
      if (!raw) throw this.error('rdf-language', 'Expected language tag after @.')
      const marker = raw.lastIndexOf('--')
      if (marker > 0) {
        const language = raw.slice(0, marker)
        const direction = raw.slice(marker + 2)
        if (direction !== 'ltr' && direction !== 'rtl') {
          throw this.error('rdf-direction', `Unsupported base direction '${direction}'.`)
        }
        return literal(value, { language, direction })
      }
      return literal(value, raw)
    }
    return literal(value)
  }

  /** Decodes one N-Triples quoted string and rejects raw line breaks. */
  string(): string {
    const start = this.#index
    if (!this.take('"')) throw this.error('rdf-string', 'Expected string literal.')
    let value = ''
    while (!this.done) {
      const char = this.peek()!
      if (char === '"') {
        this.#index++
        return value
      }
      if (char === '\\') {
        const escaped = this.peek(1)
        if (escaped === 't' || escaped === 'b' || escaped === 'n' || escaped === 'r' || escaped === 'f' || escaped === '"' || escaped === "'" || escaped === '\\') {
          this.#index += 2
          value += escapeValue(escaped)
          continue
        }
        value += this.unicodeEscape()
        continue
      }
      if (char === '\n' || char === '\r') throw this.errorAt('rdf-string-line', 'Line break is not allowed in an N-Triples literal.', start)
      value += char
      this.#index++
    }
    throw this.errorAt('rdf-string-end', 'Unterminated string literal.', start)
  }

  /** Reads RDF 1.2 `<<( subject predicate object )>>` recursively under `maxTripleDepth`. */
  triple(depth: number): Quad {
    const start = this.#index
    this.#index += 3
    this.space()
    const subject = this.subject()
    this.requiredSpace('Expected whitespace in triple term after subject.')
    const predicate = this.iri() as Predicate
    this.requiredSpace('Expected whitespace in triple term after predicate.')
    const object = this.object(depth)
    this.space()
    if (!this.take(')>>')) throw this.errorAt('rdf-triple-end', "Expected ')>>' after triple term.", start)
    return quad(subject, predicate, object)
  }

  /** Decodes `\u`/`\U` escapes only when the result is a Unicode scalar value. */
  unicodeEscape(): string {
    const start = this.#index
    this.#index++
    const kind = this.peek()
    if (kind !== 'u' && kind !== 'U') throw this.errorAt('rdf-escape', 'Expected Unicode escape.', start)
    this.#index++
    const width = kind === 'u' ? 4 : 8
    const text = this.source.slice(this.#index, Math.min(this.#index + width, this.to))
    if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(text)) {
      throw this.errorAt('rdf-unicode', 'Invalid Unicode escape.', start)
    }
    this.#index += width
    const codePoint = Number.parseInt(text, 16)
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw this.errorAt('rdf-unicode', 'Unicode escape is not a Unicode scalar value.', start)
    }
    return String.fromCodePoint(codePoint)
  }

  /** Accepts only a trailing comment or logical end after the statement period. */
  commentOrEnd(): void {
    if (this.peek() === '#') {
      this.#index = this.to
      return
    }
    if (!this.done) throw this.error('rdf-trailing', 'Unexpected content after RDF statement.')
  }

  /** Converts absolute offsets into a one-line source range with the correct one-based column. */
  range(start: number, end: number): SourceRange {
    return { start, end, line: this.line, column: start - this.sourceStart + 1 }
  }

  /** Creates a one-code-unit parse error at the current cursor. */
  error(code: string, message: string): ParseError {
    return new ParseError(code, message, this.range(this.absolute, this.absolute + 1))
  }

  /** Creates a parse error spanning a saved lexical start through the current cursor. */
  errorAt(code: string, message: string, start: number): ParseError {
    return new ParseError(code, message, this.range(this.sourceStart + start, this.absolute + 1))
  }
}

/** Returns whether the unconsumed source contains a complete line separator. */
function hasLineBreak(value: string, start: number): boolean {
  return value.indexOf('\n', start) !== -1 || value.indexOf('\r', start) !== -1
}

/** Finds the next line separator without rescanning or copying the consumed prefix. */
function nextLineBreak(
  value: string,
  start: number,
  final: boolean,
): { readonly index: number; readonly length: number } | undefined {
  const lf = value.indexOf('\n', start)
  const cr = value.indexOf('\r', start)
  if (lf === -1 && cr === -1) return undefined
  if (cr !== -1 && (lf === -1 || cr < lf)) {
    if (!final && cr + 1 === value.length) return undefined
    return { index: cr, length: value[cr + 1] === '\n' ? 2 : 1 }
  }
  return { index: lf, length: 1 }
}

/** Maps an N-Triples single-character escape to its decoded code point. */
function escapeValue(value: string): string {
  switch (value) {
    case 't': return '\t'
    case 'b': return '\b'
    case 'n': return '\n'
    case 'r': return '\r'
    case 'f': return '\f'
    case '"': return '"'
    case "'": return "'"
    case '\\': return '\\'
    default: return value
  }
}
