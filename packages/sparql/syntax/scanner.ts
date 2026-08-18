/** Data-oriented lexical scanner used by SPARQL syntax inspection. @module */

import { chunks, throwIfAborted } from './source.ts'
import type { OptionsType, RangeType, SourceType, TokenKindType, TokenType } from './types.ts'

/** Default max token length used when the caller does not provide an override. */
const DEFAULT_MAX_TOKEN_LENGTH = 8 * 1024 * 1024
/** Consumed UTF-16 units required before slicing the scanner buffer to bound retained source text. */
const COMPACT_THRESHOLD = 64 * 1024
/** Target buffered lookahead window that keeps the hot lexical loop synchronous across ordinary tokens. */
const REFILL_WINDOW = 16 * 1024

/** Numeric token kinds keep hot scanner state compact. This is not a public API. */
export const KindType = {
  Eof: 0,
  Keyword: 1,
  Variable: 2,
  Iri: 3,
  Prefixed: 4,
  Blank: 5,
  String: 6,
  LangDir: 7,
  Integer: 8,
  Decimal: 9,
  Double: 10,
  Boolean: 11,
  Punctuation: 12,
  Operator: 13,
  Marker: 14,
  Identifier: 15,
  Whitespace: 16,
  Comment: 17,
  Unknown: 18,
} as const

/** Stable lexical token-kind value emitted by the SPARQL scanner. */
export type KindType = (typeof KindType)[keyof typeof KindType]

/** Case-insensitive SPARQL keywords recognized separately from identifiers and prefixed names. */
const KEYWORDS = new Set([
  'ABS',
  'ADD',
  'ALL',
  'AS',
  'ASC',
  'ASK',
  'AVG',
  'BASE',
  'BIND',
  'BNODE',
  'BOUND',
  'BY',
  'CEIL',
  'CLEAR',
  'COALESCE',
  'CONCAT',
  'CONSTRUCT',
  'CONTAINS',
  'COPY',
  'COUNT',
  'CREATE',
  'DATATYPE',
  'DAY',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DESCRIBE',
  'DISTINCT',
  'DROP',
  'ENCODE_FOR_URI',
  'EXISTS',
  'FILTER',
  'FLOOR',
  'FROM',
  'GRAPH',
  'GROUP',
  'GROUP_CONCAT',
  'HAVING',
  'HOURS',
  'IF',
  'IN',
  'INSERT',
  'INTO',
  'IRI',
  'ISBLANK',
  'ISIRI',
  'ISLITERAL',
  'ISNUMERIC',
  'ISTRIPLE',
  'ISURI',
  'LCASE',
  'LIMIT',
  'LOAD',
  'MAX',
  'MD5',
  'MIN',
  'MINUS',
  'MINUTES',
  'MONTH',
  'MOVE',
  'NAMED',
  'NOT',
  'NOW',
  'OBJECT',
  'OFFSET',
  'OPTIONAL',
  'ORDER',
  'PREDICATE',
  'PREFIX',
  'RAND',
  'REDUCED',
  'REGEX',
  'REPLACE',
  'SAMPLE',
  'SELECT',
  'SEPARATOR',
  'SERVICE',
  'SHA1',
  'SHA256',
  'SHA384',
  'SHA512',
  'SILENT',
  'STR',
  'STRAFTER',
  'STRBEFORE',
  'STRDT',
  'STRENDS',
  'STRLANG',
  'STRLANGDIR',
  'STRLEN',
  'STRSTARTS',
  'SUBJECT',
  'SUBSTR',
  'SUM',
  'TIMEZONE',
  'TO',
  'TRIPLE',
  'TRUE',
  'TZ',
  'UCASE',
  'UNDEF',
  'UNION',
  'URI',
  'USING',
  'UUID',
  'VALUES',
  'VERSION',
  'WHERE',
  'WITH',
  'YEAR',
  'LANG',
  'LANGDIR',
  'LANGMATCHES',
  'HASLANG',
  'HASLANGDIR',
  'FALSE',
])

/** Position-aware lexical failure used by strict mode and converted in tolerant mode. */
export class SyntaxScanError extends SyntaxError {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code: string
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: RangeType

  /** Creates a source-ranged lexical failure that the event layer can surface as a diagnostic. */
  constructor(code: string, message: string, range: RangeType) {
    super(message)
    this.name = 'SparqlSyntaxScanError'
    this.code = code
    this.range = range
  }
}

