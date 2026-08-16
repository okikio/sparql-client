/** Public data contracts for SPARQL syntax inspection. @module */

/** SPARQL version labels defined by the SPARQL 1.2 query/update specifications. */
export type VersionType = '1.1' | '1.2-basic' | '1.2'

/** Source range using UTF-16 code-unit offsets and one-based line/column positions. */
export interface RangeType {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
  readonly endLine: number
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
  readonly kind: TokenKindType
  /** Decoded semantic value where decoding is meaningful, otherwise the token text. */
  readonly value: string
  /** Exact source spelling. */
  readonly raw: string
  readonly range: RangeType
}

/** Stable diagnostic severity used by syntax inspection. */
export type SeverityType = 'warning' | 'error'

/** Recoverable lexical or version/feature diagnostic. */
export interface DiagnosticType {
  readonly code: string
  readonly message: string
  readonly severity: SeverityType
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
  readonly kind: 'feature'
  readonly feature: FeatureType
  readonly range: RangeType
}

/** One VERSION announcement. `version` is absent for unrecognized labels. */
export interface VersionEventType {
  readonly kind: 'version'
  readonly label: string
  readonly version?: VersionType
  readonly range: RangeType
}

/** Incremental syntax event. */
export type EventType =
  | { readonly kind: 'token'; readonly token: TokenType }
  | VersionEventType
  | FeatureEventType
  | { readonly kind: 'diagnostic'; readonly diagnostic: DiagnosticType }

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
  readonly signal?: AbortSignal
}

/** Materialized view over the event stream. This is intentionally not a SPARQL AST. */
export interface DocumentType {
  readonly tokens: readonly TokenType[]
  readonly diagnostics: readonly DiagnosticType[]
  readonly versions: readonly VersionEventType[]
  readonly features: readonly FeatureEventType[]
  /** Effective recognized version after applying VERSION-over-protocol precedence. */
  readonly version?: VersionType
}
