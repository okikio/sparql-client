/** Shared streaming RDF 1.2 Turtle/TriG scanner and semantic parser. @module */

import { blankNode, defaultGraph, literal, namedNode, quad, triple } from './factory.ts'
import { chunks, throwIfAborted, type TextSource } from './text.ts'
import { RDF, XSD, type Graph, type Literal, type NamedNode, type ObjectTerm, type Predicate, type Quad, type Subject } from './term.ts'

/** Source range expressed in UTF-16 code-unit offsets and one-based line/column positions. */
export interface CompactRange {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
}

/** Recoverable Turtle/TriG diagnostic. */
export interface CompactDiagnostic {
  readonly code: string
  readonly message: string
  readonly range: CompactRange
}

/** RDF version labels accepted by RDF 1.2 Turtle and TriG. */
export type CompactVersion = '1.1' | '1.2-basic' | '1.2'

/** Streaming parser controls for Turtle and TriG. */
export interface CompactOptions {
  /** Retrieval/base IRI used before an in-document BASE directive appears. */
  readonly baseIri?: string
  /** Emit diagnostics and resume at the next statement where safe. */
  readonly tolerant?: boolean
  /** Maximum decoded lexical token length. */
  readonly maxTokenLength?: number
  /** Maximum nested collection/property-list/triple-term depth. */
  readonly maxDepth?: number
  /** Maximum semantic events buffered for one invalidatable statement in tolerant mode. */
  readonly maxStatementEvents?: number
  readonly signal?: AbortSignal
}

/** Parser event common to Turtle and TriG. */
export type CompactEvent =
  | { readonly kind: 'quad'; readonly quad: Quad; readonly range: CompactRange }
  | { readonly kind: 'prefix'; readonly prefix: string; readonly iri: string; readonly range: CompactRange }
  | { readonly kind: 'base'; readonly iri: string; readonly range: CompactRange }
  | { readonly kind: 'version'; readonly version: CompactVersion; readonly range: CompactRange }
  | { readonly kind: 'diagnostic'; readonly diagnostic: CompactDiagnostic }

/** Default max token length used when the caller does not provide an override. */
const DEFAULT_MAX_TOKEN_LENGTH = 8 * 1024 * 1024
/** Default max depth used when the caller does not provide an override. */
const DEFAULT_MAX_DEPTH = 128
/** Default max statement events used when the caller does not provide an override. */
const DEFAULT_MAX_STATEMENT_EVENTS = 1_000_000
/** Consumed scanner bytes required before slicing the retained source buffer to cap memory. */
const COMPACT_THRESHOLD = 64 * 1024

/** Transient scanner token kinds. Tokens are fields on one scanner object, not allocated AST nodes. */
const Kind = {
  Eof: 0,
  Iri: 1,
  PName: 2,
  Blank: 3,
  String: 4,
  Number: 5,
  Lang: 6,
  True: 7,
  False: 8,
  A: 9,
  Prefix: 10,
  Base: 11,
  Version: 12,
  Graph: 13,
  Dot: 14,
  Semicolon: 15,
  Comma: 16,
  LBracket: 17,
  RBracket: 18,
  LParen: 19,
  RParen: 20,
  LBrace: 21,
  RBrace: 22,
  HatHat: 23,
  Tilde: 24,
  TripleStart: 25,
  TripleEnd: 26,
  ReifiedStart: 27,
  ReifiedEnd: 28,
  AnnotationStart: 29,
  AnnotationEnd: 30,
  Unknown: 31,
} as const

/** Numeric compact-syntax token kind used only inside the allocation-light scanner/parser state machine. */
type Kind = (typeof Kind)[keyof typeof Kind]

/** Position-aware parser failure used by strict mode and converted to diagnostics in tolerant mode. */
class CompactError extends SyntaxError {
  readonly code: string
  readonly range: CompactRange

  /** Creates a position-aware Turtle/TriG syntax failure that tolerant mode can convert to a diagnostic. */
  constructor(code: string, message: string, range: CompactRange) {
    super(message)
    this.name = 'RdfCompactParseError'
    this.code = code
    this.range = range
  }
}

/**
 * Incremental UTF-8 lexical scanner.
 *
 * The scanner keeps one mutable token record (`kind`, `value`, `raw`, range)
 * and compacts consumed source. This avoids a token-array/AST allocation layer
 * while still giving the semantic parser one-token lookahead.
 */
class Scanner {
  readonly signal: AbortSignal | undefined
  readonly maxTokenLength: number

  kind: Kind = Kind.Eof
  value = ''
  raw = ''
  start = 0
  end = 0
  line = 1
  column = 1

  #source: AsyncGenerator<string | Uint8Array>
  #decoder = new TextDecoder('utf-8', { fatal: true })
  #buffer = ''
  #index = 0
  #absolute = 0
  #line = 1
  #column = 1
  #done = false

  /** Creates one incremental scanner over bounded source chunks without materializing a token array. */
  constructor(source: TextSource, options: CompactOptions) {
    this.signal = options.signal
    this.maxTokenLength = options.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH
    this.#source = chunks(source, options.signal)
  }

  /** Advances to the next significant token. */
  async next(): Promise<void> {
    throwIfAborted(this.signal)
    await this.#skipSpace()

    this.value = ''
    this.raw = ''
    this.start = this.#absolute
    this.line = this.#line
    this.column = this.#column

    const first = await this.#peek()
    if (first === undefined) {
      this.kind = Kind.Eof
      this.end = this.#absolute
      return
    }

    const three = `${first}${await this.#peek(1) ?? ''}${await this.#peek(2) ?? ''}`
    const two = three.slice(0, 2)

    if (three === '<<(') return await this.#punct(Kind.TripleStart, 3)
    if (three === ')>>') return await this.#punct(Kind.TripleEnd, 3)
    if (two === '<<') return await this.#punct(Kind.ReifiedStart, 2)
    if (two === '>>') return await this.#punct(Kind.ReifiedEnd, 2)
    if (two === '{|') return await this.#punct(Kind.AnnotationStart, 2)
    if (two === '|}') return await this.#punct(Kind.AnnotationEnd, 2)
    if (two === '^^') return await this.#punct(Kind.HatHat, 2)

    switch (first) {
      case '.': {
        const next = await this.#peek(1)
        if (next !== undefined && /[0-9]/.test(next)) return await this.#number()
        return await this.#punct(Kind.Dot, 1)
      }
      case ';': return await this.#punct(Kind.Semicolon, 1)
      case ',': return await this.#punct(Kind.Comma, 1)
      case '[': return await this.#punct(Kind.LBracket, 1)
      case ']': return await this.#punct(Kind.RBracket, 1)
      case '(': return await this.#punct(Kind.LParen, 1)
      case ')': return await this.#punct(Kind.RParen, 1)
      case '{': return await this.#punct(Kind.LBrace, 1)
      case '}': return await this.#punct(Kind.RBrace, 1)
      case '~': return await this.#punct(Kind.Tilde, 1)
      case '<': return await this.#iri()
      case '"':
      case "'": return await this.#string(first)
      case '@': return await this.#at()
      case ':': return await this.#pname()
      case '+':
      case '-': return await this.#numberOrUnknown()
      default:
        if (/[0-9]/.test(first)) return await this.#number()
        if (two === '_:') return await this.#blank()
        if (isNameStart(first)) return await this.#wordOrPname()
        await this.#take()
        this.kind = Kind.Unknown
        this.raw = first
        this.value = first
        this.end = this.#absolute
    }
  }

