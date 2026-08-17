/** Streaming RDF 1.1/1.2 XML parsing behind Web-oriented source contracts. @module */

import { blankNode, defaultGraph, literal, namedNode, quad, variable } from '../factory.ts'
import type { Graph, NamedNode, Quad } from '../term.ts'
import { throwIfAborted, type TextSource } from '../text.ts'
import { parseTransform } from '../transform.ts'
import type { ParserConstructorType } from './types.ts'

export type { ParserConstructorType, ParserType } from './types.ts'

/** Options for RDF/XML parsing. */
export interface ParseOptionsType {
  /** Initial base IRI used before xml:base declarations are encountered. */
  readonly base?: string
  /** Graph assigned to parsed RDF/XML triples. RDF/XML itself serializes one graph. */
  readonly graph?: Graph
  /** Reject malformed XML instead of accepting the parser's lenient compatibility mode. Defaults to true. */
  readonly strict?: boolean
  /** Include line/column information in parser errors where supported. */
  readonly trackPosition?: boolean
  /** Permit repeated rdf:ID values. Defaults to false. */
  readonly allowDuplicateRdfIds?: boolean
  /** Validate RDF IRIs. Defaults to true. */
  readonly validateIri?: boolean
  /** Parse unsupported rdf:version values instead of rejecting them. Defaults to false. */
  readonly parseUnsupportedVersions?: boolean
  /** Version provided by an application/rdf+xml media-type parameter. */
  readonly version?: '1.1' | '1.2-basic' | '1.2'
  /** External parser injection used by tests or alternate conforming implementations. */
  readonly parser?: ParserConstructorType
  readonly signal?: AbortSignal
}

/**
 * Parses RDF/XML incrementally into native `@okikio/rdf` quads.
 *
 * The public source contract stays on strings, byte chunks, async iterables,
 * and Web `ReadableStream`s. The external parser's Node-style Transform is an
 * implementation detail and is destroyed when the caller stops early.
 */
export async function* parse(source: TextSource, options: ParseOptionsType = {}): AsyncGenerator<Quad> {
  throwIfAborted(options.signal)
  const Parser = options.parser ?? await defaultParser()
  const parser = new Parser(parserOptions(options))
  yield* parseTransform(parser, source, { label: 'RDF/XML parser', ...(options.signal ? { signal: options.signal } : {}) })
}

/** Converts project RDF factory calls into the RDF/JS DataFactory shape expected by the parser. */
const dataFactory = {
  namedNode,
  blankNode,
  defaultGraph,
  variable,
  quad,
  /** Adapts the RDF/JS literal factory signature while preserving RDF 1.2 directional language literals when an upstream parser supplies direction. */
  literal(value: string, languageOrDatatype?: string | NamedNode, direction?: 'ltr' | 'rtl'): ReturnType<typeof literal> {
    if (direction !== undefined) {
      if (typeof languageOrDatatype !== 'string') throw new TypeError('Directional RDF/XML literal requires a language tag.')
      return literal(value, { language: languageOrDatatype, direction })
    }
    return literal(value, languageOrDatatype)
  },
} as const

/** Builds the external parser options without serializing absent optional fields as undefined. */
function parserOptions(options: ParseOptionsType): Readonly<Record<string, unknown>> {
  return {
    dataFactory,
    strict: options.strict ?? true,
    trackPosition: options.trackPosition ?? true,
    allowDuplicateRdfIds: options.allowDuplicateRdfIds ?? false,
    validateUri: options.validateIri ?? true,
    parseUnsupportedVersions: options.parseUnsupportedVersions ?? false,
    ...(options.base === undefined ? {} : { baseIRI: options.base }),
    ...(options.graph === undefined ? {} : { defaultGraph: options.graph }),
    ...(options.version === undefined ? {} : { version: options.version }),
  }
}

/** Lazily resolved RDF/XML parser constructor so importing the subpath does not initialize the optional processor. */
let parserPromise: Promise<ParserConstructorType> | undefined

/** Lazily imports the RDF/XML implementation only when the subpath is used. */
async function defaultParser(): Promise<ParserConstructorType> {
  parserPromise ??= import('rdfxml-streaming-parser').then((module) => module.RdfXmlParser as unknown as ParserConstructorType)
  return await parserPromise
}
