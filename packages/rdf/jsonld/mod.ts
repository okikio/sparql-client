/** Native JSON-LD 1.1 expansion, compaction, flattening, framing, and RDF conversion. @module */
import type { Quad } from '../term.ts'
import { compactValue } from './compact.ts'
import {
  type ActiveContextType,
  type ContextStateType,
  initial,
  JsonLdError,
  object,
  process,
} from './context.ts'
import { expandValue } from './expand.ts'
import { frame as applyFrame } from './frame.ts'
import { flatten as flattenNodes } from './node.ts'
import { fromRdf as rdfToJson, toRdf as jsonToRdf } from './rdf.ts'
import { createDocumentLoader, type LoaderOptionsType } from './loader.ts'
import type {
  DocumentLoaderType,
  EmbedType,
  JsonLdValueType,
  ProcessingModeType,
  RdfDirectionType,
  RemoteDocumentType,
} from './types.ts'
export { createDocumentLoader, JsonLdLoadError } from './loader.ts'
export { JsonLdError } from './context.ts'
export type { DocumentCacheType, LoaderOptionsType } from './loader.ts'
export type {
  DocumentLoaderType,
  EmbedType,
  JsonLdValueType,
  ProcessingModeType,
  RdfDirectionType,
  RemoteDocumentType,
} from './types.ts'

/** Processing options shared by native JSON-LD operations. */
export interface OptionsType extends LoaderOptionsType {
  /** Base IRI for relative identifiers. */ readonly base?: string
  /** JSON-LD processing mode. */ readonly processingMode?: ProcessingModeType
  /** Compact single-value arrays where allowed. */ readonly compactArrays?: boolean
  /** Compact absolute IRIs relative to the base. */ readonly compactToRelative?: boolean
  /** Context applied before expansion. */ readonly expandContext?: JsonLdValueType
  /** Extract every JSON-LD script from HTML rather than the first matching script. */ readonly extractAllScripts?:
    boolean
  /** Deterministic code-point ordering. */ readonly ordered?: boolean
  /** Maximum nested `@nest` levels accepted from one JSON-LD node object. Defaults to 128. */
  readonly maxNestDepth?: number
  /** Permit blank-node predicates in RDF output. */ readonly produceGeneralizedRdf?: boolean
  /** Directional string RDF mapping. */ readonly rdfDirection?: RdfDirectionType
  /** Convert known XSD values to JSON scalars during fromRdf. */ readonly useNativeTypes?: boolean
  /** Preserve rdf:type predicate rather than @type during fromRdf. */ readonly useRdfType?: boolean
  /** Initial framing embed mode. */ readonly embed?: EmbedType
  /** Include only explicitly framed properties. */ readonly explicit?: boolean
  /** Frame the default graph. */ readonly frameDefault?: boolean
  /** Omit default-only framed properties. */ readonly omitDefault?: boolean
  /** Omit unnecessary top-level @graph wrapper. */ readonly omitGraph?: boolean
  /** Require every declared frame property. */ readonly requireAll?: boolean
}