/**
 * Incremental UTF-8 scanner with one mutable token record.
 *
 * Character classification is synchronous while bytes are already buffered.
 * The scanner awaits only when it must refill the current source window. This
 * preserves streaming and hostile chunk-split behavior without a Promise per
 * character. Consumed source is compacted to cap retained text.
 */
export class Scanner {
  /** Current lexical token class. `Eof` means no token is currently available. */
  kind: KindType = KindType.Eof
  /** Decoded token value used by syntax inspection; `raw` preserves the exact source spelling. */
  value = ''
  /** Exact source text consumed for this token before semantic decoding. */
  raw = ''
  /** Zero-based source offset where this record starts. */
  start = 0
  /** Exclusive zero-based source offset where this record ends. */
  end = 0
  /** One-based source line containing the start of this record. */
  line = 1
  /** One-based source column containing the start of this record. */
  column = 1
  /** One-based source line at the exclusive end of the current token. */
  endLine = 1
  /** One-based source column at the exclusive end of the current token. */
  endColumn = 1

  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal: AbortSignal | undefined
  /** Whether this token is whitespace or a comment that does not affect SPARQL grammar. */
  readonly trivia: boolean
  /** Maximum token length accepted before the scanner reports a configured limit. */
  readonly maxTokenLength: number

  /** Input source currently owned by this parser or scanner until it is consumed or canceled. */
  #source: AsyncGenerator<string | Uint8Array>
  /** Streaming text decoder that preserves partial UTF-8 sequences between source chunks. */
  #decoder = new TextDecoder('utf-8', { fatal: true })
  /** Retained unread source text. Compaction removes consumed prefixes to keep memory bounded. */
  #buffer = ''
  /** Current lookup or cursor index used to avoid rescanning already consumed state. */
  #index = 0
  /** Absolute source offset corresponding to the start of the retained scanner buffer. */
  #absolute = 0
  /** Current one-based source line maintained as the scanner consumes characters. */
  #line = 1
  /** Current one-based source column maintained as the scanner consumes characters. */
  #column = 1
  /** Whether the underlying source has reached its terminal end state. */
  #done = false

  /** Creates a buffered scanner whose hot character loop stays synchronous until a source refill is needed. */
  constructor(source: SourceType, options: OptionsType) {
    this.signal = options.signal
    this.trivia = options.trivia ?? false
    this.maxTokenLength = options.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH
    this.#source = chunks(source, options.signal)
  }