  /** Returns a range covering the current scanner token. */
  range(): CompactRange {
    return { start: this.start, end: this.end, line: this.line, column: this.column }
  }

  /** Constructs a parser error at the current token. */
  error(code: string, message: string): CompactError {
    return new CompactError(code, message, this.range())
  }

  /** Skips space in the current parser or scanner state. */
  async #skipSpace(): Promise<void> {
    while (true) {
      const char = await this.#peek()
      if (char === undefined) return
      if (isWhitespace(char)) {
        await this.#take()
        continue
      }
      if (char === '#') {
        while (true) {
          const item = await this.#peek()
          if (item === undefined || item === '\n' || item === '\r') break
          await this.#take()
        }
        continue
      }
      return
    }
  }

  /** Punct as one isolated step of the Scanner state machine. */
  async #punct(kind: Kind, width: number): Promise<void> {
    let raw = ''
    for (let i = 0; i < width; i++) raw += await this.#take() ?? ''
    this.kind = kind
    this.raw = raw
    this.value = raw
    this.end = this.#absolute
  }

  /** Iri as one isolated step of the Scanner state machine. */
  async #iri(): Promise<void> {
    const mark = this.#absolute
    await this.#take()
    let value = ''
    let raw = '<'
    while (true) {
      const char = await this.#peek()
      if (char === undefined) throw this.error('turtle-iri-end', 'Unterminated IRI reference.')
      if (char === '>') {
        raw += await this.#take()
        this.#guard(mark)
        this.kind = Kind.Iri
        this.value = value
        this.raw = raw
        this.end = this.#absolute
        return
      }
      if (char === '\\') {
        raw += await this.#take()
        const escape = await this.#unicodeEscape()
        raw += escape.raw
        value += escape.value
        continue
      }
      if (char <= ' ' || /[<>"{}|^`]/.test(char)) {
        throw this.error('turtle-iri-char', 'IRI reference contains a forbidden character.')
      }
      raw += await this.#take()
      value += char
      this.#guard(mark)
    }
  }

  /** String as one isolated step of the Scanner state machine. */
  async #string(quote: string): Promise<void> {
    const mark = this.#absolute
    const long = await this.#peek(1) === quote && await this.#peek(2) === quote
    const width = long ? 3 : 1
    let raw = ''
    for (let i = 0; i < width; i++) raw += await this.#take() ?? ''
    let value = ''

    while (true) {
      const char = await this.#peek()
      if (char === undefined) throw this.error('turtle-string-end', 'Unterminated Turtle string literal.')
      if (char === quote) {
        if (long) {
          if (await this.#peek(1) === quote && await this.#peek(2) === quote) {
            for (let i = 0; i < 3; i++) raw += await this.#take() ?? ''
            break
          }
        } else {
          raw += await this.#take()
          break
        }
      }
      if (!long && (char === '\n' || char === '\r')) {
        throw this.error('turtle-string-line', 'Short Turtle string literals cannot contain line breaks.')
      }
      if (char === '\\') {
        raw += await this.#take()
        const next = await this.#peek()
        if (next === 'u' || next === 'U') {
          const escape = await this.#unicodeEscape()
          raw += escape.raw
          value += escape.value
          continue
        }
        if (next === undefined || !'tbnrf"\'\\'.includes(next)) {
          throw this.error('turtle-string-escape', 'Invalid Turtle string escape.')
        }
        raw += await this.#take()
        value += escapeValue(next)
        continue
      }
      raw += await this.#take()
      value += char
      this.#guard(mark)
    }

    this.#guard(mark)
    this.kind = Kind.String
    this.value = value
    this.raw = raw
    this.end = this.#absolute
  }

  /** At as one isolated step of the Scanner state machine. */
  async #at(): Promise<void> {
    const mark = this.#absolute
    let raw = await this.#take() ?? ''
    while (true) {
      const char = await this.#peek()
      if (char === undefined || !/[A-Za-z0-9-]/.test(char)) break
      raw += await this.#take()
      this.#guard(mark)
    }

    if (raw === '@prefix') this.kind = Kind.Prefix
    else if (raw === '@base') this.kind = Kind.Base
    else if (raw === '@version') this.kind = Kind.Version
    else this.kind = Kind.Lang
    this.raw = raw
    this.value = raw.slice(1)
    this.end = this.#absolute
  }

  /** Blank as one isolated step of the Scanner state machine. */
  async #blank(): Promise<void> {
    const mark = this.#absolute
    let raw = `${await this.#take() ?? ''}${await this.#take() ?? ''}`
    const first = await this.#peek()
    if (first === undefined || !isBlankStart(first)) throw this.error('turtle-blank', 'Invalid blank-node label.')
    while (true) {
      const char = await this.#peek()
      if (char === undefined || !isBlankChar(char)) break
      raw += await this.#take()
      this.#guard(mark)
    }
    if (raw.endsWith('.')) {
      this.#rewindOne('.')
      raw = raw.slice(0, -1)
    }
    this.kind = Kind.Blank
    this.raw = raw
    this.value = raw.slice(2)
    this.end = this.#absolute
  }

  /** Number or unknown as one isolated step of the Scanner state machine. */
  async #numberOrUnknown(): Promise<void> {
    const next = await this.#peek(1)
    const after = await this.#peek(2)
    if (next !== undefined && (/[0-9]/.test(next) || (next === '.' && after !== undefined && /[0-9]/.test(after)))) {
      return await this.#number()
    }
    const first = await this.#take() ?? ''
    this.kind = Kind.Unknown
    this.raw = first
    this.value = first
    this.end = this.#absolute
  }

  /** Number as one isolated step of the Scanner state machine. */
  async #number(): Promise<void> {
    const mark = this.#absolute
    let raw = ''
    let char = await this.#peek()
    if (char === '+' || char === '-') {
      raw += await this.#take()
      char = await this.#peek()
    }

    while (char !== undefined && /[0-9]/.test(char)) {
      raw += await this.#take()
      char = await this.#peek()
      this.#guard(mark)
    }
    if (char === '.') {
      const next = await this.#peek(1)
      if (next !== undefined && (/[0-9]/.test(next) || next === 'e' || next === 'E')) {
        raw += await this.#take()
        char = await this.#peek()
        while (char !== undefined && /[0-9]/.test(char)) {
          raw += await this.#take()
          char = await this.#peek()
          this.#guard(mark)
        }
      }
    }
    if (char === 'e' || char === 'E') {
      raw += await this.#take()
      char = await this.#peek()
      if (char === '+' || char === '-') {
        raw += await this.#take()
        char = await this.#peek()
      }
      if (char === undefined || !/[0-9]/.test(char)) throw this.error('turtle-number', 'Exponent requires at least one digit.')
      while (char !== undefined && /[0-9]/.test(char)) {
        raw += await this.#take()
        char = await this.#peek()
        this.#guard(mark)
      }
    }

    if (!numericKind(raw)) throw this.error('turtle-number', `Invalid numeric literal '${raw}'.`)
    this.kind = Kind.Number
    this.raw = raw
    this.value = raw
    this.end = this.#absolute
  }

  /** Word or pname as one isolated step of the Scanner state machine. */
  async #wordOrPname(): Promise<void> {
    const mark = this.#absolute
    let raw = ''
    while (true) {
      const char = await this.#peek()
      if (char === undefined || !isPrefixChar(char)) break
      raw += await this.#take()
      this.#guard(mark)
    }

    if (await this.#peek() === ':') {
      raw += await this.#take()
      while (true) {
        const char = await this.#peek()
        if (char === undefined) break
        if (char === '\\') {
          raw += await this.#take()
          const escaped = await this.#peek()
          if (escaped === undefined || !isLocalEscape(escaped)) throw this.error('turtle-pname-escape', 'Invalid prefixed-name escape.')
          raw += await this.#take()
          continue
        }
        if (char === '%') {
          const a = await this.#peek(1)
          const b = await this.#peek(2)
          if (a !== undefined && b !== undefined && /[0-9A-Fa-f]/.test(a) && /[0-9A-Fa-f]/.test(b)) {
            raw += `${await this.#take()}${await this.#take()}${await this.#take()}`
            continue
          }
          break
        }
        if (!isLocalChar(char)) break
        raw += await this.#take()
        this.#guard(mark)
      }
      while (raw.endsWith('.')) {
        this.#rewindOne('.')
        raw = raw.slice(0, -1)
      }
      this.kind = Kind.PName
      this.raw = raw
      this.value = raw
      this.end = this.#absolute
      return
    }

    const upper = raw.toUpperCase()
    if (raw === 'a') this.kind = Kind.A
    else if (raw === 'true') this.kind = Kind.True
    else if (raw === 'false') this.kind = Kind.False
    else if (upper === 'PREFIX') this.kind = Kind.Prefix
    else if (upper === 'BASE') this.kind = Kind.Base
    else if (upper === 'VERSION') this.kind = Kind.Version
    else if (upper === 'GRAPH') this.kind = Kind.Graph
    else this.kind = Kind.Unknown
    this.raw = raw
    this.value = raw
    this.end = this.#absolute
  }

  /** Pname as one isolated step of the Scanner state machine. */
  async #pname(): Promise<void> {
    const mark = this.#absolute
    let raw = await this.#take() ?? ''
    while (true) {
      const char = await this.#peek()
      if (char === undefined) break
      if (char === '\\') {
        raw += await this.#take()
        const escaped = await this.#peek()
        if (escaped === undefined || !isLocalEscape(escaped)) throw this.error('turtle-pname-escape', 'Invalid prefixed-name escape.')
        raw += await this.#take()
        continue
      }
      if (char === '%') {
        const a = await this.#peek(1)
        const b = await this.#peek(2)
        if (a !== undefined && b !== undefined && /[0-9A-Fa-f]/.test(a) && /[0-9A-Fa-f]/.test(b)) {
          raw += `${await this.#take()}${await this.#take()}${await this.#take()}`
          continue
        }
        break
      }
      if (!isLocalChar(char)) break
      raw += await this.#take()
      this.#guard(mark)
    }
    while (raw.endsWith('.')) {
      this.#rewindOne('.')
      raw = raw.slice(0, -1)
    }
    this.kind = Kind.PName
    this.raw = raw
    this.value = raw
    this.end = this.#absolute
  }

  /** Unicode escape as one isolated step of the Scanner state machine. */
  async #unicodeEscape(): Promise<{ readonly raw: string; readonly value: string }> {
    const kind = await this.#take()
    if (kind !== 'u' && kind !== 'U') throw this.error('turtle-unicode', 'Expected Unicode escape.')
    const width = kind === 'u' ? 4 : 8
    let hex = ''
    for (let i = 0; i < width; i++) {
      const char = await this.#take()
      if (char === undefined || !/[0-9A-Fa-f]/.test(char)) throw this.error('turtle-unicode', 'Invalid Unicode escape.')
      hex += char
    }
    const point = Number.parseInt(hex, 16)
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      throw this.error('turtle-unicode', 'Unicode escape is not a Unicode scalar value.')
    }
    return { raw: `${kind}${hex}`, value: String.fromCodePoint(point) }
  }

  /** Reads the next buffered source value without consuming it. */
  async #peek(offset = 0): Promise<string | undefined> {
    await this.#fill(offset + 1)
    return this.#buffer[this.#index + offset]
  }

  /** Consumes and returns the next buffered source value. */
  async #take(): Promise<string | undefined> {
    await this.#fill(1)
    const char = this.#buffer[this.#index]
    if (char === undefined) return undefined
    this.#index++
    this.#absolute++
    if (char === '\n') {
      this.#line++
      this.#column = 1
    } else {
      this.#column++
    }
    if (this.#index >= COMPACT_THRESHOLD) this.#compact()
    return char
  }

  /** Refills the buffered source window only when the current window is exhausted. */
  async #fill(required: number): Promise<void> {
    while (!this.#done && this.#buffer.length - this.#index < required) {
      const item = await this.#source.next()
      if (item.done) {
        this.#buffer += this.#decoder.decode()
        this.#done = true
        return
      }
      const chunk = item.value
      this.#buffer += typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk, { stream: true })
    }
  }

  /** Compacts consumed source data while preserving every unread token byte. */
  #compact(): void {
    this.#buffer = this.#buffer.slice(this.#index)
    this.#index = 0
  }

  /** Rewinds the scanner by the one token position required by grammar lookahead. */
  #rewindOne(expected: string): void {
    // Rewind is only used for a trailing dot in names/blank labels. Such a dot
    // cannot be a newline, so line tracking remains unchanged.
    if (this.#index === 0 || this.#buffer[this.#index - 1] !== expected) {
      throw new Error('Scanner rewind invariant failed.')
    }
    this.#index--
    this.#absolute--
    this.#column--
  }

  /** Releases the underlying chunk iterator so Web Streams cancel on early parser return. */
  async close(): Promise<void> {
    await this.#source.return(undefined)
  }

  /** Applies configured parser resource limits before accepting more input. */
  #guard(start: number): void {
    if (this.#absolute - start > this.maxTokenLength) {
      throw this.error('turtle-token-limit', `Token exceeds maxTokenLength (${this.maxTokenLength}).`)
    }
  }
}

