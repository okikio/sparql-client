import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join } from 'node:path'
import { readCatalog } from './catalog.ts'
import { readTree } from './manifest.ts'
import { runRdfCase } from './rdf.ts'
import { sourceFileUrl } from './source.ts'
import { pathToFileURL } from 'node:url'
import { caseKey } from './result.ts'
import type { SourceIdType } from './source.ts'

/** Tiny original declarations exercise every inventory lane without running any processor. */
async function fixtures(root: string): Promise<void> {
  const write = async (path: string, text: string): Promise<void> => {
    const file = join(root, path)
    await Deno.mkdir(join(file, '..'), { recursive: true })
    await Deno.writeTextFile(file, text)
  }
  const manifest = (id: string, kind: string, result = ''): string =>
    `@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
    <> a mf:Manifest; mf:entries (<${id}>) .
    <${id}> a <${kind}>; mf:action <input.nt> ${result} .`
  for (
    const [path, name] of [
      ['rdf-n-triples', 'NTriples'],
      ['rdf-n-quads', 'NQuads'],
      ['rdf-turtle', 'Turtle'],
      ['rdf-trig', 'Trig'],
      ['rdf-xml', 'XML'],
    ] as const
  ) {
    await write(
      `rdf/rdf/rdf12/${path}/manifest.ttl`,
      manifest(`urn:${name}`, `http://www.w3.org/ns/rdftest#Test${name}PositiveSyntax`),
    )
  }
  await write(
    'canon/tests/manifest.ttl',
    manifest('urn:canonical', 'urn:RDFC10EvalTest', '; mf:result <expected.nq>'),
  )
  const api = ['expand', 'compact', 'flatten', 'toRdf', 'fromRdf']
  await write(
    'jsonld/tests/manifest.jsonld',
    JSON.stringify({ sequence: api.map((name) => `${name}.jsonld`) }),
  )
  for (
    const [name, kind] of [
      ['expand', 'ExpandTest'],
      ['compact', 'CompactTest'],
      ['flatten', 'FlattenTest'],
      ['toRdf', 'ToRDFTest'],
      ['fromRdf', 'FromRDFTest'],
    ]
  ) {
    await write(
      `jsonld/tests/${name}.jsonld`,
      JSON.stringify({
        sequence: [{
          '@id': `urn:${name}`,
          '@type': `jld:${kind}`,
          input: 'input.jsonld',
          expect: 'expected.jsonld',
        }],
      }),
    )
  }
  await write(
    'framing/tests/frame-manifest.jsonld',
    JSON.stringify({
      sequence: [{
        '@id': 'urn:frame',
        '@type': 'jld:FrameTest',
        input: 'input.jsonld',
        frame: 'frame.jsonld',
        expect: 'expected.jsonld',
      }],
    }),
  )
  await write(
    'rdfa/test-suite/manifest.jsonld',
    JSON.stringify({
      '@graph': [
        {
          num: '0001',
          versions: ['rdfa1.1'],
          hostLanguages: ['html5', 'xhtml5', 'svg', 'xml'],
          input: 'urn:document',
        },
        { num: 'excluded', versions: ['rdfa1.0'], hostLanguages: ['html5'], input: 'urn:excluded' },
      ],
    }),
  )
  await write(
    'microdata/tests/manifest.ttl',
    manifest('urn:microdata', 'urn:TestMicrodata', '; mf:result <expected.ttl>'),
  )
}

