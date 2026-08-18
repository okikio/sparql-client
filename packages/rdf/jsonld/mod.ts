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
import { createDocumentLoader, JsonLdLoadError, type LoaderOptionsType } from './loader.ts'
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
/** JSON serialization options. */ export interface SerializeOptionsType extends OptionsType {
  /** Number of spaces used to indent serialized JSON-LD output. */
  readonly space?: number
}
/** Expands JSON-LD using the package-owned JSON-LD 1.1 algorithms. */ export async function expand(
  input: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType[]> {
  const prepared = await prepareInput(input, options),
    state = stateFor(options),
    active = initial(prepared.base, options.processingMode ?? 'json-ld-1.1')
  let context = active
  if (options.expandContext !== undefined) {
    context = await process(context, options.expandContext, state, prepared.base)
  }
  if (prepared.contextUrl) {
    context = await process(context, prepared.contextUrl, state, prepared.base)
  }
  const value = await expandValue(context, null, prepared.document, prepared.base, state, {
    ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
  })
  return Array.isArray(value) ? value.filter((v) => v !== null) : value === null ? [] : [value]
}
/** Compacts JSON-LD with one caller-supplied context. */ export async function compact(
  input: unknown,
  contextValue: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  const expanded = await expand(input, options),
    state = stateFor(options),
    contextJson = asJson(contextValue),
    active = await process(
      initial(options.base, options.processingMode ?? 'json-ld-1.1'),
      contextJson,
      state,
      options.base,
    )
  const compacted = await compactValue(active, null, expanded, state, {
    ...(options.compactArrays === undefined ? {} : { compactArrays: options.compactArrays }),
    ...(options.compactToRelative === undefined
      ? {}
      : { compactToRelative: options.compactToRelative }),
    ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
  })
  if (object(compacted)) return { '@context': contextJson, ...compacted }
  return { '@context': contextJson, '@graph': compacted }
}
/** Flattens JSON-LD, optionally compacting with a context. */ export async function flatten(
  input: unknown,
  contextValue?: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  const values = flattenNodes(await expand(input, options))
  if (contextValue !== undefined) return compact(values, contextValue, options)
  return values
}
/** Frames JSON-LD using native node-map matching and embedding. */ export async function frame(
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
/** Converts JSON-LD directly into native RDF quads. */ export async function toRdf(
  input: unknown,
  options: OptionsType = {},
): Promise<Quad[]> {
  return jsonToRdf(await expand(input, options), {
    ...(options.produceGeneralizedRdf === undefined
      ? {}
      : { produceGeneralizedRdf: options.produceGeneralizedRdf }),
    ...(options.rdfDirection === undefined ? {} : { rdfDirection: options.rdfDirection }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}
/** Parses JSON-LD and emits native RDF quads. */ export async function* parse(
  input: unknown,
  options: OptionsType = {},
): AsyncGenerator<Quad> {
  for (const value of await toRdf(input, options)) yield value
}
/** Converts native RDF quads into expanded JSON-LD. */ export async function fromRdf(
  source: Iterable<Quad>,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  return rdfToJson(source, {
    ...(options.rdfDirection === undefined ? {} : { rdfDirection: options.rdfDirection }),
    ...(options.useNativeTypes === undefined ? {} : { useNativeTypes: options.useNativeTypes }),
    ...(options.useRdfType === undefined ? {} : { useRdfType: options.useRdfType }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}
/** Serializes native RDF quads as JSON-LD JSON text. */ export async function serialize(
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
    })
  return Array.isArray(value) ? value : value === null ? [] : [value]
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
  /** Effective base/document URL. */ readonly base?: string
  /** External context URL, when supplied by HTTP Link. */ readonly contextUrl?: string
}
/** Resolves input objects, JSON strings, remote URLs, and HTML JSON-LD script elements. */ async function prepareInput(
  input: unknown,
  options: OptionsType,
): Promise<PreparedType> {
  if (typeof input === 'string' && /^https?:\/\//iu.test(input)) {
    const load = createDocumentLoader(options),
      remote = await load(input),
      base = remote.documentUrl
    if (typeof remote.document === 'string') {
      return {
        document: html(remote.document, base, options.extractAllScripts ?? false),
        base,
        ...(remote.contextUrl ? { contextUrl: remote.contextUrl } : {}),
      }
    }
    return {
      document: remote.document,
      base,
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
      return {
        document: html(input, options.base, options.extractAllScripts ?? false),
        ...(options.base ? { base: options.base } : {}),
      }
    }
    return { document: input, ...(options.base ? { base: options.base } : {}) }
  }
  return { document: asJson(input), ...(options.base ? { base: options.base } : {}) }
}
/** Extracts application/ld+json raw-text script contents without parsing HTML as a DOM. */ function html(
  source: string,
  documentUrl: string | undefined,
  all: boolean,
): JsonLdValueType {
  const scripts: JsonLdValueType[] = []
  let offset = 0
  const fragment = documentUrl ? new URL(documentUrl).hash.slice(1) : ''
  while (true) {
    const open = source.slice(offset).search(/<script\b/iu)
    if (open < 0) break
    const start = offset + open, end = tagEnd(source, start + 7)
    if (end < 0) break
    const attrs = attributes(source.slice(start + 7, end)),
      type = (attrs.get('type') ?? '').split(';', 1)[0]!.trim().toLowerCase(),
      id = attrs.get('id')
    const close = source.toLowerCase().indexOf('</script', end + 1)
    if (close < 0) break
    const closeEnd = source.indexOf('>', close)
    if (type === 'application/ld+json' && (!fragment || id === fragment)) {
      const text = source.slice(end + 1, close)
      try {
        scripts.push(JSON.parse(text) as JsonLdValueType)
      } catch (error) {
        throw new JsonLdError(
          'loading document failed',
          'HTML JSON-LD script is not valid JSON.',
          error,
        )
      }
      if (fragment || !all) break
    }
    offset = closeEnd < 0 ? source.length : closeEnd + 1
  }
  if (!scripts.length) return []
  return all ? scripts : scripts[0]!
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
/** Converts unknown JSON-compatible input to the recursive JSON-LD type. */ function asJson(
  value: unknown,
): JsonLdValueType {
  if (
    value === null || typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'boolean'
  ) return value
  if (Array.isArray(value)) return value.map(asJson)
  if (typeof value === 'object') {
    const result: Record<string, JsonLdValueType> = {}
    for (const [key, item] of Object.entries(value)) result[key] = asJson(item)
    return result
  }
  throw new TypeError('JSON-LD input must be JSON-compatible.')
}
