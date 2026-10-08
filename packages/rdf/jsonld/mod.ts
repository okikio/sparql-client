/** Native JSON-LD 1.1 expansion, compaction, flattening, framing, and RDF conversion. @module */
import type { Quad } from '../term.ts'
import { compactIri, compactValue } from './compact.ts'
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
import { html } from './html.ts'
import { flatten as flattenNodes } from './node.ts'
import { fromRdf as rdfToJson, toRdf as jsonToRdf } from './rdf.ts'
import { createDocumentLoader, type LoaderOptionsType } from './loader.ts'
import type {
  DocumentLoaderType,
  EmbedType,
  GeneralizedQuadType,
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
  GeneralizedQuadType,
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
/** Private operation token survives option spreads within one public call. */
const OPERATION = Symbol('JSON-LD document admission')
type OperationOptionsType = OptionsType & { readonly [OPERATION]?: DocumentLoaderType }
/** Shares input, expansion, framing and compaction admission within one operation; caller options are never mutated. */
function operation(options: OptionsType): OperationOptionsType {
  if ((options as OperationOptionsType)[OPERATION]) return options as OperationOptionsType
  return { ...options, [OPERATION]: createDocumentLoader(options) }
}

/** Expands JSON-LD using the package-owned JSON-LD 1.1 algorithms. */
export async function expand(
  input: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType[]> {
  options = operation(options)
  return await expandPrepared(await prepareInput(input, options), options)
}

/** Compacts JSON-LD with one caller-supplied context. */
export async function compact(
  input: unknown,
  contextValue: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  options = operation(options)
  const prepared = await prepareInput(input, options)
  let expanded: JsonLdValueType[]
  try {
    expanded = await expandPrepared(prepared, options)
  } catch (error) {
    if (error instanceof JsonLdError && error.code === 'list of lists') {
      throw new JsonLdError(
        'compaction to list of lists',
        'JSON-LD 1.0 compaction cannot represent nested lists.',
        error,
      )
    }
    throw error
  }
  return await compactExpanded(
    expanded,
    contextValue,
    options,
    prepared.documentUrl ?? options.base,
  )
}

/** Compacts already expanded data without discarding framing-only preserve markers. */
async function compactExpanded(
  expanded: JsonLdValueType,
  contextValue: unknown,
  options: OptionsType,
  contextBase: string | undefined,
  preferContextBase = false,
): Promise<JsonLdValueType> {
  const state = stateFor(options),
    contextJson = asJson(contextValue),
    context = contextValueOf(contextJson),
    processed = await process(
      initial(contextBase, options.processingMode ?? 'json-ld-1.1'),
      context,
      state,
      contextBase,
    ),
    compactBase = (preferContextBase ? processed.base : options.base) ??
      ((options.compactToRelative ?? true) ? processed.base : undefined),
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
  const graph = compactIri(active, '@graph', undefined, true)
  return includeContext ? { '@context': context, [graph]: compacted } : { [graph]: compacted }
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
  options = operation(options)
  const values = flattenNodes(await expand(input, options))
  if (contextValue !== undefined) {
    const compacted = await compact(values, contextValue, options)
    if (object(compacted) && !Object.hasOwn(compacted, '@graph')) {
      const { '@context': context, ...node } = compacted
      return {
        ...(context === undefined ? {} : { '@context': context }),
        '@graph': Object.keys(node).length ? [node] : [],
      }
    }
    return compacted
  }
  return values
}

/** Frames JSON-LD using native node-map matching and embedding. */
export async function frame(
  input: unknown,
  frameValue: unknown,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  options = operation(options)
  const frameJson = asJson(frameValue),
    expanded = await expand(input, options),
    frameExpanded = await expandFrame(frameJson, options),
    framed = applyFrame(expanded, frameExpanded, {
      ...(options.processingMode === undefined ? {} : { processingMode: options.processingMode }),
      ...(options.frameDefault === undefined ? {} : { frameDefault: options.frameDefault }),
      ...(options.embed === undefined ? {} : { embed: options.embed }),
      ...(options.explicit === undefined ? {} : { explicit: options.explicit }),
      ...(options.omitDefault === undefined ? {} : { omitDefault: options.omitDefault }),
      ...(options.requireAll === undefined ? {} : { requireAll: options.requireAll }),
      ...(options.ordered === undefined ? {} : { ordered: options.ordered }),
    })
  const context = object(frameJson) && Object.hasOwn(frameJson, '@context')
    ? frameJson['@context']
    : {}
  {
    if (options.processingMode !== 'json-ld-1.0') pruneBlankIds(framed)
    const compacted = removePreserve(
      await compactExpanded(framed, context, options, options.base, true),
    )
    if (!(options.omitGraph ?? options.processingMode !== 'json-ld-1.0') && object(compacted)) {
      if (Object.hasOwn(compacted, '@graph')) return compacted
      const { '@context': compactContext, ...node } = compacted
      return {
        ...(compactContext === undefined ? {} : { '@context': compactContext }),
        '@graph': Object.keys(node).length ? [node] : [],
      }
    }
    if (
      options.omitGraph && object(compacted) && Array.isArray(compacted['@graph']) &&
      compacted['@graph'].length === 1
    ) return compacted['@graph'][0]!
    return compacted
  }
}

/** Removes framing-only default markers before the ordinary compaction pass. */
function removePreserve(value: JsonLdValueType): JsonLdValueType {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const converted = removePreserve(item)
      if (converted === null) return []
      return object(item) && Object.hasOwn(item, '@preserve') && Array.isArray(converted)
        ? converted
        : [converted]
    })
  }
  if (!object(value)) return value
  if (Object.hasOwn(value, '@preserve')) {
    const preserved = value['@preserve']!
    return preserved === '@null'
      ? null
      : Array.isArray(preserved)
      ? preserved.filter((item) => item !== '@null').map(removePreserve)
      : removePreserve(preserved)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removePreserve(item)]))
}

