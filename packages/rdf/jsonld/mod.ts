/** Full JSON-LD processing facade with bounded document loading. @module */

import { parse as parseNQuads, write as writeNQuads } from '../nquads/mod.ts'
import type { Quad } from '../term.ts'
import { createDocumentLoader, type LoaderOptionsType } from './loader.ts'
import type { JsonLdValueType, ProcessorType } from './types.ts'

export { createDocumentLoader, JsonLdLoadError } from './loader.ts'
export type { DocumentCacheType, LoaderOptionsType } from './loader.ts'
export type { DocumentLoaderType, JsonLdValueType, ProcessorType, RemoteDocumentType } from './types.ts'

/** Default max rdf bytes used when the caller does not provide an override. */
const DEFAULT_MAX_RDF_BYTES = 64 * 1024 * 1024

/** Processing options shared by JSON-LD operations. */
export interface OptionsType extends LoaderOptionsType {
  /** Optional processor injection for tests, custom builds, or alternate conforming engines. */
  readonly processor?: ProcessorType
  /** Base IRI forwarded to the JSON-LD processor. */
  readonly base?: string
  /** Maximum intermediary N-Quads bytes for JSON-LD/RDF conversion. */
  readonly maxRdfBytes?: number
}

/** JSON text serialization options. */
export interface SerializeOptionsType extends OptionsType {
  readonly space?: number
}

/** Expands JSON-LD using the JSON-LD 1.1 processing algorithm. */
export async function expand(input: unknown, options: OptionsType = {}): Promise<JsonLdValueType[]> {
  const { processor, settings } = await prepare(options)
  const result = await processor.expand(input, settings)
  abort(options.signal)
  return result
}

/** Compact as a focused public package operation. */
export async function compact(input: unknown, context: unknown, options: OptionsType = {}): Promise<JsonLdValueType> {
  const { processor, settings } = await prepare(options)
  const result = await processor.compact(input, context, settings)
  abort(options.signal)
  return result
}

/** Flattens JSON-LD, optionally compacting it with a context. */
export async function flatten(input: unknown, context?: unknown, options: OptionsType = {}): Promise<JsonLdValueType> {
  const { processor, settings } = await prepare(options)
  const result = await processor.flatten(input, context, settings)
  abort(options.signal)
  return result
}

/** Frames JSON-LD with one JSON-LD frame. */
export async function frame(input: unknown, value: unknown, options: OptionsType = {}): Promise<JsonLdValueType> {
  const { processor, settings } = await prepare(options)
  const result = await processor.frame(input, value, settings)
  abort(options.signal)
  return result
}

/** Converts JSON-LD into native `@okikio/rdf` quads through standards N-Quads. */
export async function toRdf(input: unknown, options: OptionsType = {}): Promise<Quad[]> {
  const { processor, settings } = await prepare(options)
  const result = await processor.toRDF(input, { ...settings, format: 'application/n-quads' })
  if (typeof result !== 'string') throw new TypeError('JSON-LD processor did not return N-Quads for application/n-quads.')
  limit(result, options.maxRdfBytes ?? DEFAULT_MAX_RDF_BYTES)
  const quads: Quad[] = []
  const parseOptions = options.signal ? { signal: options.signal } : {}
  for await (const value of parseNQuads(result, parseOptions)) quads.push(value)
  abort(options.signal)
  return quads
}

/** Parses JSON-LD and emits native RDF quads. Processing is materialized by jsonld.js before emission. */
export async function* parse(input: unknown, options: OptionsType = {}): AsyncGenerator<Quad> {
  for (const value of await toRdf(input, options)) yield value
}

/** Converts native RDF quads to expanded JSON-LD. */
export async function fromRdf(source: Iterable<Quad>, options: OptionsType = {}): Promise<JsonLdValueType> {
  abort(options.signal)
  const text = writeNQuads(source)
  limit(text, options.maxRdfBytes ?? DEFAULT_MAX_RDF_BYTES)
  const { processor, settings } = await prepare(options)
  const result = await processor.fromRDF(text, { ...settings, format: 'application/n-quads' })
  abort(options.signal)
  return result
}

/** Serializes native RDF quads as JSON-LD JSON text. */
export async function serialize(source: Iterable<Quad>, options: SerializeOptionsType = {}): Promise<string> {
  return `${JSON.stringify(await fromRdf(source, options), null, options.space)}\n`
}

/** Prepares one operation with an operation-local bounded document loader. */
async function prepare(options: OptionsType): Promise<{
  readonly processor: ProcessorType
  readonly settings: Readonly<Record<string, unknown>>
}> {
  abort(options.signal)
  const processor = options.processor ?? await defaultProcessor()
  const documentLoader = createDocumentLoader(options)
  return {
    processor,
    settings: options.base === undefined ? { documentLoader } : { base: options.base, documentLoader },
  }
}

/** Lazily resolved JSON-LD processor shared across operations without making the RDF root import processor code. */
let processorPromise: Promise<ProcessorType> | undefined

/** Lazily imports jsonld.js only when this subpath actually performs processing. */
async function defaultProcessor(): Promise<ProcessorType> {
  processorPromise ??= import('jsonld').then((module) => {
    const value = 'default' in module ? module.default : module
    return value as unknown as ProcessorType
  })
  return await processorPromise
}

/** Increments one JSON-LD operation counter and fails before the configured work limit is exceeded. */
function limit(value: string, maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxRdfBytes must be a positive safe integer.')
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes > maxBytes) throw new RangeError(`JSON-LD RDF intermediary exceeds maxRdfBytes (${maxBytes}).`)
}

/** Throws the caller supplied abort reason when cancellation has been requested. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
