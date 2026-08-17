/** RDFa 1.1 parsing behind native RDF and Web-oriented source contracts. @module */

import { factory } from '../factory.ts'
import type { Graph, Quad } from '../term.ts'
import { throwIfAborted, type TextSource } from '../text.ts'
import { parseTransform } from '../transform.ts'
import type { ParserConstructorType } from './types.ts'

export type { ParserConstructorType, ParserType } from './types.ts'

/** RDFa profiles implemented by the external RDFa 1.1 processor. */
export type ProfileType = '' | 'core' | 'html' | 'xhtml' | 'svg' | 'xml'

/** Known content types that select an RDFa host-language profile. */
export type ContentType =
  | 'text/html'
  | 'application/xhtml+xml'
  | 'application/xml'
  | 'text/xml'
  | 'image/svg+xml'

/** RDFa feature switches exposed by the upstream processor. */
export type FeatureType = Readonly<Record<string, boolean>>

/** Options for RDFa 1.1 parsing. */
export interface ParseOptionsType {
  readonly base?: string
  readonly graph?: Graph
  readonly language?: string
  readonly vocab?: string
  /** Host-language content type. Prefer this over a manual profile when known. */
  readonly contentType?: ContentType
  /** Explicit RDFa host-language profile when a content type is unavailable. */
  readonly profile?: ProfileType
  /** Fine-grained processor features for specialist integrations. */
  readonly features?: FeatureType
  /** External parser injection used by tests or alternate conforming implementations. */
  readonly parser?: ParserConstructorType
  readonly signal?: AbortSignal
}

/**
 * Parses RDFa 1.1 incrementally into native `@okikio/rdf` quads.
 *
 * The RDFa implementation stays behind this subpath because its HTML parser and
 * Node-style stream dependencies should not enter the root RDF module graph.
 */
export async function* parse(source: TextSource, options: ParseOptionsType = {}): AsyncGenerator<Quad> {
  throwIfAborted(options.signal)
  const Parser = options.parser ?? await defaultParser()
  const parser = new Parser(parserOptions(options))
  yield* parseTransform(parser, source, { label: 'RDFa parser', ...(options.signal ? { signal: options.signal } : {}) })
}

/** Builds the upstream RDFa options while omitting absent optional fields. */
function parserOptions(options: ParseOptionsType): Readonly<Record<string, unknown>> {
  return {
    dataFactory: factory,
    ...(options.base === undefined ? {} : { baseIRI: options.base }),
    ...(options.graph === undefined ? {} : { defaultGraph: options.graph }),
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.vocab === undefined ? {} : { vocab: options.vocab }),
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.features === undefined ? {} : { features: options.features }),
  }
}

/** Lazily resolved RDFa parser constructor so importing the subpath does not initialize the optional processor. */
let parserPromise: Promise<ParserConstructorType> | undefined

/** Lazily imports the RDFa implementation only when this subpath is used. */
async function defaultParser(): Promise<ParserConstructorType> {
  parserPromise ??= import('rdfa-streaming-parser').then((module) => module.RdfaParser as unknown as ParserConstructorType)
  return await parserPromise
}
