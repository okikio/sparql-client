/** HTML Microdata-to-RDF parsing behind native RDF and Web-oriented source contracts. @module */

import { factory } from '../factory.ts'
import type { Graph, Quad } from '../term.ts'
import { throwIfAborted, type TextSource } from '../text.ts'
import { parseTransform } from '../transform.ts'
import type { ParserConstructorType } from './types.ts'

export type { ParserConstructorType, ParserType } from './types.ts'

/** Vocabulary-registry entry used by the Microdata-to-RDF conversion algorithm. */
export interface VocabularyType {
  readonly properties?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly [key: string]: unknown
}

/** Microdata vocabulary registry keyed by vocabulary IRI prefix. */
export type VocabularyRegistryType = Readonly<Record<string, VocabularyType>>

/** Options for Microdata-to-RDF parsing. */
export interface ParseOptionsType {
  readonly base?: string
  readonly graph?: Graph
  /** Parse the input as strict XML/XHTML instead of HTML. */
  readonly xml?: boolean
  /** Replaces the processor's standard Microdata vocabulary registry when supplied. */
  readonly vocabularies?: VocabularyRegistryType
  /** External parser injection used by tests or alternate conforming implementations. */
  readonly parser?: ParserConstructorType
  readonly signal?: AbortSignal
}

/**
 * Parses HTML Microdata incrementally into native `@okikio/rdf` quads.
 *
 * Conversion follows the W3C Microdata-to-RDF algorithm implemented by the
 * external parser. The external Transform and HTML parser remain subpath-only.
 */
export async function* parse(source: TextSource, options: ParseOptionsType = {}): AsyncGenerator<Quad> {
  throwIfAborted(options.signal)
  const Parser = options.parser ?? await defaultParser()
  const parser = new Parser(parserOptions(options))
  yield* parseTransform(parser, source, { label: 'Microdata parser', ...(options.signal ? { signal: options.signal } : {}) })
}

/** Builds the upstream Microdata options while omitting absent optional fields. */
function parserOptions(options: ParseOptionsType): Readonly<Record<string, unknown>> {
  return {
    dataFactory: factory,
    xmlMode: options.xml ?? false,
    ...(options.base === undefined ? {} : { baseIRI: options.base }),
    ...(options.graph === undefined ? {} : { defaultGraph: options.graph }),
    ...(options.vocabularies === undefined ? {} : { vocabRegistry: options.vocabularies }),
  }
}

/** Lazily resolved Microdata parser constructor so importing the subpath does not initialize the optional processor. */
let parserPromise: Promise<ParserConstructorType> | undefined

/** Lazily imports the Microdata implementation only when this subpath is used. */
async function defaultParser(): Promise<ParserConstructorType> {
  parserPromise ??= import('microdata-rdf-streaming-parser').then((module) => module.MicrodataRdfParser as unknown as ParserConstructorType)
  return await parserPromise
}
