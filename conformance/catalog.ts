/** Expected case membership acquired from pinned declarations, independently of processor results. @module */

import { readTree } from './manifest.ts'
import { source, sourceDir, sourceFileUrl, sourceUrl } from './source.ts'
import type { SourceIdType } from './source.ts'

import { caseKey } from './result.ts'
import type { ExpectedCaseType } from './result.ts'
/** Exact supported-profile ownership. Processor semantics and complete host support are separate claims. */
export const profiles: Readonly<Record<string, string>> = {
  'ntriples-1.2': 'rdf',
  'nquads-1.2': 'rdf',
  'turtle-1.2': 'rdf',
  'trig-1.2': 'rdf',
  'rdfxml-1.2': 'rdf',
  'RDFC-1.0': 'canon',
  'JSON-LD 1.1 expand': 'jsonld',
  'JSON-LD 1.1 compact': 'jsonld',
  'JSON-LD 1.1 flatten': 'jsonld',
  'JSON-LD 1.1 toRdf': 'jsonld',
  'JSON-LD 1.1 fromRdf': 'jsonld',
  'JSON-LD 1.1 Framing': 'framing',
  'RDFa 1.1 html5': 'rdfa',
  'RDFa 1.1 xhtml5': 'rdfa',
  'RDFa 1.1 svg': 'rdfa',
  'RDFa 1.1 xml': 'rdfa',
  'Microdata to RDF': 'microdata',
}

/**
 * Enumerates declared cases without running any RDF/JSON-LD processor or trusting report totals.
 *
 * The caller checks cached Git bytes before acquisition. The injected directory function is a
 * task-test boundary for miniature manifests. Selection follows each pinned suite's declared
 * host/version/operation scope; unknown operations fail rather than disappear from coverage.
 */
