/** Native RDFC-1.0 RDF dataset canonicalization with explicit complexity controls. @module */
import { blankNode, quad } from '../factory.ts'
import { parse as parseNQuads } from '../nquads/mod.ts'
import type { GraphTermType, Literal, ObjectTermType, Quad } from '../term.ts'
import { writeQuad } from '../write.ts'
import type { CryptoDigestType, DegreeResultType, DigestType } from './types.ts'
export type { CryptoDigestType, DegreeResultType, DigestType } from './types.ts'
/** Default maximum dataset size admitted by canonicalization when the caller does not set `maxQuads`. */
const DEFAULT_MAX_QUADS = 1_000_000, DEFAULT_MAX_WORK_FACTOR = 8, MIN_WORK = 64
/** RDFC-1.0 canonicalization options. */
export interface OptionsType {
  /** Internal RDFC digest algorithm. */ readonly messageDigestAlgorithm?: DigestType
  /** Multiplier used to derive the N-degree work limit. */ readonly maxWorkFactor?: number
  /** Exact recursive/permutation work limit. */ readonly maxDeepIterations?: number
  /** Maximum materialized input quads. */ readonly maxQuads?: number
  /** Caller-owned output map from source blank ids to canonical ids. */ readonly canonicalIdMap?:
    Map<string, string>
  /** Caller-owned cancellation signal. */ readonly signal?: AbortSignal
}
/** Options for hashing the final canonical bytes. */
export interface HashOptionsType
  extends OptionsType {
  /** Web Crypto digest used to hash the final canonical N-Quads bytes. */
  readonly digest?: CryptoDigestType
}
/** Quad position occupied by a related blank node during first-degree and N-degree hashing. */
type PositionType = 's' | 'o' | 'g'
/** Deterministic blank-node identifier issuer. */
class Issuer {
  /** Canonical identifier prefix prepended to identifiers allocated by this issuer. */
  readonly prefix: string
  /** Blank-node identifier map owned by this issuer. */
  readonly ids: Map<string, string>
  /** Next numeric suffix allocated by this issuer. */
  #next: number
  /** Creates one Issuer instance with operation-local state. */
  constructor(prefix: string, ids: ReadonlyMap<string, string> = new Map(), next = 0) {
    this.prefix = prefix
    this.ids = new Map(ids)
    this.#next = next
  }
  /** Returns the stable identifier for a blank node, allocating the next issuer identifier when needed. */
  issue(id: string) {
    const found = this.ids.get(id)
    if (found !== undefined) return found
    const value = `${this.prefix}${this.#next++}`
    this.ids.set(id, value)
    return value
  }
  /** Returns the previously issued identifier without changing issuer ordering state. */
  get(id: string) {
    return this.ids.get(id)
  }
  /** Tests whether this issuer already assigned an identifier to the blank node. */
  has(id: string) {
    return this.ids.has(id)
  }
  /** Clones the issuer so recursive canonicalization can explore a candidate path without mutating sibling candidates. */
  copy() {
    return new Issuer(this.prefix, this.ids, this.#next)
  }
}
/** Mutable state shared by the canonicalization algorithms. */
interface StateType {
  /** Quads indexed by every blank-node identifier they mention. */
  readonly quads: Map<string, Quad[]>
  /** First-degree digest cache. */ readonly first: Map<string, string>
  /** Canonical c14n issuer. */ readonly canonical: Issuer
  /** Internal Web Crypto digest. */ readonly digest: CryptoDigestType
  /** Maximum adversarial work. */ readonly maxWork: number
  /** Caller cancellation. */ readonly signal?: AbortSignal
  /** Work already consumed. */ work: number
}
/**
 * Produces the canonical N-Quads representation defined by RDFC-1.0.
 *
 * The W3C algorithm is implemented directly. No external canonicalizer is used.
 */
export async function canonicalize(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<string> {
  abort(options.signal)
  const quads = await collect(
    source,
    positive(options.maxQuads ?? DEFAULT_MAX_QUADS, 'maxQuads'),
    options.signal,
  )
  quads.forEach(validate)
  const byNode = index(quads)
  const factor = nonNegative(options.maxWorkFactor ?? DEFAULT_MAX_WORK_FACTOR, 'maxWorkFactor')
  const maxWork = options.maxDeepIterations === undefined
    ? (factor === Infinity ? Infinity : Math.max(MIN_WORK, factor * Math.max(1, byNode.size)))
    : nonNegative(options.maxDeepIterations, 'maxDeepIterations')
  const state: StateType = {
    quads: byNode,
    first: new Map(),
    canonical: new Issuer('c14n'),
    digest: cryptoDigest(options.messageDigestAlgorithm ?? 'sha256'),
    maxWork,
    ...(options.signal ? { signal: options.signal } : {}),
    work: 0,
  }
  const byHash = new Map<string, string[]>()
  for (const id of byNode.keys()) add(byHash, await first(id, state), id)
  for (const h of ordered(byHash.keys())) {
    const ids = byHash.get(h)!
    if (ids.length === 1) {
      state.canonical.issue(ids[0]!)
      byHash.delete(h)
    }
  }
  for (const h of ordered(byHash.keys())) {
    const results: DegreeResultType<Issuer>[] = []
    for (const id of byHash.get(h)!) {
      if (state.canonical.has(id)) continue
      const issuer = new Issuer('b')
      issuer.issue(id)
      results.push(await degree(id, issuer, state))
    }
    results.sort((a, b) => compare(a.hash, b.hash))
    for (const result of results) {
      for (const id of result.issuer.ids.keys()) state.canonical.issue(id)
    }
  }
  options.canonicalIdMap?.clear()
  for (const [a, b] of state.canonical.ids) options.canonicalIdMap?.set(a, b)
  const lines = quads.map((v) => canonicalQuad(v, state.canonical)).sort(compare)
  return lines.length ? `${lines.join('\n')}\n` : ''
}
/** Parses canonical bytes back into native quads. */
export async function canonicalizeQuads(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<Quad[]> {
  const values: Quad[] = []
  for await (
    const value of parseNQuads(
      await canonicalize(source, options),
      options.signal ? { signal: options.signal } : {},
    )
  ) values.push(value)
  return values
}
/** Hashes canonical N-Quads bytes. */
export async function hash(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: HashOptionsType = {},
): Promise<string> {
  return digest(await canonicalize(source, options), options.digest ?? 'SHA-256')
}
/** Tests dataset isomorphism through canonical equality. */
export async function isomorphic(
  left: Iterable<Quad> | AsyncIterable<Quad>,
  right: Iterable<Quad> | AsyncIterable<Quad>,
  options: OptionsType = {},
): Promise<boolean> {
  return await canonicalize(left, options) === await canonicalize(right, options)
}
/** Computes and caches the first-degree hash for one blank node. */ async function first(
  id: string,
  state: StateType,
) {
  const cached = state.first.get(id)
  if (cached !== undefined) return cached
  const lines = (state.quads.get(id) ?? []).map((q) => firstQuad(q, id)).sort(compare)
  const value = await digest(lines.map((x) => `${x}\n`).join(''), state.digest)
  state.first.set(id, value)
  return value
}
/** Serializes one first-degree quad with _:a and _:z placeholders. */ function firstQuad(
  value: Quad,
  id: string,
) {
  const replace = (term: Quad['subject'] | Quad['object'] | Quad['graph']) =>
    term.termType === 'BlankNode' ? blankNode(term.value === id ? 'a' : 'z') : term
  return writeQuad(
    quad(
      replace(value.subject) as Quad['subject'],
      value.predicate,
      replace(value.object) as Quad['object'],
      replace(value.graph) as GraphTermType,
    ),
    true,
  )
}
/** Implements recursive Hash N-Degree Quads. */ async function degree(
  id: string,
  issuer: Issuer,
  state: StateType,
): Promise<DegreeResultType<Issuer>> {
  work(state)
  const related = new Map<string, string[]>()
  for (const q of state.quads.get(id) ?? []) {
    for (const [term, pos] of components(q)) {
      if (term.termType === 'BlankNode' && term.value !== id) {
        add(related, await relatedHash(term.value, q, issuer, pos, state), term.value)
      }
    }
  }
  let data = '', selected = issuer
  for (const h of ordered(related.keys())) {
    data += h
    let chosen = '', chosenIssuer: Issuer | undefined
    for (const perm of permutations(related.get(h)!)) {
      work(state)
      let current = selected.copy(), path = ''
      const recurse: string[] = []
      let rejected = false
      for (const rid of perm) {
        const canonical = state.canonical.get(rid)
        if (canonical !== undefined) path += `_:${canonical}`
        else {
          if (!current.has(rid)) recurse.push(rid)
          path += `_:${current.issue(rid)}`
        }
        if (worse(path, chosen)) {
          rejected = true
          break
        }
      }
      if (rejected) continue
      for (const rid of recurse) {
        const result = await degree(rid, current, state)
        path += `_:${current.issue(rid)}<${result.hash}>`
        current = result.issuer
        if (worse(path, chosen)) {
          rejected = true
          break
        }
      }
      if (!rejected && (chosen === '' || compare(path, chosen) < 0)) {
        chosen = path
        chosenIssuer = current
      }
    }
    if (!chosenIssuer) throw new Error('RDFC-1.0 could not choose a deterministic blank-node path.')
    data += chosen
    selected = chosenIssuer
  }
  return { hash: await digest(data, state.digest), issuer: selected }
}
/** Computes one related blank-node hash. */ async function relatedHash(
  id: string,
  q: Quad,
  issuer: Issuer,
  pos: PositionType,
  state: StateType,
) {
  let input = pos
  if (pos !== 'g') input += `<${q.predicate.value}>`
  const known = state.canonical.get(id) ?? issuer.get(id)
  input += known === undefined ? await first(id, state) : `_:${known}`
  return digest(input, state.digest)
}
/** Returns canonicalization-relevant quad components. */ function components(
  q: Quad,
): ReadonlyArray<readonly [Quad['subject'] | Quad['object'] | Quad['graph'], PositionType]> {
  return [[q.subject, 's'], [q.object, 'o'], [q.graph, 'g']]
}
/** Indexes quads by unique blank nodes they mention. */ function index(quads: readonly Quad[]) {
  const result = new Map<string, Quad[]>()
  for (const q of quads) {
    const seen = new Set<string>()
    for (const [term] of components(q)) {
      if (term.termType === 'BlankNode' && !seen.has(term.value)) {
        seen.add(term.value)
        add(result, term.value, q)
      }
    }
  }
  return result
}
/** Serializes one quad with canonical blank labels. */ function canonicalQuad(
  value: Quad,
  issuer: Issuer,
) {
  const replace = (term: Quad['subject'] | Quad['object'] | Quad['graph']) => {
    if (term.termType !== 'BlankNode') return term
    const id = issuer.get(term.value)
    if (id === undefined) {
      throw new Error(`Missing canonical identifier for blank node '${term.value}'.`)
    }
    return blankNode(id)
  }
  return writeQuad(
    quad(
      replace(value.subject) as Quad['subject'],
      value.predicate,
      replace(value.object) as Quad['object'],
      replace(value.graph) as GraphTermType,
    ),
    true,
  )
}
/** Lazily yields every positional permutation. */ function* permutations(
  values: readonly string[],
): Generator<string[]> {
  const source = [...values], used = new Array(source.length).fill(false), current: string[] = []
  /** Recursively fills the next permutation slot. */ function* visit(): Generator<string[]> {
    if (current.length === source.length) {
      yield [...current]
      return
    }
    for (let i = 0; i < source.length; i++) {
      if (used[i]) continue
      used[i] = true
      current.push(source[i]!)
      yield* visit()
      current.pop()
      used[i] = false
    }
  }
  yield* visit()
}
/** Rejects a candidate path once it cannot beat the selected path. */ function worse(
  path: string,
  chosen: string,
) {
  return chosen !== '' && path.length >= chosen.length && compare(path, chosen) > 0
}
/** Appends a value to a map-of-arrays. */ function add<T>(
  map: Map<string, T[]>,
  key: string,
  value: T,
) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
/** Sorts strings by Unicode code point. */ function ordered(values: Iterable<string>) {
  return [...values].sort(compare)
}
/** Unicode scalar-value comparator. */ function compare(a: string, b: string) {
  if (a === b) return 0
  const ai = a[Symbol.iterator](), bi = b[Symbol.iterator]()
  while (true) {
    const av = ai.next(), bv = bi.next()
    if (av.done) return bv.done ? 0 : -1
    if (bv.done) return 1
    const ac = av.value.codePointAt(0)!, bc = bv.value.codePointAt(0)!
    if (ac !== bc) return ac < bc ? -1 : 1
  }
}
/** Hashes UTF-8 text to lowercase hex. */ async function digest(
  value: string,
  algorithm: CryptoDigestType,
) {
  const output = await crypto.subtle.digest(algorithm, new TextEncoder().encode(value))
  return [...new Uint8Array(output)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
/** Maps public digest spelling to Web Crypto. */ function cryptoDigest(
  value: DigestType,
): CryptoDigestType {
  return value === 'sha256' ? 'SHA-256' : value === 'sha384' ? 'SHA-384' : 'SHA-512'
}
/** Materializes bounded input. */ async function collect(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  max: number,
  signal?: AbortSignal,
) {
  const out: Quad[] = []
  for await (const q of source) {
    abort(signal)
    if (out.length >= max) throw new RangeError(`RDFC-1.0 input exceeds maxQuads (${max}).`)
    out.push(q)
  }
  return out
}
/** Rejects RDF 1.2 forms outside RDFC-1.0. */ function validate(q: Quad) {
  validateObject(q.object)
}
/** Validates one RDFC object term. */ function validateObject(value: ObjectTermType) {
  if (value.termType === 'Quad') {
    throw new TypeError('RDFC-1.0 does not define canonicalization for RDF 1.2 triple terms.')
  }
  if (value.termType === 'Literal') validateLiteral(value)
}
/** Rejects RDF 1.2 directional language strings. */ function validateLiteral(value: Literal) {
  if (value.direction !== '') {
    throw new TypeError(
      'RDFC-1.0 does not define canonicalization for RDF 1.2 directional language-tagged strings.',
    )
  }
}
/** Increments bounded recursive/permutation work. */ function work(state: StateType) {
  abort(state.signal)
  if (++state.work > state.maxWork) {
    throw new RangeError(`RDFC-1.0 exceeded its N-degree work limit (${state.maxWork}).`)
  }
}
/** Validates positive safe integers. */ function positive(v: number, n: string) {
  if (!Number.isSafeInteger(v) || v <= 0) {
    throw new RangeError(`${n} must be a positive safe integer.`)
  }
  return v
}
/** Validates nonnegative work limits, permitting Infinity. */ function nonNegative(
  v: number,
  n: string,
) {
  if (v === Infinity) return v
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new RangeError(`${n} must be a non-negative safe integer or Infinity.`)
  }
  return v
}
/** Throws caller cancellation. */ function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
