/** Licensed upstream RDF parser regressions, separate from W3C conformance claims. @module */

import type { Quad, TermType } from '@okikio/rdf'
import { blankNode, literal, namedNode, quad } from '@okikio/rdf'
import { parse as nquads } from '@okikio/rdf/nquads'
import { parse as ntriples } from '@okikio/rdf/ntriples'
import { parse as turtle } from '@okikio/rdf/turtle'
import { parse as trig } from '@okikio/rdf/trig'
import { Parser } from 'n3'
import { isomorphic } from './equal.ts'

export interface UpstreamCaseType {
  readonly source: string
  readonly id: string
  readonly origin: string
  readonly name: string
  readonly format: 'ntriples' | 'nquads' | 'turtle' | 'trig'
  readonly kind: 'eval' | 'positive' | 'negative'
  /** Negative syntax cases reject as SyntaxError; declared invalid UTF-8 uses TextDecoder TypeError. */
  readonly error?: 'syntax' | 'utf8'
  readonly base: string
  readonly input?: string
  readonly inputText?: string
  readonly expected?: string
  readonly expectedTerms?: readonly Quad[]
}

interface CorpusType {
  readonly schema: number
  readonly sources: readonly { id: string; repository: string; revision: string; license: string }[]
  readonly files: readonly { path: string; source: string; sha256: string; bytes: number }[]
  readonly cases: readonly UpstreamCaseType[]
  readonly excluded: readonly { source: string; id: string; reason: string }[]
}
const directory = new URL('./upstream/', import.meta.url)

/** Acquires and checks all fixture bytes before any syntax-rejection oracle is entered. */
export async function readCorpus(root: URL = directory): Promise<CorpusType> {
  const corpus = JSON.parse(await Deno.readTextFile(new URL('corpus.json', root))) as CorpusType
  if (corpus.schema !== 1 || !corpus.cases.length || !corpus.sources.length) {
    throw new TypeError('Unsupported or empty upstream parser corpus.')
  }
  if (
    new Set(corpus.sources.map((source) => source.id)).size !== corpus.sources.length ||
    corpus.sources.some((source) =>
      !source.id || !source.license || !/^[0-9a-f]{40}$/u.test(source.revision)
    )
  ) {
    throw new TypeError('Invalid upstream source provenance.')
  }
  const paths = new Set<string>()
  for (const item of corpus.files) {
    if (
      paths.has(item.path) || item.path.includes('..') || item.path.startsWith('/') ||
      !/^[0-9a-f]{64}$/u.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0
    ) {
      throw new TypeError('Duplicate or unsafe upstream fixture path.')
    }
    paths.add(item.path)
    const bytes = await Deno.readFile(new URL(item.path, root))
    const actual = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    if (bytes.length !== item.bytes || actual !== item.sha256) {
      throw new Error(`Upstream fixture differs from its pinned bytes: ${item.path}.`)
    }
  }
  const ids = new Set<string>()
  for (const entry of corpus.cases) {
    const id = `${entry.source}/${entry.id}`
    if (
      !entry.id || !['eval', 'positive', 'negative'].includes(entry.kind) ||
      !['ntriples', 'nquads', 'turtle', 'trig'].includes(entry.format) ||
      (entry.input === undefined) === (entry.inputText === undefined) ||
      (entry.kind === 'negative'
        ? !['syntax', 'utf8'].includes(entry.error ?? '')
        : entry.error !== undefined)
    ) {
      throw new TypeError(`Invalid upstream case contract: ${id}.`)
    }
    if (ids.has(id) || !corpus.sources.some((source) => source.id === entry.source)) {
      throw new TypeError(`Duplicate or unknown upstream parser identity: ${id}.`)
    }
    ids.add(id)
    if (entry.input !== undefined ? !paths.has(entry.input) : entry.inputText === undefined) {
      throw new TypeError(`Missing upstream input: ${id}.`)
    }
    if (
      entry.kind === 'eval' &&
      (entry.expected !== undefined ? !paths.has(entry.expected) : !entry.expectedTerms)
    ) throw new TypeError(`Missing upstream expected terms: ${id}.`)
  }
  return corpus
}

/** Reads the expected graph through the independent pinned N3 parser, never the parser under test. */
export async function readCase(entry: UpstreamCaseType): Promise<{
  input: Uint8Array
  expected?: readonly Quad[]
}> {
  const input = entry.input === undefined
    ? new TextEncoder().encode(entry.inputText!)
    : await Deno.readFile(new URL(entry.input, directory))
  const expected = entry.expected === undefined ? entry.expectedTerms : new Parser({
    format: entry.expected.endsWith('.nq') || entry.format === 'nquads' ? 'N-Quads' : 'N-Triples',
    baseIRI: entry.base,
  }).parse(await Deno.readTextFile(new URL(entry.expected, directory))) as unknown as Quad[]
  return { input, ...(expected ? { expected } : {}) }
}

