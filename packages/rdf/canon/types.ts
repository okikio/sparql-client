/** Native RDFC-1.0 canonicalization contracts. @module */
/** Hash algorithms accepted by RDFC-1.0 internal hashing. */
export type DigestType =
  | 'sha256'
  | 'sha384'
  | 'sha512'
/** Web Crypto digest names used internally. */
export type CryptoDigestType =
  | 'SHA-256'
  | 'SHA-384'
  | 'SHA-512'
/** Result of one recursive N-degree blank-node comparison. */
export interface DegreeResultType<
  Issuer,
> {
  /** N-degree hash selected for this canonicalization candidate. */
  readonly hash: string
  /** Issuer preserving selected traversal order. */ readonly issuer: Issuer
}