  /** Advances to the next lexical token. */
  async next(): Promise<void> {
    throwIfAborted(this.signal)
    await this.#refill(3)

    if (this.trivia) {
      if (await this.#trivia()) return
    } else {
      await this.#skipTrivia()
    }

    await this.#refill(3)
    this.#mark()
    const first = this.#peek()
    if (first === undefined) {
      this.kind = KindType.Eof
      this.#finish()
      return
    }

    const three = `${first}${this.#peek(1) ?? ''}${this.#peek(2) ?? ''}`
    const two = three.slice(0, 2)

    if (three === '<<(') return this.#fixed(KindType.Marker, 3)
    if (three === ')>>') return this.#fixed(KindType.Marker, 3)
    if (two === '<<' || two === '>>' || two === '{|' || two === '|}') {
      return this.#fixed(KindType.Marker, 2)
    }
    if (
      two === '^^' || two === '!=' || two === '<=' || two === '>=' || two === '||' || two === '&&'
    ) {
      return this.#fixed(KindType.Operator, 2)
    }

    if (first === '?' || first === '$') {
      const second = this.#peek(1)
      if (second !== undefined && isVarStart(second)) return await this.#variable()
      return this.#fixed(KindType.Operator, 1)
    }

    if (first === '<') {
      if (await this.#looksLikeIri()) return await this.#iri()
      return this.#fixed(KindType.Operator, 1)
    }

    if (first === '"' || first === "'") return await this.#string(first)
    if (first === '@') return await this.#langDir()
    if (two === '_:') return await this.#blank()
    if (first === ':' || isPnStart(first)) return await this.#word()

    if (/[0-9]/.test(first) || first === '.' || first === '+' || first === '-') {
      if (await this.#number()) return
    }

    if ('{}()[];,'.includes(first) || first === '.') return this.#fixed(KindType.Punctuation, 1)
    if ('=<>+-*/!|^'.includes(first)) return this.#fixed(KindType.Operator, 1)
    if (first === '~') return this.#fixed(KindType.Marker, 1)

    this.#take()
    this.kind = KindType.Unknown
    this.value = first
    this.raw = first
    this.#finish()
  }

  /** Copies mutable scanner state into one stable public token. */
  token(): TokenType {
    return { kind: kindName(this.kind), value: this.value, raw: this.raw, range: this.range() }
  }

  /** Returns the absolute and line/column range for the current token record. */
  range(): RangeType {
    return {
      start: this.start,
      end: this.end,
      line: this.line,
      column: this.column,
      endLine: this.endLine,
      endColumn: this.endColumn,
    }
  }

  /** Creates a lexical error anchored at the current scanner token. */
  error(code: string, message: string): SyntaxScanError {
    return new SyntaxScanError(code, message, this.range())
  }

  /** Releases the upstream source when syntax iteration stops before EOF. */
  async close(): Promise<void> {
    await this.#source.return(undefined)
  }

  /** Trivia as one isolated step of the Scanner state machine. */
  async #trivia(): Promise<boolean> {
    this.#mark()
    let first = this.#peek()
    if (first === undefined && !this.#done) {
      await this.#refill()
      first = this.#peek()
    }
    if (first === undefined) return false

    if (isWhitespace(first)) {
      let raw = ''
      while (true) {
        let char = this.#peek()
        if (char === undefined && !this.#done) {
          await this.#refill()
          char = this.#peek()
        }
        if (char === undefined || !isWhitespace(char)) break
        raw += this.#take() ?? ''
      }
      this.kind = KindType.Whitespace
      this.value = raw
      this.raw = raw
      this.#finish()
      return true
    }

    if (first === '#') {
      let raw = ''
      while (true) {
        let char = this.#peek()
        if (char === undefined && !this.#done) {
          await this.#refill()
          char = this.#peek()
        }
        if (char === undefined || char === '\n' || char === '\r') break
        raw += this.#take() ?? ''
      }
      this.kind = KindType.Comment
      this.value = raw.slice(1)
      this.raw = raw
      this.#finish()
      return true
    }

    return false
  }

  /** Skips trivia in the current parser or scanner state. */
  async #skipTrivia(): Promise<void> {
    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill()
        char = this.#peek()
      }
      if (char === undefined) return
      if (isWhitespace(char)) {
        this.#take()
        continue
      }
      if (char === '#') {
        while (true) {
          let item = this.#peek()
          if (item === undefined && !this.#done) {
            await this.#refill()
            item = this.#peek()
          }
          if (item === undefined || item === '\n' || item === '\r') break
          this.#take()
        }
        continue
      }
      return
    }
  }

  /** Fixed as one isolated step of the Scanner state machine. */
  #fixed(kind: KindType, width: number): void {
    let raw = ''
    for (let i = 0; i < width; i++) raw += this.#take() ?? ''
    this.kind = kind
    this.value = raw
    this.raw = raw
    this.#finish()
  }

  /** Variable as one isolated step of the Scanner state machine. */
  async #variable(): Promise<void> {
    const mark = this.#absolute
    let raw = this.#take() ?? ''
    let value = ''
    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill()
        char = this.#peek()
      }
      if (char === undefined || !isVarContinue(char)) break
      raw += this.#take() ?? ''
      value += char
      this.#guard(mark)
    }
    this.kind = KindType.Variable
    this.value = value
    this.raw = raw
    this.#finish()
  }

  /** Looks like iri as one isolated step of the Scanner state machine. */
  async #looksLikeIri(): Promise<boolean> {
    let offset = 1
    while (offset <= this.maxTokenLength) {
      if (this.#peek(offset) === undefined && !this.#done) await this.#refill(offset + 1)
      const char = this.#peek(offset)
      if (char === undefined) return false
      if (char === '>') return true
      if (char === '\\') {
        if (this.#peek(offset + 1) === undefined && !this.#done) await this.#refill(offset + 10)
        const marker = this.#peek(offset + 1)
        if (marker !== 'u' && marker !== 'U') return false
        offset += marker === 'u' ? 6 : 10
        continue
      }
      if (char <= ' ' || /[<>"{}|^`]/.test(char)) return false
      offset++
    }
    throw this.error('sparql-token-limit', `IRI token exceeds ${this.maxTokenLength} code units.`)
  }

  /** Iri as one isolated step of the Scanner state machine. */
  async #iri(): Promise<void> {
    const mark = this.#absolute
    let raw = this.#take() ?? ''
    let value = ''
    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill()
        char = this.#peek()
      }
      if (char === undefined) {
        throw this.error('sparql-iri-end', 'Unterminated SPARQL IRI reference.')
      }
      if (char === '>') {
        raw += this.#take() ?? ''
        break
      }
      if (char === '\\') {
        raw += this.#take() ?? ''
        const escape = await this.#unicode()
        raw += escape.raw
        value += escape.value
        continue
      }
      raw += this.#take() ?? ''
      value += char
      this.#guard(mark)
    }
    this.kind = KindType.Iri
    this.value = value
    this.raw = raw
    this.#finish()
  }

  /** String as one isolated step of the Scanner state machine. */
  async #string(quote: string): Promise<void> {
    await this.#refill(3)
    const mark = this.#absolute
    const long = this.#peek(1) === quote && this.#peek(2) === quote
    const width = long ? 3 : 1
    let raw = ''
    for (let i = 0; i < width; i++) raw += this.#take() ?? ''
    let value = ''

    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill(3)
        char = this.#peek()
      }
      if (char === undefined) {
        throw this.error('sparql-string-end', 'Unterminated SPARQL string literal.')
      }
      if (char === quote) {
        if (long) {
          if (this.#peek(2) === undefined && !this.#done) await this.#refill(3)
          if (this.#peek(1) === quote && this.#peek(2) === quote) {
            for (let i = 0; i < 3; i++) raw += this.#take() ?? ''
            break
          }
        } else {
          raw += this.#take() ?? ''
          break
        }
      }
      if (!long && (char === '\n' || char === '\r')) {
        throw this.error(
          'sparql-string-line',
          'Short SPARQL string literals cannot contain line breaks.',
        )
      }
      if (char === '\\') {
        raw += this.#take() ?? ''
        if (this.#peek() === undefined && !this.#done) await this.#refill(9)
        const next = this.#peek()
        if (next === 'u' || next === 'U') {
          const escape = await this.#unicode()
          raw += escape.raw
          value += escape.value
          continue
        }
        if (next === undefined || !'tbnrf"\'\\'.includes(next)) {
          throw this.error('sparql-string-escape', 'Invalid SPARQL string escape.')
        }
        raw += this.#take() ?? ''
        value += escaped(next)
        continue
      }
      raw += this.#take() ?? ''
      value += char
      this.#guard(mark)
    }

    this.kind = KindType.String
    this.value = value
    this.raw = raw
    this.#finish()
  }

  /** Lang dir as one isolated step of the Scanner state machine. */
  async #langDir(): Promise<void> {
    const mark = this.#absolute
    let raw = this.#take() ?? ''
    let value = ''
    let sawLetter = false

    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill()
        char = this.#peek()
      }
      if (char === undefined || !/[A-Za-z0-9-]/.test(char)) break
      raw += this.#take() ?? ''
      value += char
      if (/[A-Za-z]/.test(char)) sawLetter = true
      this.#guard(mark)
    }

    this.kind = sawLetter && /^[A-Za-z]+(?:-[A-Za-z0-9]+)*(?:--[A-Za-z]+)?$/.test(value)
      ? KindType.LangDir
      : KindType.Unknown
    this.value = value
    this.raw = raw
    this.#finish()
  }

  /** Blank as one isolated step of the Scanner state machine. */
  async #blank(): Promise<void> {
    const mark = this.#absolute
    let raw = `${this.#take() ?? ''}${this.#take() ?? ''}`
    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill()
        char = this.#peek()
      }
      if (char === undefined || isDelimiter(char)) break
      raw += this.#take() ?? ''
      this.#guard(mark)
    }
    this.kind = raw.length > 2 ? KindType.Blank : KindType.Unknown
    this.value = raw.slice(2)
    this.raw = raw
    this.#finish()
  }

  /** Word as one isolated step of the Scanner state machine. */
  async #word(): Promise<void> {
    const mark = this.#absolute
    let raw = ''
    let escapedLocal = false

    while (true) {
      let char = this.#peek()
      if (char === undefined && !this.#done) {
        await this.#refill(3)
        char = this.#peek()
      }
      if (char === undefined || isDelimiter(char)) break
      if (char === '\\') {
        if (this.#peek(1) === undefined && !this.#done) await this.#refill(2)
        const next = this.#peek(1)
        if (next === undefined || !"_~.-!$&'()*+,;=/?#@%".includes(next)) break
        raw += `${this.#take() ?? ''}${this.#take() ?? ''}`
        escapedLocal = true
        this.#guard(mark)
        continue
      }
      if (char === '%') {
        if (this.#peek(2) === undefined && !this.#done) await this.#refill(3)
        if (isHex(this.#peek(1)) && isHex(this.#peek(2))) {
          raw += `${this.#take() ?? ''}${this.#take() ?? ''}${this.#take() ?? ''}`
          escapedLocal = true
          this.#guard(mark)
          continue
        }
      }
      if (!isPnContinue(char)) break
      raw += this.#take() ?? ''
      this.#guard(mark)
    }

    if (raw.includes(':')) {
      this.kind = KindType.Prefixed
      this.value = raw
    } else if (!escapedLocal && raw === 'a') {
      this.kind = KindType.Keyword
      this.value = raw
    } else {
      const upper = raw.toUpperCase()
      if (KEYWORDS.has(upper)) {
        this.kind = upper === 'TRUE' || upper === 'FALSE' ? KindType.Boolean : KindType.Keyword
        this.value = upper === 'TRUE' || upper === 'FALSE' ? raw.toLowerCase() : upper
      } else {
        this.kind = KindType.Identifier
        this.value = raw
      }
    }
    this.raw = raw
    this.#finish()
  }

  /** Attempts numeric maximal munch without consuming adjacent arithmetic operators. */
  async #number(): Promise<boolean> {
    await this.#refill(128)
    let candidate = ''
    for (let offset = 0; offset < 128; offset++) {
      const char = this.#peek(offset)
      if (char === undefined || !/[0-9eE+.-]/.test(char)) break
      candidate += char
    }

    const matches: Array<{
      /** Discriminates the concrete matches variant. */
      kind: KindType
      /** Source text matched by the candidate scanner token. */
      match: string
    }> = []
    const double = candidate.match(/^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))[eE][+-]?[0-9]+/)
      ?.[0]
    const decimal = candidate.match(/^[+-]?[0-9]*\.[0-9]+/)?.[0]
    const integer = candidate.match(/^[+-]?[0-9]+/)?.[0]
    if (double) matches.push({ kind: KindType.Double, match: double })
    if (decimal) matches.push({ kind: KindType.Decimal, match: decimal })
    if (integer) matches.push({ kind: KindType.Integer, match: integer })

    let chosen: {
      /** Discriminates the concrete chosen variant. */
      kind: KindType
      /** Source text matched by the candidate scanner token. */
      match: string
    } | undefined
    for (const entry of matches) {
      if (!chosen || entry.match.length > chosen.match.length) chosen = entry
    }
    if (!chosen) return false

    this.#mark()
    let raw = ''
    for (let i = 0; i < chosen.match.length; i++) raw += this.#take() ?? ''
    this.kind = chosen.kind
    this.value = raw
    this.raw = raw
    this.#finish()
    return true
  }

  /** Unicode as one isolated step of the Scanner state machine. */
  async #unicode(): Promise<{
    /** Original escaped source spelling before decoding or normalization. */
    raw: string
    /** Unicode scalar decoded from the SPARQL escape sequence. */
    value: string
  }> {
    await this.#refill(9)
    const marker = this.#take()
    if (marker !== 'u' && marker !== 'U') {
      throw this.error('sparql-unicode', 'Expected a Unicode escape.')
    }
    const width = marker === 'u' ? 4 : 8
    let hex = ''
    for (let i = 0; i < width; i++) {
      const char = this.#take()
      if (char === undefined || !/[0-9A-Fa-f]/.test(char)) {
        throw this.error('sparql-unicode', 'Invalid SPARQL Unicode escape.')
      }
      hex += char
    }
    const point = Number.parseInt(hex, 16)
    if (point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)) {
      throw this.error('sparql-unicode', 'SPARQL Unicode escape is not a Unicode scalar value.')
    }
    return { raw: `${marker}${hex}`, value: String.fromCodePoint(point) }
  }

  /** Mark as one isolated step of the Scanner state machine. */
  #mark(): void {
    this.start = this.#absolute
    this.end = this.#absolute
    this.line = this.#line
    this.column = this.#column
    this.endLine = this.#line
    this.endColumn = this.#column
    this.value = ''
    this.raw = ''
  }

  /** Finish as one isolated step of the Scanner state machine. */
  #finish(): void {
    this.end = this.#absolute
    this.endLine = this.#line
    this.endColumn = this.#column
  }

  /** Applies configured parser resource limits before accepting more input. */
  #guard(mark: number): void {
    if (this.#absolute - mark > this.maxTokenLength) {
      this.#finish()
      throw this.error(
        'sparql-token-limit',
        `SPARQL token exceeds ${this.maxTokenLength} code units.`,
      )
    }
  }

  /** Reads the next buffered source value without consuming it. */
  #peek(offset = 0): string | undefined {
    return this.#buffer[this.#index + offset]
  }

  /** Consumes and returns the next buffered source value. */
  #take(): string | undefined {
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
    this.#compact()
    return char
  }

  /** Ensures at least `minimum` code units are buffered from the current cursor when possible. */
  async #refill(minimum = REFILL_WINDOW): Promise<void> {
    while (!this.#done && this.#buffer.length - this.#index < minimum) {
      const item = await this.#source.next()
      if (item.done) {
        this.#buffer += this.#decoder.decode()
        this.#done = true
        break
      }
      this.#buffer += typeof item.value === 'string'
        ? item.value
        : this.#decoder.decode(item.value, { stream: true })
    }
  }

  /** Compacts consumed source data while preserving every unread token byte. */
  #compact(): void {
    if (this.#index < COMPACT_THRESHOLD) return
    this.#buffer = this.#buffer.slice(this.#index)
    this.#index = 0
  }
}

