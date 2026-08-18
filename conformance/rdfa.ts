/** RDFa 1.1 processor suite runner using the suite's SPARQL ASK assertions. @module */

import { type ContentTypeType, parse as parseRdfa } from '@okikio/rdf/rdfa'
import { write as writeNQuads } from '@okikio/rdf/nquads'
import type { Quad } from '@okikio/rdf'
import { Store } from 'oxigraph'
import type { CaseType } from './result.ts'
import { source, sourceDir } from './source.ts'

interface ManifestType {
  readonly '@graph'?: readonly TestType[]
}
interface TestType {
  readonly '@id'?: string
  readonly num?: string
  readonly description?: string
  readonly input?: string
  readonly expectedResults?: boolean
  readonly hostLanguages?: readonly string[]
  readonly versions?: readonly string[]
}

const hosts = [
  ['html5', '.html', 'text/html'],
  ['xhtml5', '.xhtml', 'application/xhtml+xml'],
  ['svg', '.svg', 'image/svg+xml'],
  ['xml', '.xml', 'application/xml'],
] as const satisfies readonly (readonly [string, string, ContentTypeType])[]

export async function runRdfa(): Promise<CaseType[]> {
  const spec = source('rdfa')
  const manifest = JSON.parse(
    await Deno.readTextFile(`${sourceDir('rdfa')}/test-suite/manifest.jsonld`),
  ) as ManifestType
  const output: CaseType[] = []
  for (const test of manifest['@graph'] ?? []) {
    if (!test.num || !test.versions?.includes('rdfa1.1')) continue
    for (const [host, extension, contentType] of hosts) {
      if (!test.hostLanguages?.includes(host)) continue
      const dir = `${sourceDir('rdfa')}/test-suite/test-cases/rdfa1.1/${host}`
      const input = `${dir}/${test.num}${extension}`
      const assertion = `${dir}/${test.num}.sparql`
      if (!await exists(input) || !await exists(assertion)) continue
      output.push(await runCase(test, host, contentType, input, assertion, spec.revision))
    }
  }
  return output
}

async function runCase(
  test: TestType,
  host: string,
  contentType: ContentTypeType,
  input: string,
  assertion: string,
  revision: string,
): Promise<CaseType> {
  const started = performance.now()
  const common = {
    suite: 'rdfa',
    revision,
    profile: `RDFa 1.1 ${host}`,
    id: `${test.num}:${host}`,
    kind: 'RDFa processor test',
    input: test.input ?? input,
    expected: assertion,
  }
  try {
    const actual = await collect(parseRdfa(await Deno.readTextFile(input), {
      base: test.input ??
        `http://rdfa.info/test-suite/test-cases/${test.num}${input.slice(input.lastIndexOf('.'))}`,
      contentType,
    }))
    const store = new Store()
    store.load(writeNQuads(actual), { format: 'application/n-quads' })
    const result = store.query(await Deno.readTextFile(assertion))
    if (typeof result !== 'boolean') {
      return {
        ...common,
        status: 'fail',
        reason: 'RDFa suite assertion did not evaluate to a boolean.',
        durationMs: performance.now() - started,
      }
    }
    return result === (test.expectedResults ?? true)
      ? { ...common, status: 'pass', durationMs: performance.now() - started }
      : {
        ...common,
        status: 'fail',
        reason: `Suite ASK returned ${result}, expected ${test.expectedResults ?? true}.`,
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

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}
