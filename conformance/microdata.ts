/** W3C Microdata-to-RDF suite runner over the public parser adapter. @module */

import { parse as parseMicrodata, type VocabularyRegistryType } from '@okikio/rdf/microdata'
import { RDF } from '@okikio/rdf'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import type { Quad } from '@okikio/rdf'
import { relative } from '@std/path'
import { isomorphic } from './equal.ts'
import { type EntryType, localPath, readTree } from './manifest.ts'
import type { CaseType } from './result.ts'
import { source, sourceDir, sourceUrl } from './source.ts'

export async function runMicrodata(): Promise<CaseType[]> {
  const spec = source('microdata')
  const entries = await readTree(`${sourceDir('microdata')}/tests/manifest.ttl`)
  // The pinned suite's test registry extends the normative registry. Only
  // IRI-keyed entries are rules; @comment is descriptive metadata.
  const extra = JSON.parse(
    await Deno.readTextFile(`${sourceDir('microdata')}/tests/test-registry.json`),
  ) as Record<string, unknown>
  const vocabularies: VocabularyRegistryType = {
    'http://schema.org/': { properties: { additionalType: { subPropertyOf: RDF.type } } },
    'https://schema.org/': { properties: { additionalType: { subPropertyOf: RDF.type } } },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => !key.startsWith('@'))),
  }
  const output: CaseType[] = []
  for (const entry of entries) {
    output.push(await runMicrodataCase(entry, spec.revision, vocabularies))
  }
  return output
}

/** Runs one vector with fixture I/O kept outside the negative-syntax rejection oracle. */
export async function runMicrodataCase(
  entry: EntryType,
  revision: string,
  vocabularies: VocabularyRegistryType = {},
): Promise<CaseType> {
  const started = performance.now()
  const common = {
    suite: 'microdata',
    revision,
    profile: 'Microdata to RDF',
    id: entry.id,
    kind: entry.types.join(' '),
    ...(entry.action ? { input: logical(entry.action) } : {}),
    ...(entry.result ? { expected: logical(entry.result) } : {}),
  }
  const negative = entry.types.some((type) => type.endsWith('TestMicrodataNegativeSyntax'))
  if (!entry.action || (!negative && !entry.result)) {
    return {
      ...common,
      status: 'skip',
      reason: 'Manifest entry lacks action or result.',
      durationMs: performance.now() - started,
    }
  }
  try {
    const text = await Deno.readTextFile(localPath(entry.action))
    const input = parseMicrodata(text, { base: logical(entry.action), vocabularies })
    let actual: Quad[]
    try {
      actual = await collect(input)
    } catch (error) {
      if (!negative) throw error
      return { ...common, status: 'pass', durationMs: performance.now() - started }
    }
    if (negative) {
      return {
        ...common,
        status: 'fail',
        reason: 'Negative syntax was accepted.',
        durationMs: performance.now() - started,
      }
    }
    const expected = await collect(parseTurtle(await Deno.readTextFile(localPath(entry.result!)), {
      baseIri: logical(entry.result!),
    }))
    return isomorphic(actual, expected)
      ? { ...common, status: 'pass', durationMs: performance.now() - started }
      : {
        ...common,
        status: 'fail',
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

async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const values: Quad[] = []
  for await (const value of source) values.push(value)
  return values
}

function logical(fileUrl: string): string {
  const rel = relative(sourceDir('microdata'), localPath(fileUrl)).replaceAll('\\', '/')
  return sourceUrl('microdata', rel)
}
