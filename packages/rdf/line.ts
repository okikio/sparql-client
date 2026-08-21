/** Shared streaming scanner for RDF 1.2 N-Triples and N-Quads. @module */

import { blankNode, defaultGraph, literal, namedNode, quad } from './factory.ts'
import {
  type GraphTermType,
  type ObjectTermType,
  type PredicateTermType,
  type Quad,
  RDF,
  type SubjectTermType,
} from './term.ts'
import * as language from './language.ts'
import { chunks, type TextSourceType, throwIfAborted } from './text.ts'

export type { TextSourceType } from './text.ts'

/** Source range expressed in UTF-16 code-unit offsets and one-based line/column positions. */
export interface SourceRangeType {
  /** Zero-based source offset where this record starts. */
  readonly start: number
  /** Exclusive zero-based source offset where this record ends. */
  readonly end: number
  /** One-based source line containing the start of this record. */
  readonly line: number
  /** One-based source column containing the start of this record. */
  readonly column: number
}

/** Recoverable parser diagnostic. */
export interface DiagnosticType {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code: string
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: SourceRangeType
}

/** Parser controls for hostile input and tolerant analysis. */
export interface ParseOptionsType {
  /** When true, recoverable line-syntax defects become diagnostics instead of immediate failures. */
  readonly tolerant?: boolean
  /** Maximum characters accepted for one logical RDF line before parsing reports a limit. */
  readonly maxLineLength?: number
  /** Maximum nested RDF 1.2 triple-term depth accepted before parsing reports a limit. */
  readonly maxTripleDepth?: number
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/** RDF 1.2 version labels understood by the line syntaxes. */
export type RdfVersionType = '1.1' | '1.2-basic' | '1.2'

/** Event stream emitted by N-Triples/N-Quads analysis. */
export type ParseEventType =
  | {
    /** Selects the `quad` variant of ParseEventType. */
    readonly kind: 'quad'
    /** RDF quad carried by this event or triplestore mutation. */
    readonly quad: Quad
    /** Source range covered by this ParseEventType. */
    readonly range: SourceRangeType
  }
  | {
    /** Selects the `version` variant of ParseEventType. */
    readonly kind: 'version'
    /** Version marker retained by this syntax record. */
    readonly version: RdfVersionType
    /** Source range covered by this ParseEventType. */
    readonly range: SourceRangeType
  }
  | {
    /** Selects the `diagnostic` variant of ParseEventType. */
    readonly kind: 'diagnostic'
    /** Structured syntax diagnostic emitted by this parser event. */
    readonly diagnostic: DiagnosticType
  }

/** Default max line length used when the caller does not provide an override. */
const DEFAULT_MAX_LINE_LENGTH = 8 * 1024 * 1024
/** Default max triple depth used when the caller does not provide an override. */
const DEFAULT_MAX_TRIPLE_DEPTH = 64

/** Returns whether a code point matches RDF's `PN_CHARS_BASE` production. */
function pnBase(point: number): boolean {
  return (
    (point >= 0x41 && point <= 0x5a) ||
    (point >= 0x61 && point <= 0x7a) ||
    (point >= 0xc0 && point <= 0xd6) ||
    (point >= 0xd8 && point <= 0xf6) ||
    (point >= 0xf8 && point <= 0x2ff) ||
    (point >= 0x370 && point <= 0x37d) ||
    (point >= 0x37f && point <= 0x1fff) ||
    (point >= 0x200c && point <= 0x200d) ||
    (point >= 0x2070 && point <= 0x218f) ||
    (point >= 0x2c00 && point <= 0x2fef) ||
    (point >= 0x3001 && point <= 0xd7ff) ||
    (point >= 0xf900 && point <= 0xfdcf) ||
    (point >= 0xfdf0 && point <= 0xfffd) ||
    (point >= 0x10000 && point <= 0xeffff)
  )
}

/** Returns whether a code point matches RDF's `PN_CHARS_U` production. */
function pnU(point: number): boolean {
  return point === 0x5f || pnBase(point)
}

/** Returns whether a code point matches RDF's `PN_CHARS` production. */
function pn(point: number): boolean {
  return (
    pnU(point) ||
    point === 0x2d ||
    (point >= 0x30 && point <= 0x39) ||
    point === 0xb7 ||
    (point >= 0x300 && point <= 0x36f) ||
    (point >= 0x203f && point <= 0x2040)
  )
}

/** Internal line record retaining absolute source offsets. */
interface LineRecordType {
  /** Decoded source window that contains this logical line. */
  readonly source: string
  /** Inclusive line start within `source`. */
  readonly from: number
  /** Exclusive line end within `source`. */
  readonly to: number
  /** One-based source line containing the start of this record. */
  readonly line: number
  /** Absolute document offset corresponding to `from`. */
  readonly start: number
}

/** Incrementally yields logical lines and cancels a Web Stream on early return. */
export async function* lines(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<LineRecordType> {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH
  const decoder = new TextDecoder()
  let buffered = ''
  let index = 0
  let base = 0
  let line = 1

  /** Emits every complete line currently available without repeatedly slicing the unconsumed suffix. */
  function* drain(final: boolean): Generator<LineRecordType> {
    while (true) {
      const boundary = nextLineBreak(buffered, index, final)
      if (!boundary) return
      const length = boundary.index - index
      if (length > maxLineLength) {
        throw new SyntaxError(`RDF line exceeds maxLineLength (${maxLineLength}).`)
      }
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
  if (remaining > maxLineLength) {
    throw new SyntaxError(`RDF line exceeds maxLineLength (${maxLineLength}).`)
  }
  if (remaining > 0) {
    yield { source: buffered, from: index, to: buffered.length, line, start: base + index }
  }
}

/** Parses one N-Triples/N-Quads line into a semantic event. */
export function parseLine(
  record: LineRecordType,
  allowGraph: boolean,
  options: ParseOptionsType = {},
): ParseEventType | undefined {
  const cursor = new Cursor(
    record.source,
    record.from,
    record.to,
    record.start,
    record.line,
    options.maxTripleDepth ?? DEFAULT_MAX_TRIPLE_DEPTH,
  )
  cursor.space()
  if (cursor.done || cursor.peek() === '#') return undefined

  const rangeStart = cursor.absolute
  if (cursor.take('VERSION')) {
    // RDF 1.2 line syntax allows horizontal whitespace outside terminals, but
    // does not require it. `VERSION"1.2"` is therefore as legal as the
    // more readable `VERSION "1.2"` form.
    cursor.space()
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
  // Whitespace may surround grammar terms, but the RDF 1.2 N-Triples and
  // N-Quads productions do not require it between subject, predicate, object,
  // graph label, or the terminating period. Each term parser consumes its own
  // terminal completely, so optional whitespace is sufficient here.
  cursor.space()
  const predicate = cursor.iri() as PredicateTermType
  cursor.space()
  const object = cursor.object(0)
  cursor.space()

  let graph: GraphTermType = defaultGraph()
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
export function diagnostic(error: unknown, record: LineRecordType): DiagnosticType {
  if (error instanceof ParseError) {
    return { code: error.code, message: error.message, range: error.range }
  }
  return {
    code: 'rdf-syntax',
    message: error instanceof Error ? error.message : String(error),
    range: {
      start: record.start,
      end: record.start + record.to - record.from,
      line: record.line,
      column: 1,
    },
  }
}

/** Position-aware parser error used internally and surfaced as diagnostics in tolerant mode. */
class ParseError extends SyntaxError {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code: string
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: SourceRangeType

  /** Creates one source-ranged line-syntax failure for strict throwing or tolerant diagnostic conversion. */
  constructor(code: string, message: string, range: SourceRangeType) {
    super(message)
    this.name = 'RdfParseError'
    this.code = code
    this.range = range
  }
}

/** Data-oriented cursor over one line. It emits RDF terms directly and builds no token objects. */
class Cursor {
  /** Current lookup or cursor index used to avoid rescanning already consumed state. */
  #index: number
  /** Logical RDF line text inspected by this cursor. */
  readonly source: string
  /** Inclusive index of the first character in this cursor slice. */
  readonly from: number
  /** Exclusive index after the last character in this cursor slice. */
  readonly to: number
  /** Absolute source offset corresponding to the cursor slice start. */
  readonly sourceStart: number
  /** One-based source line containing the start of this record. */
  readonly line: number
  /** Maximum nested RDF 1.2 triple-term depth allowed while this cursor parses a term. */
  readonly maxTripleDepth: number

  /** Creates a cursor over one logical RDF line with absolute source offsets and a bounded RDF 1.2 triple depth. */
  constructor(
    source: string,
    from: number,
    to: number,
    sourceStart: number,
    line: number,
    maxTripleDepth: number,
  ) {
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
    if (this.#index + value.length > this.to || !this.source.startsWith(value, this.#index)) {
      return false
    }
    this.#index += value.length
    return true
  }

  /** Tests a lexical prefix without reading past this logical line. */
  starts(value: string): boolean {
    return this.#index + value.length <= this.to && this.source.startsWith(value, this.#index)
  }

  /** Consumes N-Triples/N-Quads horizontal whitespace. */
  space(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.#index++
  }

  /** Reads a legal line-format RDF subject: an IRI or blank node. */
  subject(): SubjectTermType {
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    throw this.error('rdf-subject', 'Expected IRI or blank node as RDF subject.')
  }

  /** Reads a legal N-Quads graph label without allowing the default graph token in source syntax. */
  graph(): GraphTermType {
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    throw this.error('rdf-graph', 'Expected IRI or blank node as RDF graph label.')
  }

  /** Reads an RDF object, including bounded RDF 1.2 nested triple terms. */
  object(depth: number): ObjectTermType {
    if (depth > this.maxTripleDepth) {
      throw this.error(
        'rdf-depth',
        `Triple term nesting exceeds maxTripleDepth (${this.maxTripleDepth}).`,
      )
    }
    if (this.starts('<<(')) return this.triple(depth + 1)
    if (this.peek() === '<') return this.iri()
    if (this.starts('_:')) return this.blank()
    if (this.peek() === '"') return this.literal()
    throw this.error(
      'rdf-object',
      'Expected IRI, blank node, literal, or RDF 1.2 triple term as object.',
    )
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
        if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
          throw this.errorAt('rdf-iri-absolute', `IRI '${value}' is not absolute.`, start)
        }
        return namedNode(value)
      }
      if (char === '\\') {
        value += this.unicodeEscape()
        continue
      }
      if (char <= ' ' || /[<>"{}|^`]/.test(char)) {
        throw this.errorAt(
          'rdf-iri-char',
          `Invalid character in IRI at column ${this.#index - this.from + 1}.`,
          start,
        )
      }
      value += char
      this.#index++
    }
    throw this.errorAt('rdf-iri-end', 'Unterminated IRI.', start)
  }

  /** Reads one blank-node label using the complete RDF 1.2 `BLANK_NODE_LABEL` character ranges. */
  blank(): ReturnType<typeof blankNode> {
    const start = this.#index
    this.#index += 2
    const first = this.source.codePointAt(this.#index)
    if (first === undefined || (!pnU(first) && !(first >= 0x30 && first <= 0x39))) {
      throw this.errorAt('rdf-blank', 'Invalid blank-node label.', start)
    }

    let value = ''
    while (!this.done) {
      const point = this.source.codePointAt(this.#index)
      if (point === undefined) break
      if (point !== 0x2e && !pn(point)) break
      const char = String.fromCodePoint(point)
      value += char
      this.#index += char.length
    }

    // Periods are legal inside a label but not at its end. Rewind every
    // trailing period so the outer grammar can consume exactly one statement
    // terminator and reject any extra punctuation as trailing content.
    while (value.endsWith('.')) {
      this.#index--
      value = value.slice(0, -1)
    }
    return blankNode(value)
  }

  /** Reads a lexical string plus datatype, language, and optional RDF 1.2 direction into one literal. */
  literal(): ReturnType<typeof literal> {
    const value = this.string()
    if (this.take('^^')) {
      const datatype = this.iri()
      if (datatype.value === RDF.langString || datatype.value === RDF.dirLangString) {
        throw this.error(
          'rdf-language-datatype',
          `${datatype.value} requires a language tag in RDF line syntax.`,
        )
      }
      return literal(value, datatype)
    }
    if (this.take('@')) {
      const languageStart = this.#index
      while (/[A-Za-z0-9-]/.test(this.peek() ?? '')) this.#index++
      const raw = this.source.slice(languageStart, this.#index)
      if (!raw) throw this.error('rdf-language', 'Expected language tag after @.')

      const marker = raw.lastIndexOf('--')
      const tag = marker > 0 ? raw.slice(0, marker) : raw
      if (!language.valid(tag)) {
        throw this.error('rdf-language', `Invalid BCP 47 language tag '${tag}'.`)
      }

      if (marker > 0) {
        const direction = raw.slice(marker + 2)
        if (direction !== 'ltr' && direction !== 'rtl') {
          throw this.error('rdf-direction', `Unsupported base direction '${direction}'.`)
        }
        return literal(value, { language: tag, direction })
      }
      return literal(value, tag)
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
        if (
          escaped === 't' || escaped === 'b' || escaped === 'n' || escaped === 'r' ||
          escaped === 'f' || escaped === '"' || escaped === "'" || escaped === '\\'
        ) {
          this.#index += 2
          value += escapeValue(escaped)
          continue
        }
        value += this.unicodeEscape()
        continue
      }
      if (char === '\n' || char === '\r') {
        throw this.errorAt(
          'rdf-string-line',
          'Line break is not allowed in an N-Triples literal.',
          start,
        )
      }
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
    // `tripleTerm` has the same optional-whitespace rule as an outer RDF
    // statement. This is important for the W3C no-whitespace forms such as
    // `<<(<s><p><o>)>>` and for nested triple terms.
    this.space()
    const predicate = this.iri() as PredicateTermType
    this.space()
    const object = this.object(depth)
    this.space()
    if (!this.take(')>>')) {
      throw this.errorAt('rdf-triple-end', "Expected ')>>' after triple term.", start)
    }
    return quad(subject, predicate, object)
  }

  /** Decodes `\u`/`\U` escapes only when the result is a Unicode scalar value. */
  unicodeEscape(): string {
    const start = this.#index
    this.#index++
    const kind = this.peek()
    if (kind !== 'u' && kind !== 'U') {
      throw this.errorAt('rdf-escape', 'Expected Unicode escape.', start)
    }
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
  range(start: number, end: number): SourceRangeType {
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
): {
  /** Offset of the next line-break sequence. */
  readonly index: number
  /** Number of source code units occupied by the line-break sequence. */
  readonly length: number
} | undefined {
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
    case 't':
      return '\t'
    case 'b':
      return '\b'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 'f':
      return '\f'
    case '"':
      return '"'
    case "'":
      return "'"
    case '\\':
      return '\\'
    default:
      return value
  }
}
