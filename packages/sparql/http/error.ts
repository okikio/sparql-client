/** Normalized failures from SPARQL HTTP protocol operations. @module */

/** Stable high-level HTTP query failure category. */
export type QueryErrorKind = 'abort' | 'timeout' | 'network' | 'http' | 'media' | 'protocol' | 'limit'

/** Error with bounded diagnostics suitable for application logging. */
export class QueryError extends Error {
  readonly kind: QueryErrorKind
  readonly details: {
    readonly status?: number
    readonly mediaType?: string
    readonly query?: string
    readonly response?: string
    readonly cause?: unknown
  }

  /** Creates one stable protocol failure while preserving bounded details and the original cause. */
  constructor(
    kind: QueryErrorKind,
    message: string,
    details: {
      readonly status?: number
      readonly mediaType?: string
      readonly query?: string
      readonly response?: string
      readonly cause?: unknown
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'QueryError'
    this.kind = kind
    this.details = details
  }
}
