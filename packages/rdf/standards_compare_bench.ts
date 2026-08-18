/** Competitive benchmarks for the native standards processors that replace external runtime engines. @module */

import { bench, do_not_optimize, group } from 'mitata'
import jsonld from 'jsonld'
import * as rdfCanonize from 'rdf-canonize'
import { RdfXmlParser } from 'rdfxml-streaming-parser'
import { RdfaParser } from 'rdfa-streaming-parser'
import { MicrodataRdfParser } from 'microdata-rdf-streaming-parser'
import { report } from '../../bench/report.ts'
import * as canon from './canon/mod.ts'
import * as nativeJsonLd from './jsonld/mod.ts'
import * as microdata from './microdata/mod.ts'
import { parse as parseNQuads } from './nquads/mod.ts'
import * as rdfa from './rdfa/mod.ts'
import type { Quad } from './term.ts'
import * as xml from './xml/mod.ts'

/** Fixture sizes used by the ordinary and opt-in large benchmark lanes. */
const scales = Deno.env.get('BENCH_LARGE') === '1' ? [100, 1_000, 10_000] : [100, 1_000]

for (const count of scales) {
  const json = jsonLdFixture(count)
  const expectedJson = await nativeJsonLd.expand(json, { ordered: true })
  const externalJson = await jsonld.expand(json, { ordered: true })
  if (stable(externalJson) !== stable(expectedJson)) {
    throw new Error(`jsonld.js expansion oracle differs for ${count.toLocaleString()} nodes.`)
  }

  group(`JSON-LD expansion: ${count.toLocaleString()} nodes`, () => {
    bench(
      '@okikio/rdf/jsonld',
      async () => do_not_optimize(await nativeJsonLd.expand(json, { ordered: true })),
    ).gc('inner')
    bench('jsonld.js', async () => do_not_optimize(await jsonld.expand(json, { ordered: true })))
      .gc('inner')
  })

  const canonicalInput = canonicalFixture(count)
  const canonicalQuads = await collectNQuads(canonicalInput)
  const expectedCanonical = await canon.canonicalize(canonicalQuads)
  const externalCanonical = await rdfCanonize.canonize(canonicalInput, {
    algorithm: 'RDFC-1.0',
    inputFormat: 'application/n-quads',
    format: 'application/n-quads',
    messageDigestAlgorithm: 'sha256',
    maxWorkFactor: 8,
    rejectURDNA2015: true,
  })
  if (externalCanonical !== expectedCanonical) {
    throw new Error(
      `rdf-canonize oracle differs for ${count.toLocaleString()} blank-node subjects.`,
    )
  }

  group(`RDFC-1.0 canonicalization: ${count.toLocaleString()} blank nodes`, () => {
    bench(
      '@okikio/rdf/canon',
      async () => do_not_optimize(await canon.canonicalize(canonicalQuads)),
    ).gc('inner')
    bench('rdf-canonize', async () =>
      do_not_optimize(
        await rdfCanonize.canonize(canonicalInput, {
          algorithm: 'RDFC-1.0',
          inputFormat: 'application/n-quads',
          format: 'application/n-quads',
        }),
      )).gc('inner')
  })

  const rdfXml = rdfXmlFixture(count)
  const nativeXml = await collect(xml.parse(rdfXml, { base: 'https://example.com/' }))
  const externalXml = await collectNode(
    new RdfXmlParser({ baseIRI: 'https://example.com/' }),
    rdfXml,
  )
  sameQuads('RDF/XML', count, nativeXml, externalXml)

  group(`RDF/XML parse: ${count.toLocaleString()} descriptions`, () => {
    bench(
      '@okikio/rdf/xml',
      async () =>
        do_not_optimize(
          (await collect(xml.parse(rdfXml, { base: 'https://example.com/' }))).length,
        ),
    ).gc('inner')
    bench(
      'rdfxml-streaming-parser',
      async () =>
        do_not_optimize(
          (await collectNode(new RdfXmlParser({ baseIRI: 'https://example.com/' }), rdfXml)).length,
        ),
    ).gc('inner')
  })

  const rdfaHtml = rdfaFixture(count)
  const nativeRdfa = await collect(
    rdfa.parse(rdfaHtml, { base: 'https://example.com/', contentType: 'text/html' }),
  )
  const externalRdfa = await collectNode(
    new RdfaParser({ baseIRI: 'https://example.com/', contentType: 'text/html' }),
    rdfaHtml,
  )
  sameQuads('RDFa', count, nativeRdfa, externalRdfa)

  group(`RDFa parse: ${count.toLocaleString()} resources`, () => {
    bench(
      '@okikio/rdf/rdfa',
      async () =>
        do_not_optimize(
          (await collect(
            rdfa.parse(rdfaHtml, { base: 'https://example.com/', contentType: 'text/html' }),
          )).length,
        ),
    ).gc('inner')
    bench(
      'rdfa-streaming-parser',
      async () =>
        do_not_optimize(
          (await collectNode(
            new RdfaParser({ baseIRI: 'https://example.com/', contentType: 'text/html' }),
            rdfaHtml,
          )).length,
        ),
    ).gc('inner')
  })

  const microdataHtml = microdataFixture(count)
  const nativeMicrodata = await collect(
    microdata.parse(microdataHtml, { base: 'https://example.com/' }),
  )
  const externalMicrodata = await collectNode(
    new MicrodataRdfParser({ baseIRI: 'https://example.com/' }),
    microdataHtml,
  )
  sameQuads('Microdata', count, nativeMicrodata, externalMicrodata)

  group(`Microdata parse: ${count.toLocaleString()} items`, () => {
    bench(
      '@okikio/rdf/microdata',
      async () =>
        do_not_optimize(
          (await collect(microdata.parse(microdataHtml, { base: 'https://example.com/' }))).length,
        ),
    ).gc('inner')
    bench(
      'microdata-rdf-streaming-parser',
      async () =>
        do_not_optimize(
          (await collectNode(
            new MicrodataRdfParser({ baseIRI: 'https://example.com/' }),
            microdataHtml,
          )).length,
        ),
    ).gc('inner')
  })
}

