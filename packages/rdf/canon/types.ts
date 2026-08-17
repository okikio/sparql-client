/** Structural contract implemented by an RDF dataset canonicalizer. @module */

/** Options forwarded to the RDFC-1.0 implementation. */
export interface CanonizerOptionsType {
  readonly algorithm: 'RDFC-1.0'
  readonly inputFormat: 'application/n-quads'
  readonly format: 'application/n-quads'
  readonly messageDigestAlgorithm: 'sha256' | 'sha384' | 'sha512'
  readonly maxWorkFactor: number
  readonly maxDeepIterations?: number
  readonly signal?: AbortSignal
  readonly rejectURDNA2015: true
}

/** Minimal external canonicalizer contract used by this subpath. */
export interface CanonizerType {
  canonize(input: string, options: CanonizerOptionsType): Promise<string>
}