describe('official expected assertion catalog', () => {
  it('preserves exact declared membership after relocating a pinned corpus', async (t) => {
    const roots = [await Deno.makeTempDir(), await Deno.makeTempDir()]
    for (const root of roots) t.after(() => Deno.remove(root, { recursive: true }))
    const catalogs = []
    const reports = []
    for (const root of roots) {
      await fixtures(root)
      for (
        const [path, id] of [
          ['rdf/rdf/rdf12/rdf-n-triples/manifest.ttl', 'urn:NTriples'],
          ['canon/tests/manifest.ttl', 'urn:canonical'],
          ['microdata/tests/manifest.ttl', 'urn:microdata'],
        ]
      ) {
        const file = join(root, path!)
        await Deno.writeTextFile(file, (await Deno.readTextFile(file)).replaceAll(id!, '#local'))
      }
      const rdfa = join(root, 'rdfa/test-suite/manifest.jsonld')
      const declared = JSON.parse(await Deno.readTextFile(rdfa))
      delete declared['@graph'][0].input
      await Deno.writeTextFile(rdfa, JSON.stringify(declared))
      const directory = (id: SourceIdType): string => join(root, id)
      const catalog = await readCatalog(directory)
      catalogs.push(catalog.map(caseKey).sort())
      const manifest = join(root, 'rdf/rdf/rdf12/rdf-n-triples/manifest.ttl')
      await Deno.writeTextFile(join(manifest, '../input.nt'), '<urn:s> <urn:p> <urn:o> .')
      const entry = (await readTree(manifest))[0]!
      const result = await runRdfCase(entry, 'ntriples-1.2', 'fixture', directory('rdf'))
      expect(result.status).toBe('pass')
      const expected = catalog.find((row) => row.profile === 'ntriples-1.2')!
      expect(caseKey({ ...result, revision: expected.revision })).toBe(caseKey(expected))
      reports.push(caseKey(result))
      expect(expected.id).toBe(
        'https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/manifest.ttl#local',
      )
      expect(catalog.find((row) => row.profile === 'RDFC-1.0')).toMatchObject({
        id: 'https://w3c.github.io/rdf-canon/tests/manifest.ttl#local',
        input: 'https://w3c.github.io/rdf-canon/tests/input.nt',
        expected: 'https://w3c.github.io/rdf-canon/tests/expected.nq',
      })
      expect(catalog.find((row) => row.profile === 'RDFa 1.1 html5')).toMatchObject({
        input: 'http://rdfa.info/test-suite/test-cases/rdfa1.1/html5/0001.html',
        expected: 'http://rdfa.info/test-suite/test-cases/rdfa1.1/html5/0001.sparql',
      })
      expect(catalog.find((row) => row.profile === 'Microdata to RDF')?.id)
        .toBe('http://w3c.github.io/microdata-rdf/tests/manifest.ttl#local')
      expect(() =>
        sourceFileUrl('rdf', pathToFileURL(join(root, 'outside.nt')).href, directory('rdf'))
      )
        .toThrow(TypeError)
    }
    expect(catalogs[0]).toEqual(catalogs[1])
    expect(reports[0]).toBe(reports[1])
  })

  it('enumerates declared syntax, JSON-LD operations and host selections independently of outcomes', async (t) => {
    const root = await Deno.makeTempDir({ prefix: 'official-catalog-' })
    t.after(() => Deno.remove(root, { recursive: true }))
    await fixtures(root)
    const directory = (id: SourceIdType): string => join(root, id)
    const rows = await readCatalog(directory)
    expect(rows.map(({ profile, id }) => [profile, id]).sort()).toEqual([
      ['ntriples-1.2', 'urn:NTriples'],
      ['nquads-1.2', 'urn:NQuads'],
      ['turtle-1.2', 'urn:Turtle'],
      ['trig-1.2', 'urn:Trig'],
      ['rdfxml-1.2', 'urn:XML'],
      ['RDFC-1.0', 'urn:canonical'],
      ['JSON-LD 1.1 expand', 'urn:expand'],
      ['JSON-LD 1.1 compact', 'urn:compact'],
      ['JSON-LD 1.1 flatten', 'urn:flatten'],
      ['JSON-LD 1.1 toRdf', 'urn:toRdf'],
      ['JSON-LD 1.1 fromRdf', 'urn:fromRdf'],
      ['JSON-LD 1.1 Framing', 'urn:frame'],
      ['RDFa 1.1 html5', '0001:html5'],
      ['RDFa 1.1 xhtml5', '0001:xhtml5'],
      ['RDFa 1.1 svg', '0001:svg'],
      ['RDFa 1.1 xml', '0001:xml'],
      ['Microdata to RDF', 'urn:microdata'],
    ].sort())
    const triple = rows.find((row) => row.id === 'urn:NTriples')!
    expect(triple.input).toBe('https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/input.nt')
    expect(triple.expected).toBeUndefined()
    expect(rows.find((row) => row.id === 'urn:expand')).toMatchObject({
      suite: 'jsonld',
      kind: 'jld:ExpandTest',
      input: 'input.jsonld',
      expected: 'expected.jsonld',
    })
    expect(rows.find((row) => row.id === '0001:html5')).toMatchObject({
      input: 'urn:document',
      expected: 'http://rdfa.info/test-suite/test-cases/rdfa1.1/html5/0001.sparql',
    })
    expect(new Set(rows.map(caseKey)).size).toBe(17)
    await Deno.writeTextFile(
      join(root, 'jsonld/tests/expand.jsonld'),
      JSON.stringify({
        sequence: [{
          '@id': 'urn:expand',
          '@type': 'jld:UnknownTest',
          input: 'input.jsonld',
        }],
      }),
    )
    await expect(readCatalog(directory)).rejects.toThrow(TypeError)
  })
})