await report()

/** Creates one deterministic JSON-LD graph whose values do not require remote contexts. */
function jsonLdFixture(count: number): Readonly<Record<string, unknown>> {
  return {
    '@context': {
      ex: 'https://example.com/',
      name: 'ex:name',
      knows: { '@id': 'ex:knows', '@type': '@id' },
    },
    '@graph': Array.from({ length: count }, (_, index) => ({
      '@id': `ex:person-${index}`,
      name: `Person ${index}`,
      knows: `ex:person-${(index + 1) % count}`,
    })),
  }
}

/** Creates a blank-node-heavy N-Quads dataset with stable graph-independent structure. */
function canonicalFixture(count: number): string {
  return `${
    Array.from({ length: count }, (_, index) => {
      const next = (index + 1) % count
      return `_:b${index} <https://example.com/name> "Node ${index}" .\n_:b${index} <https://example.com/next> _:b${next} .`
    }).join('\n')
  }\n`
}

/** Creates RDF/XML descriptions that exercise namespace and typed literal processing. */
function rdfXmlFixture(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => `
    <rdf:Description rdf:about="person-${index}">
      <ex:name xml:lang="en">Person ${index}</ex:name>
      <ex:index rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">${index}</ex:index>
    </rdf:Description>`).join('')
  return `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="https://example.com/" xml:base="https://example.com/">${rows}
</rdf:RDF>`
}

/** Creates HTML+RDFa resources with explicit prefix, type, relation, and literal values. */
function rdfaFixture(count: number): string {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `<article about="person-${index}" typeof="ex:Person">
    <span property="ex:name">Person ${index}</span>
    <a rel="ex:knows" href="person-${(index + 1) % count}">next</a>
  </article>`,
  ).join('\n')
  return `<!doctype html><html prefix="ex: https://example.com/"><body>${rows}</body></html>`
}

/** Creates schema.org Microdata items with identifiers, scalar properties, and URL values. */
function microdataFixture(count: number): string {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `<article itemscope itemtype="https://schema.org/Person" itemid="person-${index}">
    <span itemprop="name">Person ${index}</span>
    <a itemprop="url" href="person-${index}">profile</a>
  </article>`,
  ).join('\n')
  return `<!doctype html><html><body>${rows}</body></html>`
}

/** Collects one project async quad stream into a benchmark-oracle array. */
async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const values: Quad[] = []
  for await (const value of source) values.push(value)
  return values
}

/** Parses one N-Quads fixture through the native line parser. */
async function collectNQuads(source: string): Promise<Quad[]> {
  return await collect(parseNQuads(source))
}

/**
 * Collects one external Node Transform after feeding it the complete benchmark document.
 *
 * The external parsers are benchmark-only competitors. This adapter intentionally lives in
 * this benchmark file so Node stream contracts never enter the native RDF package graph.
 */
async function collectNode(parser: NodeParserType, source: string): Promise<unknown[]> {
  const values: unknown[] = []
  parser.end(source)
  for await (const value of parser) values.push(value)
  return values
}

/** Minimal benchmark-only shape shared by the three external Node Transform parsers. */
interface NodeParserType extends AsyncIterable<unknown> {
  /** Supplies the complete benchmark fixture and closes the transform input side. */
  end(source: string): void
}

/** Rejects a benchmark case when native and competitor parsers do not describe the same RDF dataset. */
function sameQuads(
  label: string,
  count: number,
  native: Iterable<unknown>,
  external: Iterable<unknown>,
): void {
  if (quadKeys(native) !== quadKeys(external)) {
    throw new Error(`${label} competitor oracle differs for ${count.toLocaleString()} resources.`)
  }
}

/** Returns a deterministic RDF/JS-style quad digest independent of implementation object identity. */
function quadKeys(values: Iterable<unknown>): string {
  return [...values].map((value) => quadKey(value)).sort().join('\n')
}

/** Serializes one RDF/JS-style quad for semantic benchmark preflight comparisons. */
function quadKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const quad = value as {
    readonly subject?: unknown
    readonly predicate?: unknown
    readonly object?: unknown
    readonly graph?: unknown
  }
  return `${termKey(quad.subject)} ${termKey(quad.predicate)} ${termKey(quad.object)} ${
    termKey(quad.graph)
  }`
}

/** Serializes RDF/JS terms, including RDF-star triple terms, without depending on one implementation class. */
function termKey(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const term = value as {
    readonly termType?: string
    readonly value?: string
    readonly language?: string
    readonly direction?: string
    readonly datatype?: unknown
    readonly subject?: unknown
    readonly predicate?: unknown
    readonly object?: unknown
    readonly graph?: unknown
  }
  if (term.termType === 'Literal') {
    return `L${term.value ?? ''}@${term.language ?? ''}~${term.direction ?? ''}^^${
      termKey(term.datatype)
    }`
  }
  if (term.termType === 'Quad') {
    return `Q(${termKey(term.subject)},${termKey(term.predicate)},${termKey(term.object)},${
      termKey(term.graph)
    })`
  }
  return `${term.termType ?? '?'}:${term.value ?? ''}`
}

/** Deterministically serializes JSON-compatible values for competitor preflight comparison. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>
    return `{${
      Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(
        ',',
      )
    }}`
  }
  return JSON.stringify(value)
}
