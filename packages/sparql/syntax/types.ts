/** Public data contracts for SPARQL syntax inspection. @module */

/** SPARQL version labels defined by the SPARQL 1.2 query/update specifications. */
export type VersionType = '1.1' | '1.2-basic' | '1.2'

/** Source range using UTF-16 code-unit offsets and one-based line/column positions. */
export interface RangeType {
  /** Zero-based source offset where this record starts. */
  readonly start: number
  /** Exclusive zero-based source offset where this record ends. */
  readonly end: number
  /** One-based source line containing the start of this record. */
  readonly line: number
  /** One-based source column containing the start of this record. */
  readonly column: number
  /** One-based source line containing the exclusive range end. */
  readonly endLine: number
  /** One-based source column at the exclusive range end. */
  readonly endColumn: number
}

/** Public lexical token classes. */
export type TokenKindType =
  | 'keyword'
  | 'variable'
  | 'iri'
  | 'prefixed'
  | 'blank'
  | 'string'
  | 'langDir'
  | 'integer'
  | 'decimal'
  | 'double'
  | 'boolean'
  | 'punctuation'
  | 'operator'
  | 'marker'
  | 'identifier'
  | 'whitespace'
  | 'comment'

/** One lexical SPARQL token. */
export interface TokenType {
  /** Lexical class selected by the scanner for this source token. */
  readonly kind: TokenKindType
  /** Decoded semantic value where decoding is meaningful, otherwise the token text. */
  readonly value: string
  /** Exact source spelling. */
  readonly raw: string
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: RangeType
}

/** Stable diagnostic severity used by syntax inspection. */
export type SeverityType = 'warning' | 'error'

/** Recoverable lexical or version/feature diagnostic. */
export interface DiagnosticType {
  /** Stable machine-readable code used to classify this diagnostic or failure. */
  readonly code: string
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
  /** Whether the syntax condition is recoverable (`warning`) or prevents valid interpretation (`error`). */
  readonly severity: SeverityType
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: RangeType
}

/** SPARQL syntax features that need explicit compatibility awareness. */
export type FeatureType =
  | 'directional-literal'
  | 'triple-term'
  | 'reified-triple'
  | 'annotation'
  | 'reifier'
  | 'triple-function'
  | 'direction-function'

/** One observed feature occurrence. */
export interface FeatureEventType {
  /** Identifies this event as an observed SPARQL feature occurrence. */
  readonly kind: 'feature'
  /** SPARQL feature identified by this syntax event. */
  readonly feature: FeatureType
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: RangeType
}

/** One VERSION announcement. `version` is absent for unrecognized labels. */
export interface VersionEventType {
  /** Identifies this event as a SPARQL VERSION announcement. */
  readonly kind: 'version'
  /** Human-readable syntax feature label used in diagnostics and reports. */
  readonly label: string
  /** Normalized SPARQL version when the announced label is recognized. */
  readonly version?: VersionType
  /** Source range that locates the related token, statement, feature, or diagnostic. */
  readonly range: RangeType
}

/** Incremental syntax event. */
export type EventType =
  | {
    /** Selects the `token` variant of EventType. */
    readonly kind: 'token'
    /** Token emitted by this SPARQL syntax event. */
    readonly token: TokenType
  }
  | VersionEventType
  | FeatureEventType
  | {
    /** Selects the `diagnostic` variant of EventType. */
    readonly kind: 'diagnostic'
    /** Structured syntax diagnostic emitted by this parser event. */
    readonly diagnostic: DiagnosticType
  }

/** Byte/text input accepted by SPARQL syntax inspection. */
export type SourceType =
  | string
  | Uint8Array
  | Iterable<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>
  | ReadableStream<Uint8Array>

/** Controls for incremental SPARQL syntax inspection. */
export interface OptionsType {
  /** External protocol/media-type version used only when no VERSION directive is present. */
  readonly version?: VersionType
  /** Keep whitespace and comments as tokens. They are skipped by default. */
  readonly trivia?: boolean
  /** Emit diagnostics and continue where lexical recovery is safe. */
  readonly tolerant?: boolean
  /** Maximum decoded token length. */
  readonly maxTokenLength?: number
  /** Maximum number of emitted non-trivia tokens. */
  readonly maxTokens?: number
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/** Materialized view over the event stream. This is intentionally not a SPARQL AST. */
export interface DocumentType {
  /** Lexical tokens emitted during SPARQL syntax inspection. */
  readonly tokens: readonly TokenType[]
  /** Structured diagnostics retained so recoverable source information is not silently discarded. */
  readonly diagnostics: readonly DiagnosticType[]
  /** Version announcements discovered in the inspected SPARQL source. */
  readonly versions: readonly VersionEventType[]
  /** SPARQL 1.2 feature uses discovered in the inspected source. */
  readonly features: readonly FeatureEventType[]
  /** Effective recognized version after applying VERSION-over-protocol precedence. */
  readonly version?: VersionType
}
