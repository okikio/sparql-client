/** Official RDF syntax conformance runner. @module */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples } from '@okikio/rdf/ntriples'
import { parse as parseTriG } from '@okikio/rdf/trig'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import { parse as parseXml } from '@okikio/rdf/xml'
import type { Quad } from '@okikio/rdf'
import { relative } from '@std/path'
import { isomorphic } from './equal.ts'
import { type EntryType, localPath, readTree } from './manifest.ts'
import type { CaseType } from './result.ts'
import { source, sourceDir, sourceUrl } from './source.ts'

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
      output.push(await runCase(entry, profile, spec.revision))
    }
  }
  return output
}

async function runCase(entry: EntryType, profile: string, revision: string): Promise<CaseType> {
  const started = performance.now()
  const action = entry.action
  const base = action ? logical(action) : undefined
  const common = {
    suite: 'rdf',
    revision,
    profile,
    id: entry.id,
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
  const kind = entry.types.join(' ').toLowerCase()
  try {
    if (kind.includes('negative')) {
      let failed = false
      try {
        await parseInput(localPath(action), profile, base!)
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
    const actual = await parseInput(localPath(action), profile, base!)
    if (!entry.result || !kind.includes('eval')) {
      return { ...common, status: 'pass', durationMs: performance.now() - started }
    }
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

async function parseInput(path: string, profile: string, base: string): Promise<Quad[]> {
  const text = await Deno.readTextFile(path)
  if (profile.startsWith('ntriples')) return collect(parseNTriples(text))
  if (profile.startsWith('nquads')) return collect(parseNQuads(text))
  if (profile.startsWith('turtle')) return collect(parseTurtle(text, { baseIri: base }))
  if (profile.startsWith('trig')) return collect(parseTriG(text, { baseIri: base }))
  if (profile.startsWith('rdfxml')) return collect(parseXml(text, { base, strict: true }))
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

function logical(fileUrl: string): string {
  const local = localPath(fileUrl)
  const rel = relative(sourceDir('rdf'), local).replaceAll('\\', '/')
  return sourceUrl('rdf', rel)
}