/** JSON serialization options. */
export interface SerializeOptionsType extends OptionsType {
  /** Number of spaces used to indent serialized JSON-LD output. */
  readonly space?: number
}
/** Expands JSON-LD using the package-owned JSON-LD 1.1 algorithms. */
export async function expand(
  input: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType[]> {
  return await expandPrepared(await prepareInput(input, options), options)
}

/** Compacts JSON-LD with one caller-supplied context. */
export async function compact(
  input: unknown,
  contextValue: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  const prepared = await prepareInput(input, options),
    expanded = await expandPrepared(prepared, options),
    state = stateFor(options),
    contextJson = asJson(contextValue),
    context = contextValueOf(contextJson),
    contextBase = prepared.documentUrl ?? options.base,
    processed = await process(
      initial(contextBase, options.processingMode ?? 'json-ld-1.1'),
      context,
      state,
      contextBase,
    ),
    compactBase = options.base ??
      ((options.compactToRelative ?? true) ? prepared.documentUrl : undefined),
    active = contextBaseOf(processed, compactBase)
  const compacted = await compactValue(active, null, expanded, state, {
    ...(options.compactArrays === undefined ? {} : { compactArrays: options.compactArrays }),
    ...(options.compactToRelative === undefined
      ? {}
      : { compactToRelative: options.compactToRelative }),
    ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
  })
  const includeContext = !emptyObject(context)
  if (object(compacted)) {
    if (!includeContext) return compacted
    return { '@context': context, ...compacted }
  }
  if (Array.isArray(compacted) && compacted.length === 0 && !includeContext) return {}
  return includeContext ? { '@context': context, '@graph': compacted } : { '@graph': compacted }
}
/** Returns one active context with exactly the requested compaction base. */
function contextBaseOf(
  context: ActiveContextType,
  base: string | undefined,
): ActiveContextType {
  if (context.base === base) return context
  if (base !== undefined) return { ...context, base }
  const { base: _base, ...withoutBase } = context
  return withoutBase
}

/** Flattens JSON-LD, optionally compacting with a context. */
export async function flatten(
  input: unknown,
  contextValue?: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  const values = flattenNodes(await expand(input, options))
  if (contextValue !== undefined) return compact(values, contextValue, options)
  return values
}

/** Frames JSON-LD using native node-map matching and embedding. */
export async function frame(
  input: unknown,
  frameValue: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  const frameJson = asJson(frameValue),
    expanded = await expand(input, options),
    frameExpanded = await expandFrame(frameJson, options),
    framed = applyFrame(expanded, frameExpanded, {
      ...(options.embed === undefined ? {} : { embed: options.embed }),
      ...(options.explicit === undefined ? {} : { explicit: options.explicit }),
      ...(options.omitDefault === undefined ? {} : { omitDefault: options.omitDefault }),
      ...(options.requireAll === undefined ? {} : { requireAll: options.requireAll }),
      ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
    })
  const context = object(frameJson) && Object.hasOwn(frameJson, '@context')
    ? frameJson['@context']
    : undefined
  if (context !== undefined) {
    const compacted = await compact(framed, context, options)
    if (
      options.omitGraph && object(compacted) && Array.isArray(compacted['@graph']) &&
      compacted['@graph'].length === 1
    ) return compacted['@graph'][0]!
    return compacted
  }
  return options.omitGraph && framed.length === 1 ? framed[0]! : framed
}

/** Converts JSON-LD directly into native RDF quads. */
export async function toRdf(
  input: unknown,
  options: OptionsType = {},
): Promise<Quad[]> {
  // To RDF treats every embedded JSON-LD script as one HTML document unless
  // the caller explicitly asks for first-script behavior. This operation-level
  // default differs from the general document-loader default.
  const expanded = await expand(input, {
    ...options,
    extractAllScripts: options.extractAllScripts ?? true,
  })
  return jsonToRdf(expanded, {
    ...(options.produceGeneralizedRdf === undefined
      ? {}
      : { produceGeneralizedRdf: options.produceGeneralizedRdf }),
    ...(options.rdfDirection === undefined ? {} : { rdfDirection: options.rdfDirection }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** Parses JSON-LD and emits native RDF quads. */
export async function* parse(
  input: unknown,
  options: OptionsType = {},
): AsyncGenerator<Quad> {
  for (const value of await toRdf(input, options)) yield value
}

/** Converts native RDF quads into expanded JSON-LD. */
export function fromRdf(
  source: Iterable<Quad>,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  return Promise.resolve(rdfToJson(source, {
    ...(options.rdfDirection === undefined ? {} : { rdfDirection: options.rdfDirection }),
    ...(options.useNativeTypes === undefined ? {} : { useNativeTypes: options.useNativeTypes }),
    ...(options.useRdfType === undefined ? {} : { useRdfType: options.useRdfType }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }))
}
/** Serializes native RDF quads as JSON-LD JSON text. */
export async function serialize(
  source: Iterable<Quad>,
  options: SerializeOptionsType = {},
): Promise<string> {
  return `${JSON.stringify(await fromRdf(source, options), null, options.space)}\n`
}
/** Prepares a JSON-LD frame with framing-only keyword preservation. */ async function expandFrame(
  frameValue: JsonLdValueType,
  options: OptionsType,
) {
  const state = stateFor(options),
    active = initial(options.base, options.processingMode ?? 'json-ld-1.1'),
    value = await expandValue(active, null, frameValue, options.base, state, {
      frame: true,
      ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
      ...(options.maxNestDepth === undefined ? {} : { maxNestDepth: options.maxNestDepth }),
    })
  return Array.isArray(value) ? value : value === null ? [] : [value]
}
/** Expands one already prepared document without loading the input a second time. */
async function expandPrepared(
  prepared: PreparedType,
  options: OptionsType,
): Promise<JsonLdValueType[]> {
  const state = stateFor(options)
  let context = initial(prepared.base, options.processingMode ?? 'json-ld-1.1')
  if (options.expandContext !== undefined) {
    context = await process(context, options.expandContext, state, prepared.base)
  }
  if (prepared.contextUrl) {
    context = await process(context, prepared.contextUrl, state, prepared.contextUrl)
  }
  const value = await expandValue(
    context,
    null,
    prepared.document,
    prepared.documentUrl ?? prepared.base,
    state,
    {
      ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
      ...(options.maxNestDepth === undefined ? {} : { maxNestDepth: options.maxNestDepth }),
    },
  )
  return Array.isArray(value)
    ? value.filter((item) => item !== null)
    : value === null
    ? []
    : [value]
}

/** Loads the operation input and normalizes unclassified loader failures to JSON-LD. */
async function loadInput(load: DocumentLoaderType, url: string): Promise<RemoteDocumentType> {
  try {
    return await load(url)
  } catch (error) {
    if (
      typeof error === 'object' && error !== null &&
      typeof (error as { code?: unknown }).code === 'string'
    ) throw error
    throw new JsonLdError(
      'loading document failed',
      `JSON-LD document '${url}' could not be loaded.`,
      error,
    )
  }
}

/** Creates operation-local remote context state. */ function stateFor(
  options: OptionsType,
): ContextStateType {
  return {
    load: createDocumentLoader(options),
    remote: new Set(),
    cache: new Map(),
    ...(options.signal ? { signal: options.signal } : {}),
  }
}
/** Prepared local or remote document plus effective base/context URL. */ interface PreparedType {
  /** Parsed JSON-LD document prepared for the current processor operation. */
  readonly document: JsonLdValueType
  /** Active-context base after applying an explicit caller `base` override. */ readonly base?:
    string
  /** Loaded document URL, including an HTML `base[href]` when one applies. */ readonly documentUrl?:
    string
  /** External context URL, when supplied by HTTP Link. */ readonly contextUrl?: string
}
/** Resolves input objects, JSON strings, remote URLs, and HTML JSON-LD script elements. */ async function prepareInput(
  input: unknown,
  options: OptionsType,
): Promise<PreparedType> {
  if (typeof input === 'string' && /^https?:\/\//iu.test(input)) {
    const load = createDocumentLoader(options),
      remote = await loadInput(load, input),
      base = remote.documentUrl
    if (typeof remote.document === 'string') {
      const extracted = html(remote.document, base, options.extractAllScripts ?? false)
      const activeBase = options.base ?? extracted.base
      return {
        document: extracted.document,
        ...(activeBase ? { base: activeBase } : {}),
        ...(extracted.base ? { documentUrl: extracted.base } : {}),
        ...(remote.contextUrl ? { contextUrl: remote.contextUrl } : {}),
      }
    }
    return {
      document: remote.document,
      base: options.base ?? base,
      documentUrl: base,
      ...(remote.contextUrl ? { contextUrl: remote.contextUrl } : {}),
    }
  }
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return {
          document: JSON.parse(trimmed) as JsonLdValueType,
          ...(options.base ? { base: options.base } : {}),
        }
      } catch (error) {
        throw new JsonLdError(
          'loading document failed',
          'JSON-LD string input is not valid JSON.',
          error,
        )
      }
    }
    if (/<script\b/iu.test(input)) {
      const extracted = html(input, options.base, options.extractAllScripts ?? false)
      return {
        document: extracted.document,
        ...(extracted.base ? { base: extracted.base } : {}),
      }
    }
    return { document: input, ...(options.base ? { base: options.base } : {}) }
  }
  return { document: asJson(input), ...(options.base ? { base: options.base } : {}) }
}
/** JSON-LD document and document base extracted from one HTML source. */
interface HtmlType {
  /** Parsed JSON-LD script content selected by the HTML content algorithm. */
  readonly document: JsonLdValueType
  /** Document Base URL after applying the first valid HTML `base[href]`. */
  readonly base?: string
}

/**
 * Extracts JSON-LD script content using the JSON-LD HTML content algorithm.
 *
 * The script body is raw text. HTML character references such as `&lt;` stay
 * unchanged inside JSON strings because HTML does not decode character
 * references in script data. A fragment selects exactly one script by `id`;
 * without a fragment, `extractAllScripts` selects every JSON-LD script and
 * merges array-valued script documents into the resulting document array.
 */
function html(
  source: string,
  documentUrl: string | undefined,
  all: boolean,
): HtmlType {
  const base = htmlBase(source, documentUrl)
  const scripts: JsonLdValueType[] = []
  const fragment = fragmentOf(documentUrl)
  let offset = 0

  while (true) {
    const open = source.slice(offset).search(/<script\b/iu)
    if (open < 0) break
    const start = offset + open
    const end = tagEnd(source, start + 7)
    if (end < 0) break
    const attrs = attributes(source.slice(start + 7, end))
    const type = (attrs.get('type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
    const id = attrs.get('id')
    const close = source.toLowerCase().indexOf('</script', end + 1)
    if (close < 0) break
    const closeEnd = source.indexOf('>', close)

    if (type === 'application/ld+json' && (!fragment || id === fragment)) {
      const value = script(source.slice(end + 1, close))
      if (all && !fragment && Array.isArray(value)) scripts.push(...value)
      else scripts.push(value)
      if (fragment || !all) break
    }
    offset = closeEnd < 0 ? source.length : closeEnd + 1
  }

  if (scripts.length === 0) {
    if (all && !fragment) return { document: [], ...(base ? { base } : {}) }
    throw new JsonLdError(
      'loading document failed',
      fragment
        ? `HTML document has no application/ld+json script with id '${fragment}'.`
        : 'HTML document has no application/ld+json script.',
    )
  }
  return {
    document: all && !fragment ? scripts : scripts[0]!,
    ...(base ? { base } : {}),
  }
}

/** Parses one JSON-LD script body and reports the specification error code. */
function script(source: string): JsonLdValueType {
  try {
    return JSON.parse(source) as JsonLdValueType
  } catch (error) {
    throw new JsonLdError(
      'invalid script element',
      'HTML JSON-LD script is not valid JSON.',
      error,
    )
  }
}

/** Returns the decoded fragment identifier used to select one HTML script. */
function fragmentOf(documentUrl: string | undefined): string {
  if (!documentUrl) return ''
  const raw = new URL(documentUrl).hash.slice(1)
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Resolves the first valid HTML `base[href]` against the fetched document URL. */
function htmlBase(source: string, documentUrl: string | undefined): string | undefined {
  if (!documentUrl) return undefined
  const fallback = new URL(documentUrl)
  fallback.hash = ''
  let offset = 0
  while (true) {
    const open = source.slice(offset).search(/<base\b/iu)
    if (open < 0) return fallback.href
    const start = offset + open
    const end = tagEnd(source, start + 5)
    if (end < 0) return fallback.href
    const href = attributes(source.slice(start + 5, end)).get('href')
    if (href !== undefined) {
      try {
        return new URL(href, fallback).href
      } catch {
        // HTML ignores an unusable base URL and continues with the fallback.
        return fallback.href
      }
    }
    offset = end + 1
  }
}

/** Finds a start-tag end while respecting quoted attributes. */ function tagEnd(
  text: string,
  offset: number,
) {
  let quote = ''
  for (let i = offset; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return -1
}
/** Parses focused script attributes needed by JSON-LD extraction. */ function attributes(
  value: string,
) {
  const map = new Map<string, string>()
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu
  for (const match of value.matchAll(re)) {
    map.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return map
}
/** Unwraps a JSON-LD context document to the context value consumed by the context processor. */
function contextValueOf(value: JsonLdValueType): JsonLdValueType {
  return object(value) && Object.hasOwn(value, '@context') ? value['@context']! : value
}

/** Tests whether a JSON-LD context contributes no term or keyword definitions. */
function emptyObject(value: JsonLdValueType): boolean {
  return object(value) && Object.keys(value).length === 0
}

/** Converts unknown JSON-compatible input to the recursive JSON-LD type. */ function asJson(
  value: unknown,
): JsonLdValueType {
  if (
    value === null || typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'boolean'
  ) return value
  if (Array.isArray(value)) return value.map(asJson)
  if (typeof value === 'object') {
    const result = Object.create(null) as Record<string, JsonLdValueType>
    for (const [key, item] of Object.entries(value)) result[key] = asJson(item)
    return result
  }
  throw new TypeError('JSON-LD input must be JSON-compatible.')
}
