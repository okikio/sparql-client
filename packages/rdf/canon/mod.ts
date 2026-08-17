/** RDFC-1.0 RDF dataset canonicalization with explicit complexity controls. @module */

import { parse as parseNQuads, write as writeNQuads } from '../nquads/mod.ts'
import type { Literal, ObjectTerm, Quad } from '../term.ts'
import type { CanonizerOptionsType, CanonizerType } from './types.ts'

export type { CanonizerOptionsType, CanonizerType } from './types.ts'

/** Default max quads used when the caller does not provide an override. */
const DEFAULT_MAX_QUADS = 1_000_000
/** Default max work factor used when the caller does not provide an override. */
const DEFAULT_MAX_WORK_FACTOR = 1

/** RDFC-1.0 canonicalization options. */
export interface OptionsType {
  /** Optional implementation injection for tests or alternate conforming RDFC-1.0 engines. */
  readonly canonizer?: CanonizerType
  /** Hash algorithm used internally by RDFC-1.0. */
  readonly messageDigestAlgorithm?: 'sha256' | 'sha384' | 'sha512'
  /** Complexity limit passed to the deep blank-node comparison algorithm. Defaults to 1, or O(n). */
  readonly maxWorkFactor?: number
  /** Exact deep-iteration limit. When supplied, this overrides `maxWorkFactor`. */
  readonly maxDeepIterations?: number
  /** Maximum number of input quads materialized for one canonicalization. */
  readonly maxQuads?: number
  /** Cooperative cancellation checked by this facade and the canonicalizer. */
  readonly signal?: AbortSignal
}

/** Options for hashing the resulting canonical N-Quads document. */
export interface HashOptionsType extends OptionsType {
  /** Digest applied to the final canonical N-Quads bytes. This is separate from RDFC's internal hash. */
  readonly digest?: 'SHA-256' | 'SHA-384' | 'SHA-512'
}

/**
 * Produces the canonical N-Quads representation defined by RDFC-1.0.
 *
 * RDFC-1.0 is defined over the RDF 1.1 dataset model. RDF 1.2 triple terms and
 * directional language-tagged strings are therefore rejected instead of being
 * silently lowered to a representation whose canonicalization is unspecified.
 */
export async function canonicalize(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<string> {
  abort(options.signal)
  const quads = await collect(source, options.maxQuads ?? DEFAULT_MAX_QUADS, options.signal)
  for (const value of quads) validate(value)

  const canonizer = options.canonizer ?? await defaultCanonizer()
  const settings = settingsFor(options)
  const output = await canonizer.canonize(writeNQuads(quads), settings)
  abort(options.signal)
  return output
}

/** Canonicalizes a dataset and parses the canonical N-Quads back into native RDF terms. */
export async function canonicalizeQuads(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<Quad[]> {
  const text = await canonicalize(source, options)
  const quads: Quad[] = []
  const parseOptions = options.signal ? { signal: options.signal } : {}
  for await (const value of parseNQuads(text, parseOptions)) quads.push(value)
  return quads
}

/** Hashes the canonical N-Quads bytes with one explicit Web Crypto digest. */
export async function hash(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: HashOptionsType = {},
): Promise<string> {
  const text = await canonicalize(source, options)
  abort(options.signal)
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest(options.digest ?? 'SHA-256', bytes)
  abort(options.signal)
  return hex(new Uint8Array(digest))
}

/** Returns true when two datasets canonicalize to the same RDFC-1.0 representation. */
export async function isomorphic(
  left: Iterable<Quad> | AsyncIterable<Quad>,
  right: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<boolean> {
  const leftValue = await canonicalize(left, options)
  const rightValue = await canonicalize(right, options)
  return leftValue === rightValue
}

/** Creates the exact option object passed to the external implementation. */
function settingsFor(options: OptionsType): CanonizerOptionsType {
  const maxWorkFactor = nonNegativeFiniteOrInfinity(options.maxWorkFactor ?? DEFAULT_MAX_WORK_FACTOR, 'maxWorkFactor')
  const settings: CanonizerOptionsType = {
    algorithm: 'RDFC-1.0',
    inputFormat: 'application/n-quads',
    format: 'application/n-quads',
    messageDigestAlgorithm: options.messageDigestAlgorithm ?? 'sha256',
    maxWorkFactor,
    rejectURDNA2015: true,
    ...(options.maxDeepIterations === undefined
      ? {}
      : { maxDeepIterations: nonNegativeFiniteOrInfinity(options.maxDeepIterations, 'maxDeepIterations') }),
    ...(options.signal ? { signal: options.signal } : {}),
  }
  return settings
}

/** Materializes one canonicalization input with an explicit cardinality limit. */
async function collect(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  maxQuads: number,
  signal?: AbortSignal,
): Promise<Quad[]> {
  if (!Number.isSafeInteger(maxQuads) || maxQuads <= 0) throw new RangeError('maxQuads must be a positive safe integer.')
  const quads: Quad[] = []
  for await (const value of source) {
    abort(signal)
    if (quads.length >= maxQuads) throw new RangeError(`RDFC-1.0 input exceeds maxQuads (${maxQuads}).`)
    quads.push(value)
  }
  return quads
}

/** Rejects RDF 1.2 terms that RDFC-1.0 does not currently define. */
function validate(value: Quad): void {
  validateObject(value.object)
}

/** Validates one graph object for RDFC-1.0 compatibility. */
function validateObject(value: ObjectTerm): void {
  if (value.termType === 'Quad') {
    throw new TypeError('RDFC-1.0 does not define canonicalization for RDF 1.2 triple terms.')
  }
  if (value.termType === 'Literal') validateLiteral(value)
}

/** Rejects RDF 1.2 directional language-tagged strings from RDFC-1.0 input. */
function validateLiteral(value: Literal): void {
  if (value.direction !== '') {
    throw new TypeError('RDFC-1.0 does not define canonicalization for RDF 1.2 directional language-tagged strings.')
  }
}

/** Lazily resolved RDFC-1.0 processor shared across calls after the caller first requests canonicalization. */
let canonizerPromise: Promise<CanonizerType> | undefined

/** Lazily imports the canonicalizer only when this focused subpath performs work. */
async function defaultCanonizer(): Promise<CanonizerType> {
  canonizerPromise ??= import('rdf-canonize').then((module) => module as unknown as CanonizerType)
  return await canonizerPromise
}

/** Formats digest bytes as lowercase hexadecimal. */
function hex(bytes: Uint8Array): string {
  let result = ''
  for (const value of bytes) result += value.toString(16).padStart(2, '0')
  return result
}

/** Validates canonicalization work limits while allowing Infinity only where the upstream contract permits it. */
function nonNegativeFiniteOrInfinity(value: number, name: string): number {
  if (value === Infinity) return value
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer or Infinity.`)
  return value
}

/** Throws the caller supplied abort reason when cancellation has been requested. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