/** Tests one original fixture with a whole byte source or deterministic hostile UTF-8 chunks. */
export async function parseCase(
  entry: UpstreamCaseType,
  bytes: Uint8Array,
  split: boolean,
): Promise<Quad[]> {
  const source = split ? chunks(bytes) : bytes
  const input = entry.format === 'ntriples'
    ? ntriples(source)
    : entry.format === 'nquads'
    ? nquads(source)
    : entry.format === 'trig'
    ? trig(source, { baseIri: entry.base })
    : turtle(source, { baseIri: entry.base })
  const output: Quad[] = []
  for await (const value of input) output.push(value)
  return output
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  // Repeat small unequal sizes: splits UTF-8, escapes, directives and punctuation without random seeds.
  const sizes = [1, 2, 5, 3, 11]
  for (let offset = 0, index = 0; offset < bytes.length; index++) {
    const end = Math.min(bytes.length, offset + sizes[index % sizes.length]!)
    yield bytes.subarray(offset, end)
    offset = end
  }
}

/**
 * Compares complete term multisets modulo a consistent blank-node renaming. RDF graph identity
 * alone discards repeated events; upstream parser expectations can also protect multiplicity.
 * Reify each unique statement with its count and all four term positions, then reuse the existing
 * isomorphism oracle. Original blanks and oracle-created statement nodes occupy disjoint spaces.
 */
export function sameTerms(actual: readonly Quad[], expected: readonly Quad[]): boolean {
  if (actual.length !== expected.length) return false
  if (![...actual, ...expected].some((value) => hasBlank(value))) {
    return actual.map(key).sort().join('\n') === expected.map(key).sort().join('\n')
  }
  return isomorphic(weighted(actual), weighted(expected))
}

function weighted(values: readonly Quad[]): Quad[] {
  const counts = new Map<string, { value: Quad; count: number }>()
  for (const value of values) {
    const signature = key(value)
    const previous = counts.get(signature)
    if (previous) previous.count++
    else counts.set(signature, { value, count: 1 })
  }
  const output: Quad[] = []
  for (const [index, { value, count }] of [...counts.values()].entries()) {
    const subject = blankNode(`statement${index}`)
    const emit = (role: string, object: TermType) => {
      if (object.termType === 'DefaultGraph') object = namedNode('urn:upstream:default')
      if (object.termType === 'Variable') {
        throw new TypeError('Unexpected query variable in RDF data.')
      }
      output.push(quad(subject, namedNode(`urn:upstream:${role}`), object))
    }
    emit('subject', renamed(value.subject))
    emit('predicate', renamed(value.predicate))
    emit('object', renamed(value.object))
    emit('graph', renamed(value.graph))
    emit('graph-kind', literal(value.graph.termType))
    emit('count', literal(String(count)))
  }
  return output
}

function renamed(term: TermType): TermType {
  if (term.termType === 'BlankNode') return blankNode(`original_${term.value}`)
  if (term.termType === 'Quad') {
    // Preserve every triple-term field. Structural Quad records from fixture JSON do not need methods.
    return {
      termType: 'Quad',
      value: '',
      equals: term.equals,
      subject: renamed(term.subject),
      predicate: renamed(term.predicate),
      object: renamed(term.object),
      graph: renamed(term.graph),
    } as Quad
  }
  if (term.termType === 'Literal') {
    return {
      termType: 'Literal',
      value: term.value,
      equals: term.equals,
      datatype: term.datatype,
      language: term.language.toLowerCase(),
      direction: term.direction ?? '',
    }
  }
  return term
}

/** Frames only semantic fields; RDF/JS accessors and object layouts are deliberately irrelevant. */
function key(term: TermType): string {
  if (term.termType === 'Quad') {
    return JSON.stringify([
      'Quad',
      key(term.subject),
      key(term.predicate),
      key(term.object),
      key(term.graph),
    ])
  }
  if (term.termType === 'Literal') {
    return JSON.stringify([
      'Literal',
      term.value,
      term.language.toLowerCase(),
      term.direction ?? '',
      term.datatype.value,
    ])
  }
  return JSON.stringify([term.termType, term.value])
}
function hasBlank(term: TermType): boolean {
  if (term.termType === 'BlankNode') return true
  return term.termType === 'Quad' &&
    [term.subject, term.predicate, term.object, term.graph].some(hasBlank)
}

/**
 * Verifies the declared failure domain independently before entering the parser rejection oracle.
 * Valid UTF-8 malformed syntax must produce SyntaxError; a plain internal Error or TypeError cannot
 * satisfy it. The ten explicit invalid-byte vectors instead protect fatal TextDecoder rejection.
 * Acquisition, hash checking and this metadata check run outside the parser rejection assertion.
 */
export function rejectionType(
  entry: UpstreamCaseType,
  bytes: Uint8Array,
): typeof SyntaxError | typeof TypeError {
  if (entry.kind !== 'negative' || (entry.error !== 'syntax' && entry.error !== 'utf8')) {
    throw new TypeError('Expected a classified negative parser case.')
  }
  let invalidUtf8 = false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    invalidUtf8 = true
  }
  if (invalidUtf8 !== (entry.error === 'utf8')) {
    throw new TypeError(
      `Upstream error classification differs from input bytes: ${entry.source}/${entry.id}.`,
    )
  }
  return invalidUtf8 ? TypeError : SyntaxError
}
