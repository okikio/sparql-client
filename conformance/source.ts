/** Pinned upstream standards suites used as release evidence. @module */

export interface SourceType {
  readonly id: string
  readonly standard: string
  readonly repository: string
  readonly revision: string
  readonly web: string
  readonly license: string
}

/** Immutable revisions. Updating one requires a visible source diff and a fresh conformance report. */
export const sources = [
  {
    id: 'rdf',
    standard: 'RDF 1.1 and RDF 1.2 syntax tests',
    repository: 'https://github.com/w3c/rdf-tests.git',
    revision: '12774b0ebb385d17651b396654b19254d0fefbfa',
    web: 'https://w3c.github.io/rdf-tests/',
    license: 'W3C Software and Document Notice and License',
  },
  {
    id: 'jsonld',
    standard: 'JSON-LD 1.1 API',
    repository: 'https://github.com/w3c/json-ld-api.git',
    revision: 'ffdb326121ea89b7b8280e76a5caea923834bcef',
    web: 'https://w3c.github.io/json-ld-api/',
    license: 'W3C Software and Document Notice and License',
  },
  {
    id: 'framing',
    standard: 'JSON-LD 1.1 Framing',
    repository: 'https://github.com/w3c/json-ld-framing.git',
    revision: '3bf782ba9a40dd1b143435abe386d38df64f2b47',
    web: 'https://w3c.github.io/json-ld-framing/tests/',
    license: 'W3C Software and Document Notice and License',
  },
  {
    id: 'canon',
    standard: 'RDF Dataset Canonicalization 1.0',
    repository: 'https://github.com/w3c/rdf-canon.git',
    revision: '15619df2fda7a4ca88308733789b6774517f9638',
    web: 'https://w3c.github.io/rdf-canon/',
    license: 'W3C Software and Document Notice and License',
  },
  {
    id: 'rdfa',
    standard: 'RDFa 1.1 processor tests',
    repository: 'https://github.com/rdfa/rdfa.github.io.git',
    revision: 'eee51f068df8c650413512d63848e2730b56320b',
    web: 'http://rdfa.info/',
    license: 'W3C Test Suite License',
  },
  {
    id: 'microdata',
    standard: 'Microdata to RDF tests',
    repository: 'https://github.com/w3c/microdata-rdf.git',
    revision: 'f4162846153dea1351194e338caff086830a7d00',
    web: 'https://w3c.github.io/microdata-rdf/',
    license: 'W3C Software and Document Notice and License',
  },
] as const satisfies readonly SourceType[]

export type SourceIdType = typeof sources[number]['id']

export function source(id: SourceIdType): SourceType {
  const value = sources.find((item) => item.id === id)
  if (!value) throw new TypeError(`Unknown conformance source '${id}'.`)
  return value
}

/** Local cache path. External suites are intentionally not checked into package source. */
export function sourceDir(id: SourceIdType): string {
  return `.tmp/conformance/${id}`
}

/** Converts one local path within a pinned checkout to the logical web IRI used by the suite. */
export function sourceUrl(id: SourceIdType, path: string): string {
  const value = source(id)
  const clean = path.replace(/^\/+/, '')
  return new URL(clean, value.web).href
}
