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
export const Kind = {
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
export type Kind = (typeof Kind)[keyof typeof Kind]

/** Case-insensitive SPARQL keywords recognized separately from identifiers and prefixed names. */
const KEYWORDS = new Set([
  'ABS', 'ADD', 'ALL', 'AS', 'ASC', 'ASK', 'AVG', 'BASE', 'BIND', 'BNODE', 'BOUND',
  'BY', 'CEIL', 'CLEAR', 'COALESCE', 'CONCAT', 'CONSTRUCT', 'CONTAINS', 'COPY', 'COUNT',
  'CREATE', 'DATATYPE', 'DAY', 'DEFAULT', 'DELETE', 'DESC', 'DESCRIBE', 'DISTINCT', 'DROP',
  'ENCODE_FOR_URI', 'EXISTS', 'FILTER', 'FLOOR', 'FROM', 'GRAPH', 'GROUP', 'GROUP_CONCAT',
  'HAVING', 'HOURS', 'IF', 'IN', 'INSERT', 'INTO', 'IRI', 'ISBLANK', 'ISIRI', 'ISLITERAL',
  'ISNUMERIC', 'ISTRIPLE', 'ISURI', 'LCASE', 'LIMIT', 'LOAD', 'MAX', 'MD5', 'MIN', 'MINUS',
  'MINUTES', 'MONTH', 'MOVE', 'NAMED', 'NOT', 'NOW', 'OBJECT', 'OFFSET', 'OPTIONAL', 'ORDER',
  'PREDICATE', 'PREFIX', 'RAND', 'REDUCED', 'REGEX', 'REPLACE', 'SAMPLE', 'SELECT', 'SEPARATOR',
  'SERVICE', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'SILENT', 'STR', 'STRAFTER', 'STRBEFORE',
  'STRDT', 'STRENDS', 'STRLANG', 'STRLANGDIR', 'STRLEN', 'STRSTARTS', 'SUBJECT', 'SUBSTR', 'SUM',
  'TIMEZONE', 'TO', 'TRIPLE', 'TRUE', 'TZ', 'UCASE', 'UNDEF', 'UNION', 'URI', 'USING', 'UUID',
  'VALUES', 'VERSION', 'WHERE', 'WITH', 'YEAR', 'LANG', 'LANGDIR', 'LANGMATCHES', 'HASLANG',
  'HASLANGDIR', 'FALSE',
])

/** Position-aware lexical failure used by strict mode and converted in tolerant mode. */
export class SyntaxScanError extends SyntaxError {
  readonly code: string
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
  kind: Kind = Kind.Eof
  value = ''
  raw = ''
  start = 0
  end = 0
  line = 1
  column = 1
  endLine = 1
  endColumn = 1

  readonly signal: AbortSignal | undefined
  readonly trivia: boolean
  readonly maxTokenLength: number

  #source: AsyncGenerator<string | Uint8Array>
  #decoder = new TextDecoder('utf-8', { fatal: true })
  #buffer = ''
  #index = 0
  #absolute = 0
  #line = 1
  #column = 1
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
      this.kind = Kind.Eof
      this.#finish()
      return
    }

    const three = `${first}${this.#peek(1) ?? ''}${this.#peek(2) ?? ''}`
    const two = three.slice(0, 2)

    if (three === '<<(') return this.#fixed(Kind.Marker, 3)
    if (three === ')>>') return this.#fixed(Kind.Marker, 3)
    if (two === '<<' || two === '>>' || two === '{|' || two === '|}') return this.#fixed(Kind.Marker, 2)
    if (two === '^^' || two === '!=' || two === '<=' || two === '>=' || two === '||' || two === '&&') {
      return this.#fixed(Kind.Operator, 2)
    }

    if (first === '?' || first === '$') {
      const second = this.#peek(1)
      if (second !== undefined && isVarStart(second)) return await this.#variable()
      return this.#fixed(Kind.Operator, 1)
    }

    if (first === '<') {
      if (await this.#looksLikeIri()) return await this.#iri()
      return this.#fixed(Kind.Operator, 1)
    }

    if (first === '"' || first === "'") return await this.#string(first)
    if (first === '@') return await this.#langDir()
    if (two === '_:') return await this.#blank()
    if (first === ':' || isPnStart(first)) return await this.#word()

    if (/[0-9]/.test(first) || first === '.' || first === '+' || first === '-') {
      if (await this.#number()) return
    }

    if ('{}()[];,'.includes(first) || first === '.') return this.#fixed(Kind.Punctuation, 1)
    if ('=<>+-*/!|^'.includes(first)) return this.#fixed(Kind.Operator, 1)
    if (first === '~') return this.#fixed(Kind.Marker, 1)

    this.#take()
    this.kind = Kind.Unknown
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
      this.kind = Kind.Whitespace
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
      this.kind = Kind.Comment
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
  #fixed(kind: Kind, width: number): void {
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
    this.kind = Kind.Variable
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
      if (char === undefined) throw this.error('sparql-iri-end', 'Unterminated SPARQL IRI reference.')
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
    this.kind = Kind.Iri
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
      if (char === undefined) throw this.error('sparql-string-end', 'Unterminated SPARQL string literal.')
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
        throw this.error('sparql-string-line', 'Short SPARQL string literals cannot contain line breaks.')
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

    this.kind = Kind.String
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
      ? Kind.LangDir
      : Kind.Unknown
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
    this.kind = raw.length > 2 ? Kind.Blank : Kind.Unknown
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
        if (next === undefined || !'_~.-!$&\'()*+,;=/?#@%'.includes(next)) break
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
      this.kind = Kind.Prefixed
      this.value = raw
    } else if (!escapedLocal && raw === 'a') {
      this.kind = Kind.Keyword
      this.value = raw
    } else {
      const upper = raw.toUpperCase()
      if (KEYWORDS.has(upper)) {
        this.kind = upper === 'TRUE' || upper === 'FALSE' ? Kind.Boolean : Kind.Keyword
        this.value = upper === 'TRUE' || upper === 'FALSE' ? raw.toLowerCase() : upper
      } else {
        this.kind = Kind.Identifier
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

    const matches: Array<{ kind: Kind; match: string }> = []
    const double = candidate.match(/^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))[eE][+-]?[0-9]+/)?.[0]
    const decimal = candidate.match(/^[+-]?[0-9]*\.[0-9]+/)?.[0]
    const integer = candidate.match(/^[+-]?[0-9]+/)?.[0]
    if (double) matches.push({ kind: Kind.Double, match: double })
    if (decimal) matches.push({ kind: Kind.Decimal, match: decimal })
    if (integer) matches.push({ kind: Kind.Integer, match: integer })

    let chosen: { kind: Kind; match: string } | undefined
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
  async #unicode(): Promise<{ raw: string; value: string }> {
    await this.#refill(9)
    const marker = this.#take()
    if (marker !== 'u' && marker !== 'U') throw this.error('sparql-unicode', 'Expected a Unicode escape.')
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
      throw this.error('sparql-token-limit', `SPARQL token exceeds ${this.maxTokenLength} code units.`)
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
function kindName(kind: Kind): TokenKindType {
  switch (kind) {
    case Kind.Keyword: return 'keyword'
    case Kind.Variable: return 'variable'
    case Kind.Iri: return 'iri'
    case Kind.Prefixed: return 'prefixed'
    case Kind.Blank: return 'blank'
    case Kind.String: return 'string'
    case Kind.LangDir: return 'langDir'
    case Kind.Integer: return 'integer'
    case Kind.Decimal: return 'decimal'
    case Kind.Double: return 'double'
    case Kind.Boolean: return 'boolean'
    case Kind.Punctuation: return 'punctuation'
    case Kind.Operator: return 'operator'
    case Kind.Marker: return 'marker'
    case Kind.Identifier: return 'identifier'
    case Kind.Whitespace: return 'whitespace'
    case Kind.Comment: return 'comment'
    default: return 'identifier'
  }
}

/** Decodes a SPARQL Unicode escape and rejects invalid scalar values before token emission. */
function escaped(char: string): string {
  switch (char) {
    case 't': return '\t'
    case 'b': return '\b'
    case 'n': return '\n'
    case 'r': return '\r'
    case 'f': return '\f'
    default: return char
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
