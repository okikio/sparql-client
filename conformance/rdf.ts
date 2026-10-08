/** Official RDF syntax conformance runner. @module */

import { parse as parseNQuads, write as writeNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples, write as writeNTriples } from '@okikio/rdf/ntriples'
import { parse as parseTriG } from '@okikio/rdf/trig'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import { parse as parseXml } from '@okikio/rdf/xml'
import type { Quad } from '@okikio/rdf'
import { isomorphic } from './equal.ts'
import { type EntryType, localPath, readTree } from './manifest.ts'
import type { CaseType } from './result.ts'
import { source, sourceDir, sourceFileUrl } from './source.ts'

const profiles = [
  ['ntriples-1.2', 'rdf/rdf12/rdf-n-triples/manifest.ttl'],
  ['nquads-1.2', 'rdf/rdf12/rdf-n-quads/manifest.ttl'],
  ['turtle-1.2', 'rdf/rdf12/rdf-turtle/manifest.ttl'],
  ['trig-1.2', 'rdf/rdf12/rdf-trig/manifest.ttl'],
  ['rdfxml-1.2', 'rdf/rdf12/rdf-xml/manifest.ttl'],
] as const

export async function runRdf(): Promise<CaseType[]> {
  const spec = source('rdf')
  const output: CaseType[] = []
  for (const [profile, manifest] of profiles) {
    const path = `${sourceDir('rdf')}/${manifest}`
    for (const entry of await readTree(path)) {
      output.push(await runRdfCase(entry, profile, spec.revision))
    }
  }
  return output
}

/** Runs one syntax vector while keeping fixture acquisition outside its rejection oracle. */
export async function runRdfCase(
  entry: EntryType,
  profile: string,
  revision: string,
  root = sourceDir('rdf'),
): Promise<CaseType> {
  const started = performance.now()
  const logical = (value: string): string => sourceFileUrl('rdf', value, root)
  const action = entry.action
  const base = action ? logical(action) : undefined
  const common = {
    suite: 'rdf',
    revision,
    profile,
    id: logical(entry.id),
    kind: entry.types.join(' '),
    ...(base ? { input: base } : {}),
  }
  if (!action) {
    return {
      ...common,
      status: 'skip',
      reason: 'Manifest entry has no mf:action.',
      durationMs: performance.now() - started,
    }
  }
  try {
    const kind = testKind(entry, profile)
    const text = await Deno.readTextFile(localPath(action))
    const input = parseInput(text, profile, base!)
    if (kind === 'NegativeSyntax') {
      let failed = false
      try {
        await collect(input)
      } catch {
        failed = true
      }
      return failed ? { ...common, status: 'pass', durationMs: performance.now() - started } : {
        ...common,
        status: 'fail',
        reason: 'Invalid syntax was accepted.',
        durationMs: performance.now() - started,
      }
    }
    const actual = await collect(input)
    if (kind === 'PositiveC14N') {
      // These vectors specify exact canonical line bytes. Parse acceptance or
      // dataset isomorphism cannot detect an incorrect writer layout/escaping.
      if (!entry.result) throw new TypeError('Canonical syntax vector lacks its expected result.')
      const expected = await Deno.readTextFile(localPath(entry.result))
      const serialized = profile.startsWith('ntriples')
        ? writeNTriples(actual)
        : profile.startsWith('nquads')
        ? writeNQuads(actual)
        : (() => {
          throw new TypeError(`Unsupported canonical syntax profile '${profile}'.`)
        })()
      return serialized === expected
        ? {
          ...common,
          status: 'pass',
          expected: logical(entry.result),
          durationMs: performance.now() - started,
        }
        : {
          ...common,
          status: 'fail',
          expected: logical(entry.result),
          reason: 'Canonical syntax bytes differ.',
          durationMs: performance.now() - started,
        }
    }
    if (kind === 'PositiveSyntax') {
      return { ...common, status: 'pass', durationMs: performance.now() - started }
    }
    if (!entry.result) throw new TypeError('Evaluation vector lacks its expected result.')
    const expected = await parseExpected(localPath(entry.result))
    return isomorphic(actual, expected)
      ? {
        ...common,
        status: 'pass',
        expected: logical(entry.result),
        durationMs: performance.now() - started,
      }
      : {
        ...common,
        status: 'fail',
        expected: logical(entry.result),
        reason:
          `Dataset differs: ${actual.length} actual quads, ${expected.length} expected quads.`,
        durationMs: performance.now() - started,
      }
  } catch (error) {
    return {
      ...common,
      status: 'fail',
      reason: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - started,
    }
  }
}

/** Maps declared vector semantics explicitly; an unknown future kind must not pass as parse-only. */
function testKind(entry: EntryType, profile: string): string {
  const format = ({
    'ntriples-1.2': 'NTriples',
    'nquads-1.2': 'NQuads',
    'turtle-1.2': 'Turtle',
    'trig-1.2': 'Trig',
    'rdfxml-1.2': 'XML',
  } as Record<string, string>)[profile]
  const prefix = `http://www.w3.org/ns/rdftest#Test${format}`
  const kind = entry.types.length === 1 && entry.types[0]?.startsWith(prefix)
    ? entry.types[0].slice(prefix.length)
    : undefined
  if (
    !format || !kind || !['NegativeSyntax', 'PositiveSyntax', 'Eval', 'PositiveC14N'].includes(kind)
  ) {
    throw new TypeError(`Unsupported RDF test kind '${entry.types.join(' ')}' for '${profile}'.`)
  }
  return kind
}

function parseInput(text: string, profile: string, base: string): AsyncIterable<Quad> {
  if (profile.startsWith('ntriples')) return parseNTriples(text)
  if (profile.startsWith('nquads')) return parseNQuads(text)
  if (profile.startsWith('turtle')) return parseTurtle(text, { baseIri: base })
  if (profile.startsWith('trig')) return parseTriG(text, { baseIri: base })
  if (profile.startsWith('rdfxml')) return parseXml(text, { base, strict: true })
  throw new TypeError(`Unsupported RDF profile '${profile}'.`)
}

async function parseExpected(path: string): Promise<Quad[]> {
  const text = await Deno.readTextFile(path)
  if (path.endsWith('.nq')) return collect(parseNQuads(text))
  if (path.endsWith('.nt')) return collect(parseNTriples(text))
  if (path.endsWith('.ttl')) return collect(parseTurtle(text))
  throw new TypeError(`Unsupported expected RDF file '${path}'.`)
}

async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of source) output.push(value)
  return output
}