export async function readCatalog(
  directory: (id: SourceIdType) => string = sourceDir,
): Promise<ExpectedCaseType[]> {
  const output: ExpectedCaseType[] = []
  const logical = (suite: SourceIdType, uri: string): string =>
    sourceFileUrl(suite, uri, directory(suite))
  const put = (suite: SourceIdType, item: Omit<ExpectedCaseType, 'suite' | 'revision'>): void => {
    output.push({ suite, revision: source(suite).revision, ...item })
  }
  for (
    const [profile, path, format] of [
      ['ntriples-1.2', 'rdf-n-triples', 'NTriples'],
      ['nquads-1.2', 'rdf-n-quads', 'NQuads'],
      ['turtle-1.2', 'rdf-turtle', 'Turtle'],
      ['trig-1.2', 'rdf-trig', 'Trig'],
      ['rdfxml-1.2', 'rdf-xml', 'XML'],
    ] as const
  ) {
    for (const entry of await readTree(`${directory('rdf')}/rdf/rdf12/${path}/manifest.ttl`)) {
      const prefix = `http://www.w3.org/ns/rdftest#Test${format}`
      const kind = entry.types.length === 1 && entry.types[0]?.startsWith(prefix)
        ? entry.types[0].slice(prefix.length)
        : undefined
      if (!kind || !['PositiveSyntax', 'NegativeSyntax', 'Eval', 'PositiveC14N'].includes(kind)) {
        throw new TypeError(`Unsupported declared RDF case: ${entry.id}`)
      }
      put('rdf', {
        profile: profile!,
        id: logical('rdf', entry.id),
        kind: entry.types.join(' '),
        ...(entry.action ? { input: logical('rdf', entry.action) } : {}),
        ...(entry.result && (kind === 'Eval' || kind === 'PositiveC14N')
          ? { expected: logical('rdf', entry.result) }
          : {}),
      })
    }
  }
  for (const entry of await readTree(`${directory('canon')}/tests/manifest.ttl`)) {
    put('canon', {
      profile: 'RDFC-1.0',
      id: logical('canon', entry.id),
      kind: entry.types.join(' '),
      ...(entry.action ? { input: logical('canon', entry.action) } : {}),
      ...(entry.result ? { expected: logical('canon', entry.result) } : {}),
    })
  }
  const apiRoot = record(await json(`${directory('jsonld')}/tests/manifest.jsonld`))
  for (const item of sequence(apiRoot)) {
    if (typeof item !== 'string') throw new TypeError('JSON-LD API includes must name manifests')
    const manifest = record(await json(`${directory('jsonld')}/tests/${item}`))
    for (const value of sequence(manifest)) {
      const test = record(value), kinds = types(test)
      const operations = [
        ['expand', ['ExpandTest']],
        ['compact', ['CompactTest']],
        ['flatten', ['FlattenTest']],
        ['toRdf', ['ToRDFTest', 'ToRdfTest']],
        ['fromRdf', ['FromRDFTest', 'FromRdfTest']],
      ] as const
      const found = operations.filter(([, suffixes]) =>
        kinds.some((kind) => suffixes.some((suffix) => kind.endsWith(suffix)))
      )
      if (found.length !== 1) throw new TypeError('Unknown or ambiguous declared JSON-LD operation')
      put('jsonld', {
        profile: `JSON-LD 1.1 ${found[0]![0]}`,
        id: text(test['@id']) ?? `${item}:${text(test.name) ?? 'unnamed'}`,
        kind: kinds.join(' '),
        ...resources(test),
      })
    }
  }
  const framing = record(await json(`${directory('framing')}/tests/frame-manifest.jsonld`))
  for (const value of sequence(framing)) {
    const test = record(value)
    put('framing', {
      profile: 'JSON-LD 1.1 Framing',
      id: text(test['@id']) ?? text(test.name) ?? 'unnamed',
      kind: types(test).join(' '),
      ...resources(test),
    })
  }
  const rdfa = record(await json(`${directory('rdfa')}/test-suite/manifest.jsonld`))
  if (!Array.isArray(rdfa['@graph'])) throw new TypeError('RDFa manifest lacks its case graph')
  for (const value of rdfa['@graph']) {
    const test = record(value), num = text(test.num)
    if (!num || !strings(test.versions).includes('rdfa1.1')) continue
    for (
      const [host, extension] of [['html5', '.html'], ['xhtml5', '.xhtml'], ['svg', '.svg'], [
        'xml',
        '.xml',
      ]] as const
    ) {
      if (!strings(test.hostLanguages).includes(host!)) continue
      const base = `test-suite/test-cases/rdfa1.1/${host}`
      put('rdfa', {
        profile: `RDFa 1.1 ${host}`,
        id: `${num}:${host}`,
        kind: 'RDFa processor test',
        input: text(test.input) ?? sourceUrl('rdfa', `${base}/${num}${extension}`),
        expected: sourceUrl('rdfa', `${base}/${num}.sparql`),
      })
    }
  }
  for (const entry of await readTree(`${directory('microdata')}/tests/manifest.ttl`)) {
    put('microdata', {
      profile: 'Microdata to RDF',
      id: logical('microdata', entry.id),
      kind: entry.types.join(' '),
      ...(entry.action ? { input: logical('microdata', entry.action) } : {}),
      ...(entry.result ? { expected: logical('microdata', entry.result) } : {}),
    })
  }
  const keys = output.map(caseKey)
  if (!keys.length || new Set(keys).size !== keys.length) {
    throw new TypeError('Official catalog is empty or declares duplicate case identities')
  }
  return output
}

/** Only declared resource strings enter membership; operation options remain runner authority. */
function resources(test: Readonly<Record<string, unknown>>): { input?: string; expected?: string } {
  const input = text(test.input), expected = text(test.expect)
  return { ...(input ? { input } : {}), ...(expected ? { expected } : {}) }
}
function types(test: Readonly<Record<string, unknown>>): string[] {
  const value = test['@type']
  return typeof value === 'string' ? [value] : strings(value)
}
function sequence(value: Readonly<Record<string, unknown>>): unknown[] {
  if (!Array.isArray(value.sequence)) throw new TypeError('Official manifest lacks its sequence')
  return value.sequence
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('Official manifest requires a string array')
  }
  return value as string[]
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined
}
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Official manifest requires an object')
  }
  return value as Readonly<Record<string, unknown>>
}
async function json(path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(path))
}