/** Drops a blank identifier only when its framed occurrence cannot be referenced elsewhere. */
function pruneBlankIds(value: JsonLdValueType): void {
  const counts = new Map<string, number>()
  const visit = (item: JsonLdValueType, remove: boolean): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child, remove)
      return
    }
    if (!object(item)) return
    const id = item['@id']
    if (typeof id === 'string' && id.startsWith('_:')) {
      if (remove && counts.get(id) === 1) delete item['@id']
      else if (!remove) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const [key, child] of Object.entries(item)) {
      if (key === '@value') continue
      if (!remove && key === '@type') {
        for (const type of Array.isArray(child) ? child : [child]) {
          if (typeof type === 'string' && type.startsWith('_:')) {
            counts.set(type, (counts.get(type) ?? 0) + 1)
          }
        }
      }
      visit(child, remove)
    }
  }
  visit(value, false)
  visit(value, true)
}

/**
 * Converts one JSON-LD document into native RDF statements.
 *
 * Blank identities are shared within the conversion and freshly allocated
 * between conversions, so combining independently converted documents cannot
 * merge their unrelated source blank labels. Enabling `produceGeneralizedRdf`
 * permits blank predicates and returns `GeneralizedQuadType` statements;
 * standard RDF datasets and writers require ordinary `Quad` statements.
 */
export function toRdf(
  input: unknown,
  options?: OptionsType & { readonly produceGeneralizedRdf?: false },
): Promise<Quad[]>
/** Converts JSON-LD with explicitly enabled generalized blank-node predicates. */
export function toRdf(
  input: unknown,
  options: OptionsType & { readonly produceGeneralizedRdf: true },
): Promise<GeneralizedQuadType[]>
/** Returns the wider statement type when the generalized option is decided at runtime. */
export function toRdf(input: unknown, options: OptionsType): Promise<GeneralizedQuadType[]>
export async function toRdf(
  input: unknown,
  options: OptionsType = {},
): Promise<GeneralizedQuadType[]> {
  options = operation(options)
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
export function parse(
  input: unknown,
  options?: OptionsType & { readonly produceGeneralizedRdf?: false },
): AsyncGenerator<Quad>
/** Emits generalized statements when blank-node predicates are explicitly enabled. */
export function parse(
  input: unknown,
  options: OptionsType & { readonly produceGeneralizedRdf: true },
): AsyncGenerator<GeneralizedQuadType>
/** Emits the wider statement type when the generalized option is decided at runtime. */
export function parse(input: unknown, options: OptionsType): AsyncGenerator<GeneralizedQuadType>
export async function* parse(
  input: unknown,
  options: OptionsType = {},
): AsyncGenerator<GeneralizedQuadType> {
  for (const value of await toRdf(input, options)) yield value
}

/** Converts native RDF quads into expanded JSON-LD. */
// deno-lint-ignore require-await -- Async guarantees that synchronous RDF conversion failures reject the public Promise.
export async function fromRdf(
  source: Iterable<Quad>,
  options: OptionsType = {},
): Promise<JsonLdValueType> {
  options = operation(options)
  return rdfToJson(source, {
    ...(options.processingMode === undefined ? {} : { processingMode: options.processingMode }),
    ...(options.rdfDirection === undefined ? {} : { rdfDirection: options.rdfDirection }),
    ...(options.useNativeTypes === undefined ? {} : { useNativeTypes: options.useNativeTypes }),
    ...(options.useRdfType === undefined ? {} : { useRdfType: options.useRdfType }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
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
  options = operation(options)
  const state = stateFor(options)
  let context = initial(prepared.base, options.processingMode ?? 'json-ld-1.1')
  if (options.expandContext !== undefined) {
    context = await process(context, options.expandContext, state, prepared.base)
  }
  if (prepared.contextUrl) {
    context = await process(context, prepared.contextUrl, state, prepared.contextUrl)
  }
  let value = await expandValue(
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
  // A sole top-level @graph wrapper denotes the document's default graph.
  if (object(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '@graph')) {
    value = value['@graph']!
  }
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
    load: operation(options)[OPERATION]!,
    htmlPolicy: options,
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
    const load = operation(options)[OPERATION]!,
      remote = await loadInput(load, input),
      base = remote.documentUrl
    if (typeof remote.document === 'string') {
      const extracted = html(
        remote.document,
        base,
        options.extractAllScripts ?? false,
        options.base ?? base,
        { ...options, xml: remote.contentType === 'application/xhtml+xml' },
      )
      const activeBase = extracted.base
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
      const extracted = html(
        input,
        options.base,
        options.extractAllScripts ?? false,
        options.base,
        options,
      )
      return {
        document: extracted.document,
        ...(extracted.base ? { base: extracted.base } : {}),
      }
    }
    return { document: input, ...(options.base ? { base: options.base } : {}) }
  }
  return { document: asJson(input), ...(options.base ? { base: options.base } : {}) }
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
