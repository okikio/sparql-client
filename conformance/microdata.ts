/** W3C Microdata-to-RDF suite runner over the public parser adapter. @module */

import { parse as parseMicrodata } from '@okikio/rdf/microdata'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import type { Quad } from '@okikio/rdf'
import { relative } from '@std/path'
import { isomorphic } from './equal.ts'
import { localPath, readTree } from './manifest.ts'
import type { CaseType } from './result.ts'
import { source, sourceDir, sourceUrl } from './source.ts'

export async function runMicrodata(): Promise<CaseType[]> {
  const spec = source('microdata')
  const entries = await readTree(`${sourceDir('microdata')}/tests/manifest.ttl`)
  const output: CaseType[] = []
  for (const entry of entries) {
    const started = performance.now()
    const common = {
      suite: 'microdata',
      revision: spec.revision,
      profile: 'Microdata to RDF',
      id: entry.id,
      kind: entry.types.join(' '),
      ...(entry.action ? { input: logical(entry.action) } : {}),
      ...(entry.result ? { expected: logical(entry.result) } : {}),
    }
    if (!entry.action || !entry.result) {
      output.push({
        ...common,
        status: 'skip',
        reason: 'Manifest entry lacks action or result.',
        durationMs: performance.now() - started,
      })
      continue
    }
    try {
      const actual = await collect(
        parseMicrodata(await Deno.readTextFile(localPath(entry.action)), {
          base: logical(entry.action),
        }),
      )
      const expected = await collect(
        parseTurtle(await Deno.readTextFile(localPath(entry.result)), {
          baseIri: logical(entry.result),
        }),
      )
      output.push(
        isomorphic(actual, expected)
          ? { ...common, status: 'pass', durationMs: performance.now() - started }
          : {
            ...common,
            status: 'fail',
            reason:
              `Dataset differs: ${actual.length} actual quads, ${expected.length} expected quads.`,
            durationMs: performance.now() - started,
          },
      )
    } catch (error) {
      output.push({
        ...common,
        status: 'fail',
        reason: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - started,
      })
    }
  }
  return output
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