/** Converts one internal numeric scanner kind to the public lexical token class. */
function kindName(kind: KindType): TokenKindType {
  switch (kind) {
    case KindType.Keyword:
      return 'keyword'
    case KindType.Variable:
      return 'variable'
    case KindType.Iri:
      return 'iri'
    case KindType.Prefixed:
      return 'prefixed'
    case KindType.Blank:
      return 'blank'
    case KindType.String:
      return 'string'
    case KindType.LangDir:
      return 'langDir'
    case KindType.Integer:
      return 'integer'
    case KindType.Decimal:
      return 'decimal'
    case KindType.Double:
      return 'double'
    case KindType.Boolean:
      return 'boolean'
    case KindType.Punctuation:
      return 'punctuation'
    case KindType.Operator:
      return 'operator'
    case KindType.Marker:
      return 'marker'
    case KindType.Identifier:
      return 'identifier'
    case KindType.Whitespace:
      return 'whitespace'
    case KindType.Comment:
      return 'comment'
    default:
      return 'identifier'
  }
}

/** Decodes a SPARQL Unicode escape and rejects invalid scalar values before token emission. */
function escaped(char: string): string {
  switch (char) {
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
    default:
      return char
  }
}

/** Returns whether the supplied value satisfies the whitespace contract. */
function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/** Returns whether the supplied value satisfies the var start contract. */
function isVarStart(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char)
}

/** Returns whether the supplied value satisfies the var continue contract. */
function isVarContinue(char: string): boolean {
  return /[\p{L}\p{N}\p{M}\p{Pc}_\u00B7]/u.test(char)
}

/** Returns whether the supplied value satisfies the pn start contract. */
function isPnStart(char: string): boolean {
  return /[\p{L}_]/u.test(char)
}

/** Returns whether the supplied value satisfies the pn continue contract. */
function isPnContinue(char: string): boolean {
  return /[\p{L}\p{N}\p{M}\p{Pc}_:.-]/u.test(char)
}

/** Returns whether the supplied value satisfies the delimiter contract. */
function isDelimiter(char: string): boolean {
  return isWhitespace(char) || '{}()[];,<>"\'~^|=!*/?'.includes(char)
}

/** Returns whether the supplied value satisfies the hex contract. */
function isHex(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Fa-f]/.test(char)
}