/** RDF 1.2 Turtle/TriG semantic parser over the transient scanner state. */
class Parser {
  readonly scanner: Scanner
  readonly options: CompactOptions
  readonly allowGraphs: boolean
  readonly prefixes = new Map<string, string>()
  readonly maxDepth: number
  readonly maxStatementEvents: number
  baseIri: string | undefined
  version: CompactVersion | undefined
  #generated = 0
  #started = false

  /** Creates semantic Turtle/TriG parser state with isolated prefixes, base IRI, graph, and statement buffers. */
  constructor(source: TextSource, options: CompactOptions, allowGraphs: boolean) {
    this.scanner = new Scanner(source, options)
    this.options = options
    this.allowGraphs = allowGraphs
    this.baseIri = options.baseIri
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    this.maxStatementEvents = options.maxStatementEvents ?? DEFAULT_MAX_STATEMENT_EVENTS
  }

  /** Parses the complete document and yields semantic/directive events. */
  async *events(): AsyncGenerator<CompactEvent> {
    try {
    if (!this.#started) {
      this.#started = true
      await this.scanner.next()
    }

    while (this.#kind() !== Kind.Eof) {
      throwIfAborted(this.options.signal)
      if (isDirective(this.#kind())) {
        try {
          yield await this.#directive()
        } catch (error) {
          if (!this.options.tolerant) throw error
          yield { kind: 'diagnostic', diagnostic: this.#diagnostic(error) }
          await this.#recoverTop()
        }
        continue
      }

      if (this.allowGraphs && this.#kind() === Kind.Graph) {
        await this.#advance()
        const graph = await this.#graphLabel(0)
        if (this.#kind() !== Kind.LBrace) {
          const error = this.scanner.error('trig-graph-open', "Expected '{' after GRAPH label.")
          if (!this.options.tolerant) throw error
          yield { kind: 'diagnostic', diagnostic: this.#diagnostic(error) }
          await this.#recoverTop()
          continue
        }
        yield* this.#graphBlock(graph)
        continue
      }

      if (this.allowGraphs && this.#kind() === Kind.LBrace) {
        yield* this.#graphBlock(defaultGraph())
        continue
      }

      if (this.allowGraphs && this.#kind() === Kind.LBracket) {
        yield* this.#trigBracket()
        continue
      }

      if (this.allowGraphs && isGraphLabelStart(this.#kind())) {
        const range = this.scanner.range()
        const lead = await this.#graphLabel(0)
        if (this.#kind() === Kind.LBrace) {
          yield* this.#graphBlock(lead)
          continue
        }
        yield* this.#statement(defaultGraph(), lead, range)
        continue
      }

      yield* this.#statement(defaultGraph())
    }
    } finally {
      await this.scanner.close()
    }
  }

  /**
   * Parses a top-level TriG `[` construct without confusing a blank-node
   * property list with the empty anonymous blank node allowed as a graph name.
   *
   * TriG graph labels may use `[]`, but `[ :p :o ]` is a Turtle subject. The
   * distinction is only visible after the opening bracket, so it cannot be
   * decided by the one-token lookahead in {@link Scanner}.
   */
  async *#trigBracket(): AsyncGenerator<CompactEvent> {
    const start = this.scanner.range()
    await this.#advance()
    const node = this.#fresh()

    if (this.#kind() === Kind.RBracket) {
      await this.#advance()
      if (this.#kind() === Kind.LBrace) {
        yield* this.#graphBlock(node)
        return
      }
      yield* this.#statement(defaultGraph(), node, start)
      return
    }

    if (!this.options.tolerant) {
      yield* this.#trigPropertyStatement(node, start)
      return
    }

    const buffered: CompactEvent[] = []
    try {
      for await (const event of this.#trigPropertyStatement(node, start)) {
        buffered.push(event)
        if (buffered.length > this.maxStatementEvents) {
          throw this.scanner.error('turtle-event-limit', `Statement exceeds maxStatementEvents (${this.maxStatementEvents}).`)
        }
      }
      yield* buffered
    } catch (error) {
      yield { kind: 'diagnostic', diagnostic: this.#diagnostic(error) }
      await this.#recoverStatement()
    }
  }

  /** Parses the remainder of a non-empty top-level blank-node property-list statement. */
  async *#trigPropertyStatement(node: Subject, start: CompactRange): AsyncGenerator<CompactEvent> {
    yield* this.#predicateObjectList(node, defaultGraph(), 1, start, Kind.RBracket)
    if (this.#kind() !== Kind.RBracket) {
      throw this.scanner.error('turtle-property-list-end', "Expected ']' to close blank-node property list.")
    }
    await this.#advance()
    if (this.#kind() !== Kind.Dot) {
      yield* this.#predicateObjectList(node, defaultGraph(), 0, start)
    }
    await this.#expectDot()
  }

  /** Graph block as one isolated step of the Parser state machine. */
  async *#graphBlock(graph: Graph): AsyncGenerator<CompactEvent> {
    if (this.#kind() !== Kind.LBrace) throw this.scanner.error('trig-graph-open', "Expected '{' to start graph block.")
    await this.#advance()

    while (this.#kind() !== Kind.RBrace && this.#kind() !== Kind.Eof) {
      yield* this.#statement(graph)
    }

    if (this.#kind() !== Kind.RBrace) throw this.scanner.error('trig-graph-end', "Expected '}' to close graph block.")
    await this.#advance()
  }

  /** Statement as one isolated step of the Parser state machine. */
  async *#statement(graph: Graph, lead?: Subject, leadRange?: CompactRange): AsyncGenerator<CompactEvent> {
    if (!this.options.tolerant) {
      yield* this.#statementStrict(graph, lead, leadRange)
      return
    }

    const buffered: CompactEvent[] = []
    try {
      for await (const event of this.#statementStrict(graph, lead, leadRange)) {
        buffered.push(event)
        if (buffered.length > this.maxStatementEvents) {
          throw this.scanner.error('turtle-event-limit', `Statement exceeds maxStatementEvents (${this.maxStatementEvents}).`)
        }
      }
      yield* buffered
    } catch (error) {
      yield { kind: 'diagnostic', diagnostic: this.#diagnostic(error) }
      await this.#recoverStatement()
    }
  }

  /** Statement strict as one isolated step of the Parser state machine. */
  async *#statementStrict(graph: Graph, lead?: Subject, leadRange?: CompactRange): AsyncGenerator<CompactEvent> {
    const range = leadRange ?? this.scanner.range()
    let subject: Subject

    if (lead !== undefined) {
      subject = lead
    } else if (this.#kind() === Kind.LBracket) {
      subject = yield* this.#blankPropertyList(graph, 0)
      if (this.#kind() !== Kind.Dot) {
        yield* this.#predicateObjectList(subject, graph, 0)
      }
      await this.#expectDot()
      return
    } else if (this.#kind() === Kind.ReifiedStart) {
      subject = yield* this.#reified(graph, 0)
      if (this.#kind() !== Kind.Dot) yield* this.#predicateObjectList(subject, graph, 0)
      await this.#expectDot()
      return
    } else {
      subject = yield* this.#subject(graph, 0)
    }

    yield* this.#predicateObjectList(subject, graph, 0, range)
    await this.#expectDot()
  }

  /** Predicate object list as one isolated step of the Parser state machine. */
  async *#predicateObjectList(
    subject: Subject,
    graph: Graph,
    depth: number,
    statementRange?: CompactRange,
    terminator?: Kind,
  ): AsyncGenerator<CompactEvent> {
    this.#depth(depth)
    while (true) {
      const predicate = await this.#verb()
      yield* this.#objectList(subject, predicate, graph, depth + 1, statementRange)

      if (this.#kind() !== Kind.Semicolon) return
      do await this.#advance()
      while (this.#kind() === Kind.Semicolon)
      if (terminator !== undefined && this.#kind() === terminator) return
      if (this.#kind() === Kind.Dot || this.#kind() === Kind.RBracket || this.#kind() === Kind.AnnotationEnd) return
    }
  }

  /** Object list as one isolated step of the Parser state machine. */
  async *#objectList(
    subject: Subject,
    predicate: Predicate,
    graph: Graph,
    depth: number,
    statementRange?: CompactRange,
  ): AsyncGenerator<CompactEvent> {
    while (true) {
      const start = statementRange ?? this.scanner.range()
      const object = yield* this.#object(graph, depth)
      const asserted = quad(subject, predicate, object, graph)
      yield { kind: 'quad', quad: asserted, range: mergeRange(start, this.scanner.range()) }
      yield* this.#annotations(asserted, graph, depth + 1)
      if (this.#kind() !== Kind.Comma) return
      await this.#advance()
    }
  }

  /** Annotations as one isolated step of the Parser state machine. */
  async *#annotations(asserted: Quad, graph: Graph, depth: number): AsyncGenerator<CompactEvent> {
    this.#depth(depth)
    const tripleTerm = triple(asserted.subject, asserted.predicate, asserted.object)
    let activeReifier: Subject | undefined

    while (this.#kind() === Kind.Tilde || this.#kind() === Kind.AnnotationStart) {
      if (this.#kind() === Kind.Tilde) {
        const start = this.scanner.range()
        await this.#advance()
        activeReifier = isIriStart(this.#kind()) || isBlankStartKind(this.#kind())
          ? await this.#reifierTerm()
          : this.#fresh()
        yield {
          kind: 'quad',
          quad: quad(activeReifier, namedNode(RDF.reifies), tripleTerm, graph),
          range: mergeRange(start, this.scanner.range()),
        }
        if (this.#kind() !== Kind.AnnotationStart) {
          activeReifier = undefined
          continue
        }
      }

      if (this.#kind() === Kind.AnnotationStart) {
        const start = this.scanner.range()
        const reifier = activeReifier ?? this.#fresh()
        if (activeReifier === undefined) {
          yield {
            kind: 'quad',
            quad: quad(reifier, namedNode(RDF.reifies), tripleTerm, graph),
            range: start,
          }
        }
        await this.#advance()
        yield* this.#predicateObjectList(reifier, graph, depth + 1, start, Kind.AnnotationEnd)
        if (this.#kind() !== Kind.AnnotationEnd) {
          throw this.scanner.error('turtle-annotation-end', "Expected '|}' to close annotation block.")
        }
        await this.#advance()
        activeReifier = undefined
      }
    }
  }

  /** Subject as one isolated step of the Parser state machine. */
  async *#subject(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Subject> {
    this.#depth(depth)
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LParen) return yield* this.#collection(graph, depth + 1)
    throw this.scanner.error('turtle-subject', 'Expected IRI, blank node, or collection as Turtle subject.')
  }

  /** Object as one isolated step of the Parser state machine. */
  async *#object(graph: Graph, depth: number): AsyncGenerator<CompactEvent, ObjectTerm> {
    this.#depth(depth)
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LBracket) return yield* this.#blankPropertyList(graph, depth + 1)
    if (this.#kind() === Kind.LParen) return yield* this.#collection(graph, depth + 1)
    if (this.#kind() === Kind.String || this.#kind() === Kind.Number || this.#kind() === Kind.True || this.#kind() === Kind.False) {
      return await this.#literal()
    }
    if (this.#kind() === Kind.TripleStart) return yield* this.#tripleTerm(graph, depth + 1)
    if (this.#kind() === Kind.ReifiedStart) return yield* this.#reified(graph, depth + 1)
    throw this.scanner.error('turtle-object', 'Expected Turtle RDF object.')
  }

  /** Collection as one isolated step of the Parser state machine. */
  async *#collection(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Subject> {
    this.#depth(depth)
    const start = this.scanner.range()
    if (this.#kind() !== Kind.LParen) throw this.scanner.error('turtle-collection', "Expected '(' to start collection.")
    await this.#advance()
    if (this.#kind() === Kind.RParen) {
      await this.#advance()
      return namedNode(RDF.nil)
    }

    const head = this.#fresh()
    let current = head
    while (this.#kind() !== Kind.RParen) {
      if (this.#kind() === Kind.Eof) throw this.scanner.error('turtle-collection-end', "Expected ')' to close collection.")
      const object = yield* this.#object(graph, depth + 1)
      yield { kind: 'quad', quad: quad(current, namedNode(RDF.first), object, graph), range: start }
      if (this.#kind() === Kind.RParen) {
        yield { kind: 'quad', quad: quad(current, namedNode(RDF.rest), namedNode(RDF.nil), graph), range: start }
        break
      }
      const next = this.#fresh()
      yield { kind: 'quad', quad: quad(current, namedNode(RDF.rest), next, graph), range: start }
      current = next
    }
    await this.#advance()
    return head
  }

  /** Blank property list as one isolated step of the Parser state machine. */
  async *#blankPropertyList(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Subject> {
    this.#depth(depth)
    if (this.#kind() !== Kind.LBracket) throw this.scanner.error('turtle-property-list', "Expected '['.")
    const start = this.scanner.range()
    await this.#advance()
    const node = this.#fresh()
    if (this.#kind() === Kind.RBracket) {
      await this.#advance()
      return node
    }
    yield* this.#predicateObjectList(node, graph, depth + 1, start, Kind.RBracket)
    if (this.#kind() !== Kind.RBracket) throw this.scanner.error('turtle-property-list-end', "Expected ']' to close blank-node property list.")
    await this.#advance()
    return node
  }

  /** Triple term as one isolated step of the Parser state machine. */
  async *#tripleTerm(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Quad> {
    this.#depth(depth)
    if (this.#kind() !== Kind.TripleStart) throw this.scanner.error('turtle-triple-term', "Expected '<<('.")
    await this.#advance()
    const subject = await this.#tripleSubject()
    const predicate = await this.#verb()
    const object = yield* this.#tripleObject(graph, depth + 1)
    if (this.#kind() !== Kind.TripleEnd) throw this.scanner.error('turtle-triple-term-end', "Expected ')>>' after triple term.")
    await this.#advance()
    return triple(subject, predicate, object)
  }

  /** Reified as one isolated step of the Parser state machine. */
  async *#reified(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Subject> {
    this.#depth(depth)
    const start = this.scanner.range()
    if (this.#kind() !== Kind.ReifiedStart) throw this.scanner.error('turtle-reified', "Expected '<<'.")
    await this.#advance()
    const subject = yield* this.#reifiedSubject(graph, depth + 1)
    const predicate = await this.#verb()
    const object = yield* this.#reifiedObject(graph, depth + 1)
    let reifier: Subject | undefined
    if (this.#kind() === Kind.Tilde) {
      await this.#advance()
      reifier = isIriStart(this.#kind()) || isBlankStartKind(this.#kind())
        ? await this.#reifierTerm()
        : this.#fresh()
    }
    if (this.#kind() !== Kind.ReifiedEnd) throw this.scanner.error('turtle-reified-end', "Expected '>>' after reified triple.")
    await this.#advance()
    const value = reifier ?? this.#fresh()
    yield {
      kind: 'quad',
      quad: quad(value, namedNode(RDF.reifies), triple(subject, predicate, object), graph),
      range: mergeRange(start, this.scanner.range()),
    }
    return value
  }

  /** Reified subject as one isolated step of the Parser state machine. */
  async *#reifiedSubject(graph: Graph, depth: number): AsyncGenerator<CompactEvent, Subject> {
    if (isIriStart(this.#kind())) return await this.#iri()
    if (isBlankStartKind(this.#kind())) return await this.#reifierTerm()
    if (this.#kind() === Kind.ReifiedStart) return yield* this.#reified(graph, depth + 1)
    throw this.scanner.error('turtle-reified-subject', 'Expected IRI, blank node, or nested reified triple.')
  }

  /** Reified object as one isolated step of the Parser state machine. */
  async *#reifiedObject(graph: Graph, depth: number): AsyncGenerator<CompactEvent, ObjectTerm> {
    if (isIriStart(this.#kind())) return await this.#iri()
    if (isBlankStartKind(this.#kind())) return await this.#reifierTerm()
    if (this.#kind() === Kind.String || this.#kind() === Kind.Number || this.#kind() === Kind.True || this.#kind() === Kind.False) return await this.#literal()
    if (this.#kind() === Kind.TripleStart) return yield* this.#tripleTerm(graph, depth + 1)
    if (this.#kind() === Kind.ReifiedStart) return yield* this.#reified(graph, depth + 1)
    throw this.scanner.error('turtle-reified-object', 'Expected RDF term allowed in a reified triple object.')
  }

  /** Triple object as one isolated step of the Parser state machine. */
  async *#tripleObject(graph: Graph, depth: number): AsyncGenerator<CompactEvent, ObjectTerm> {
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LBracket) return await this.#anonymous()
    if (this.#kind() === Kind.String || this.#kind() === Kind.Number || this.#kind() === Kind.True || this.#kind() === Kind.False) return await this.#literal()
    if (this.#kind() === Kind.TripleStart) return yield* this.#tripleTerm(graph, depth + 1)
    throw this.scanner.error('turtle-triple-object', 'Expected RDF term allowed in a triple-term object.')
  }

  /** Triple subject as one isolated step of the Parser state machine. */
  async #tripleSubject(): Promise<Subject> {
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LBracket) return await this.#anonymous()
    throw this.scanner.error('turtle-triple-subject', 'Expected IRI or blank node in triple term.')
  }

  /** Verb as one isolated step of the Parser state machine. */
  async #verb(): Promise<Predicate> {
    if (this.#kind() === Kind.A) {
      await this.#advance()
      return namedNode(RDF.type)
    }
    return await this.#iri()
  }

  /** Literal as one isolated step of the Parser state machine. */
  async #literal(): Promise<Literal> {
    if (this.#kind() === Kind.True || this.#kind() === Kind.False) {
      const raw = this.scanner.raw
      await this.#advance()
      return literal(raw, namedNode(XSD.boolean))
    }
    if (this.#kind() === Kind.Number) {
      const raw = this.scanner.raw
      const datatype = numericKind(raw)
      if (!datatype) throw this.scanner.error('turtle-number', `Invalid numeric literal '${raw}'.`)
      await this.#advance()
      return literal(raw, namedNode(datatype))
    }
    if (this.#kind() !== Kind.String) throw this.scanner.error('turtle-literal', 'Expected RDF literal.')
    const value = this.scanner.value
    await this.#advance()
    if (this.#kind() === Kind.Lang) {
      const raw = this.scanner.value
      await this.#advance()
      const marker = raw.lastIndexOf('--')
      if (marker > 0) {
        const language = raw.slice(0, marker)
        const direction = raw.slice(marker + 2).toLowerCase()
        if (direction !== 'ltr' && direction !== 'rtl') {
          throw this.scanner.error('turtle-direction', `Initial text direction must be ltr or rtl, got '${direction}'.`)
        }
        return literal(value, { language, direction })
      }
      return literal(value, raw)
    }
    if (this.#kind() === Kind.HatHat) {
      await this.#advance()
      return literal(value, await this.#iri())
    }
    return literal(value)
  }

  /** Directive as one isolated step of the Parser state machine. */
  async #directive(): Promise<Exclude<CompactEvent, { readonly kind: 'quad' | 'diagnostic' }>> {
    const kind = this.#kind()
    const raw = this.scanner.raw
    const start = this.scanner.range()
    const oldStyle = raw.startsWith('@')
    await this.#advance()

    if (kind === Kind.Prefix) {
      if (this.#kind() !== Kind.PName || !this.scanner.raw.endsWith(':')) {
        throw this.scanner.error('turtle-prefix-name', 'PREFIX requires a prefix label ending in colon.')
      }
      const prefix = this.scanner.raw.slice(0, -1)
      await this.#advance()
      if (this.#kind() !== Kind.Iri) throw this.scanner.error('turtle-prefix-iri', 'PREFIX requires an IRI reference.')
      const iri = this.#resolve(this.scanner.value)
      await this.#advance()
      if (oldStyle) await this.#expectDot()
      this.prefixes.set(prefix, iri)
      return { kind: 'prefix', prefix, iri, range: mergeRange(start, this.scanner.range()) }
    }

    if (kind === Kind.Base) {
      if (this.#kind() !== Kind.Iri) throw this.scanner.error('turtle-base-iri', 'BASE requires an IRI reference.')
      const iri = this.#resolve(this.scanner.value)
      await this.#advance()
      if (oldStyle) await this.#expectDot()
      this.baseIri = iri
      return { kind: 'base', iri, range: mergeRange(start, this.scanner.range()) }
    }

    if (kind === Kind.Version) {
      if (this.#kind() !== Kind.String) throw this.scanner.error('turtle-version', 'VERSION requires a quoted RDF version label.')
      const version = this.scanner.value
      if (version !== '1.1' && version !== '1.2-basic' && version !== '1.2') {
        throw this.scanner.error('turtle-version', `Unsupported RDF version '${version}'.`)
      }
      await this.#advance()
      if (oldStyle) await this.#expectDot()
      this.version = version
      return { kind: 'version', version, range: mergeRange(start, this.scanner.range()) }
    }

    throw this.scanner.error('turtle-directive', 'Unsupported Turtle directive.')
  }

  /** Iri as one isolated step of the Parser state machine. */
  async #iri(): Promise<NamedNode> {
    if (this.#kind() === Kind.Iri) {
      const value = this.#resolve(this.scanner.value)
      await this.#advance()
      return namedNode(value)
    }
    if (this.#kind() === Kind.PName) {
      const raw = this.scanner.raw
      const colon = raw.indexOf(':')
      const prefix = raw.slice(0, colon)
      const local = decodeLocal(raw.slice(colon + 1))
      const base = this.prefixes.get(prefix)
      if (base === undefined) throw this.scanner.error('turtle-prefix', `Prefix '${prefix}' is not defined.`)
      await this.#advance()
      return namedNode(`${base}${local}`)
    }
    throw this.scanner.error('turtle-iri', 'Expected IRI reference or prefixed name.')
  }

  /** Graph label as one isolated step of the Parser state machine. */
  async #graphLabel(depth: number): Promise<Subject> {
    this.#depth(depth)
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LBracket) return await this.#anonymous()
    throw this.scanner.error('trig-graph-label', 'Expected IRI or blank node as TriG graph label.')
  }

  /** Reifier term as one isolated step of the Parser state machine. */
  async #reifierTerm(): Promise<Subject> {
    if (isIriStart(this.#kind())) return await this.#iri()
    if (this.#kind() === Kind.Blank) return await this.#labelledBlank()
    if (this.#kind() === Kind.LBracket) return await this.#anonymous()
    throw this.scanner.error('turtle-reifier', 'Expected IRI or blank node as reifier.')
  }

  /** Labelled blank as one isolated step of the Parser state machine. */
  async #labelledBlank(): Promise<Subject> {
    if (this.#kind() !== Kind.Blank) throw this.scanner.error('turtle-blank', 'Expected blank node.')
    const value = `l${this.scanner.value.length}:${this.scanner.value}`
    await this.#advance()
    return blankNode(value)
  }

  /** Anonymous as one isolated step of the Parser state machine. */
  async #anonymous(): Promise<Subject> {
    if (this.#kind() !== Kind.LBracket) throw this.scanner.error('turtle-anon', "Expected '['.")
    await this.#advance()
    if (this.#kind() !== Kind.RBracket) throw this.scanner.error('turtle-anon', "Expected ']' for anonymous blank node.")
    await this.#advance()
    return this.#fresh()
  }

  /** Expect dot as one isolated step of the Parser state machine. */
  async #expectDot(): Promise<void> {
    if (this.#kind() !== Kind.Dot) throw this.scanner.error('turtle-period', "Expected '.' after Turtle statement.")
    await this.#advance()
  }

  /** Kind as one isolated step of the Parser state machine. */
  #kind(): Kind {
    return this.scanner.kind
  }

  /** Advance as one isolated step of the Parser state machine. */
  async #advance(): Promise<void> {
    await this.scanner.next()
  }

  /** Resolve as one isolated step of the Parser state machine. */
  #resolve(reference: string): string {
    try {
      if (this.baseIri !== undefined) return new URL(reference, this.baseIri).href
      return new URL(reference).href
    } catch {
      throw this.scanner.error('turtle-relative-iri', `Relative IRI '${reference}' requires a base IRI.`)
    }
  }

  /** Fresh as one isolated step of the Parser state machine. */
  #fresh(): Subject {
    return blankNode(`g:${++this.#generated}`)
  }

  /** Depth as one isolated step of the Parser state machine. */
  #depth(depth: number): void {
    if (depth > this.maxDepth) throw this.scanner.error('turtle-depth', `Nested Turtle syntax exceeds maxDepth (${this.maxDepth}).`)
  }

  /** Diagnostic as one isolated step of the Parser state machine. */
  #diagnostic(error: unknown): CompactDiagnostic {
    if (error instanceof CompactError) return { code: error.code, message: error.message, range: error.range }
    return {
      code: 'turtle-syntax',
      message: error instanceof Error ? error.message : String(error),
      range: this.scanner.range(),
    }
  }

  /** Recover statement as one isolated step of the Parser state machine. */
  async #recoverStatement(): Promise<void> {
    let square = 0
    let paren = 0
    let annotation = 0
    while (this.#kind() !== Kind.Eof) {
      if (this.#kind() === Kind.LBracket) square++
      else if (this.#kind() === Kind.RBracket) square = Math.max(0, square - 1)
      else if (this.#kind() === Kind.LParen) paren++
      else if (this.#kind() === Kind.RParen) paren = Math.max(0, paren - 1)
      else if (this.#kind() === Kind.AnnotationStart) annotation++
      else if (this.#kind() === Kind.AnnotationEnd) annotation = Math.max(0, annotation - 1)
      else if (this.#kind() === Kind.Dot && square === 0 && paren === 0 && annotation === 0) {
        await this.#advance()
        return
      } else if (this.allowGraphs && this.#kind() === Kind.RBrace && square === 0 && paren === 0 && annotation === 0) {
        return
      }
      await this.#advance()
    }
  }

  /** Recover top as one isolated step of the Parser state machine. */
  async #recoverTop(): Promise<void> {
    while (this.#kind() !== Kind.Eof) {
      if (this.#kind() === Kind.Dot) {
        await this.#advance()
        return
      }
      if (this.allowGraphs && this.#kind() === Kind.RBrace) {
        await this.#advance()
        return
      }
      await this.#advance()
    }
  }
}

/** Parses Turtle/TriG events; `allowGraphs` selects TriG graph syntax. */
export function parseCompact(source: TextSource, options: CompactOptions, allowGraphs: boolean): AsyncGenerator<CompactEvent> {
  return new Parser(source, options, allowGraphs).events()
}

/** Resolves one lexer numeric token to its RDF datatype. */
function numericKind(raw: string): string | undefined {
  if (/^[+-]?[0-9]+$/.test(raw)) return XSD.integer
  if (/^[+-]?(?:[0-9]*\.[0-9]+)$/.test(raw)) return XSD.decimal
  if (/^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))[eE][+-]?[0-9]+$/.test(raw)) return XSD.double
  return undefined
}

/** Returns whether the supplied value satisfies the directive contract. */
function isDirective(kind: Kind): boolean {
  return kind === Kind.Prefix || kind === Kind.Base || kind === Kind.Version
}

/** Returns whether the supplied value satisfies the iri start contract. */
function isIriStart(kind: Kind): boolean {
  return kind === Kind.Iri || kind === Kind.PName
}

/** Returns whether the supplied value satisfies the blank start kind contract. */
function isBlankStartKind(kind: Kind): boolean {
  return kind === Kind.Blank || kind === Kind.LBracket
}

/** Returns whether the supplied value satisfies the graph label start contract. */
function isGraphLabelStart(kind: Kind): boolean {
  return isIriStart(kind) || kind === Kind.Blank
}

/** Returns whether the supplied value satisfies the whitespace contract. */
function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/** Returns whether the supplied value satisfies the name start contract. */
function isNameStart(char: string): boolean {
  return /[A-Za-z_\u00C0-\uFFFF]/u.test(char)
}

/** Returns whether the supplied value satisfies the prefix char contract. */
function isPrefixChar(char: string): boolean {
  return /[A-Za-z0-9_.\-\u00B7-\uFFFF]/u.test(char)
}

/** Returns whether the supplied value satisfies the local char contract. */
function isLocalChar(char: string): boolean {
  return /[A-Za-z0-9_.:\-\u00B7-\uFFFF]/u.test(char)
}

/** Returns whether the supplied value satisfies the blank start contract. */
function isBlankStart(char: string): boolean {
  return /[A-Za-z0-9_\u00C0-\uFFFF]/u.test(char)
}

/** Returns whether the supplied value satisfies the blank char contract. */
function isBlankChar(char: string): boolean {
  return /[A-Za-z0-9_.\-\u00B7-\uFFFF]/u.test(char)
}

/** Returns whether the supplied value satisfies the local escape contract. */
function isLocalEscape(char: string): boolean {
  return "_~.-!$&'()*+,;=/?#@%".includes(char)
}

/** Decodes percent and PN_LOCAL escapes in a prefixed-name local part without changing the namespace IRI. */
function decodeLocal(value: string): string {
  return value.replace(/\\([_~.\-!$&'()*+,;=/?#@%])/g, '$1')
}

/** Decodes Turtle backslash escapes used in local names and string-like scanner values. */
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

/** Spans two source ranges so emitted semantic events retain the full originating syntax range. */
function mergeRange(start: CompactRange, end: CompactRange): CompactRange {
  return { start: start.start, end: Math.max(start.end, end.end), line: start.line, column: start.column }
}
