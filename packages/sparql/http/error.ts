/** Normalized failures from SPARQL HTTP protocol operations. @module */

/** Stable high-level HTTP query failure category. */
export type QueryErrorKindType =
  | 'abort'
  | 'timeout'
  | 'network'
  | 'http'
  | 'media'
  | 'protocol'
  | 'limit'

/** Error with bounded diagnostics suitable for application logging. */
export class QueryError extends Error {
  /** Stable protocol failure category that callers can branch on without parsing the message. */
  readonly kind: QueryErrorKindType
  /** Structured protocol details retained on this query error for diagnostics. */
  readonly details: {
    /** HTTP status code associated with this SPARQL protocol failure. */
    readonly status?: number
    /** Response media type observed when the SPARQL protocol request failed. */
    readonly mediaType?: string
    /** SPARQL query or update text associated with this protocol failure. */
    readonly query?: string
    /** Bounded response excerpt retained to diagnose the SPARQL protocol failure. */
    readonly response?: string
    /** Original runtime or network failure retained for diagnostics. */
    readonly cause?: unknown
  }

  /** Creates one stable protocol failure while preserving bounded details and the original cause. */
  constructor(
    kind: QueryErrorKindType,
    message: string,
    details: {
      /** HTTP status code associated with this SPARQL protocol failure. */
      readonly status?: number
      /** Response media type observed when the SPARQL protocol request failed. */
      readonly mediaType?: string
      /** SPARQL query or update text associated with this protocol failure. */
      readonly query?: string
      /** Bounded response excerpt retained to diagnose the SPARQL protocol failure. */
      readonly response?: string
      /** Original runtime or network failure retained for diagnostics. */
      readonly cause?: unknown
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'QueryError'
    this.kind = kind
    this.details = details
  }
}
