/** JSON-LD 1.1 active-context processing and IRI expansion. @module */
import type { DocumentLoaderType, JsonLdValueType, ProcessingModeType } from './types.ts'
import { resolve as resolveReference } from '../iri.ts'
import { html } from './html.ts'
/** JSON-LD 1.1 keywords. */
export const KEYWORDS = new Set([
  '@base',
  '@container',
  '@context',
  '@direction',
  '@graph',
  '@id',
  '@import',
  '@included',
  '@index',
  '@json',
  '@language',
  '@list',
  '@nest',
  '@none',
  '@prefix',
  '@propagate',
  '@protected',
  '@reverse',
  '@set',
  '@type',
  '@value',
  '@version',
  '@vocab',
])
/** Framing-only keywords. */
export const FRAME_KEYWORDS = new Set([
  '@default',
  '@embed',
  '@explicit',
  '@omitDefault',
  '@requireAll',
])
/** One processed term definition. */
export interface TermDefinitionType {
  /** Expanded IRI or keyword assigned to the term; null disables the term mapping. */
  readonly id: string | null
  /** Can prefix compact IRIs. */ readonly prefix: boolean
  /** Can produce a compact IRI during compaction; legacy expanded definitions only expand prefixes. */ readonly compactPrefix?:
    boolean
  /** Cannot be redefined by normal local contexts. */ readonly protected: boolean
  /** Values are reverse properties. */ readonly reverse: boolean
  /** Container mappings. */ readonly container: readonly string[]
  /** Type coercion. */ readonly type?: string
  /** Language mapping. */ readonly language?: string | null
  /** Direction mapping. */ readonly direction?: 'ltr' | 'rtl' | null
  /** Property/type-scoped context. */ readonly context?: JsonLdValueType
  /** Base of scoped context. */ readonly base?: string
  /** Custom @index key. */ readonly index?: string
  /** Compaction nest key. */ readonly nest?: string
}
/** Active JSON-LD context. */
export interface ActiveContextType {
  /** Processed JSON-LD term definitions indexed by active term name. */
  readonly terms: ReadonlyMap<string, TermDefinitionType>
  /** Current base. */ readonly base?: string
  /** Original operation base. */ readonly originalBase?: string
  /** Default vocab. */ readonly vocab?: string
  /** Default language. */ readonly language?: string | null
  /** Default direction. */ readonly direction?: 'ltr' | 'rtl' | null
  /** Processing mode. */ readonly mode: ProcessingModeType
  /** Previous context for non-propagation. */ readonly previous?: ActiveContextType
}
/** Shared recursive context-processing state. */
export interface ContextStateType {
  /** Input size and cancellation policy for JSON-LD script extraction from HTML documents. */
  readonly htmlPolicy?: { readonly maxBytes?: number; readonly signal?: AbortSignal }
  /** Bounded document loader used for remote JSON-LD contexts and documents. */
  readonly load: DocumentLoaderType
  /** Active remote context recursion stack. */ readonly remote: Set<string>
  /** Loaded remote context cache. */ readonly cache: Map<string, {
    /** JSON-LD context value retained in this remote-context cache entry. */
    readonly context: JsonLdValueType
    /** Effective base IRI used while resolving relative identifiers during JSON-LD processing. */
    readonly base: string
  }>
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** JSON-LD conformance error carrying the specification code. */
export class JsonLdError extends Error {
  /** Stable JSON-LD specification error code exposed to callers. */
  readonly code: string
  /** Compatibility details shape. */ readonly details: {
    /** Stable JSON-LD specification error code exposed to callers. */
    readonly code: string
  }
  /** Creates one stable processing error. */ constructor(
    code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'JsonLdError'
    this.code = code
    this.details = { code }
  }
}
/** Loads one remote context and converts loader failures to the context-processing error. */
async function loadContext(state: ContextStateType, url: string) {
  try {
    const document = await state.load(url)
    if (typeof document.document !== 'string') return document
    const extracted = html(document.document, document.documentUrl, false, document.documentUrl, {
      ...state.htmlPolicy,
      xml: document.contentType === 'application/xhtml+xml',
    })
    return {
      ...document,
      document: extracted.document,
      documentUrl: extracted.base ?? document.documentUrl,
    }
  } catch (error) {
    fail('loading remote context failed', `Remote context '${url}' could not be loaded.`, error)
  }
}

/** Creates an empty active context. */
export function initial(
  base: string | undefined,
  mode: ProcessingModeType = 'json-ld-1.1',
): ActiveContextType {
  return { terms: new Map(), ...(base ? { base, originalBase: base } : {}), mode }
}
/** Processes local/remote contexts into an immutable active context. */
export async function process(
  active: ActiveContextType,
  local: JsonLdValueType,
  state: ContextStateType,
  base = active.base,
  propagate = true,
  remote = false,
  overrideProtected = false,
  validateScoped = true,
): Promise<ActiveContextType> {
  abort(state.signal)
  let result = clone(active)
  for (const context of (Array.isArray(local) ? local : [local])) {
    abort(state.signal)
    if (context === null) {
      if (!overrideProtected && [...result.terms.values()].some((v) => v.protected)) {
        fail('invalid context nullification', 'A context with protected terms cannot be nullified.')
      }
      const reset = initial(active.originalBase, active.mode)
      result = propagate ? reset : { ...reset, previous: active }
      continue
    }
    if (typeof context === 'string') {
      const url = resolve(context, base)
      if (!url) {
        fail('loading remote context failed', `Remote context '${context}' cannot be resolved.`)
      }
      if (state.remote.has(url)) {
        if (!validateScoped) continue
        fail('recursive context inclusion', `Remote context recursively includes '${url}'.`)
      }
      state.remote.add(url)
      try {
        const cached = state.cache.get(url)
        if (cached) {
          result = await process(
            result,
            cached.context,
            state,
            cached.base,
            propagate,
            true,
            overrideProtected,
            validateScoped,
          )
          continue
        }
        const doc = await loadContext(state, url)
        if (!object(doc.document) || !Object.hasOwn(doc.document, '@context')) {
          fail('invalid remote context', `Remote context '${url}' has no @context.`)
        }
        const value = doc.document['@context']!
        state.cache.set(url, { context: value, base: doc.documentUrl })
        result = await process(
          result,
          value,
          state,
          doc.documentUrl,
          propagate,
          true,
          overrideProtected,
          validateScoped,
        )
      } finally {
        state.remote.delete(url)
      }
      continue
    }
    if (!object(context)) {
      fail('invalid local context', 'A local context must be null, string, object, or array.')
    }
    let def = { ...context }
    if (Object.hasOwn(def, '@version')) {
      if (def['@version'] !== 1.1) fail('invalid @version value', '@version must be 1.1.')
      if (result.mode === 'json-ld-1.0') {
        fail('processing mode conflict', 'JSON-LD 1.0 cannot process @version 1.1.')
      }
    }
    if (Object.hasOwn(def, '@import')) {
      if (result.mode === 'json-ld-1.0') {
        fail('invalid context entry', '@import is unavailable in JSON-LD 1.0.')
      }
      const raw = def['@import']
      if (typeof raw !== 'string') fail('invalid @import value', '@import must be a string.')
      const url = resolve(raw, base)
      if (!url) {
        fail('loading remote context failed', `Imported context '${raw}' cannot be resolved.`)
      }
      const doc = await loadContext(state, url)
      if (!object(doc.document) || !object(doc.document['@context'])) {
        fail('invalid remote context', 'Imported context must contain an object @context.')
      }
      const imported = doc.document['@context'] as Record<string, JsonLdValueType>
      if (Object.hasOwn(imported, '@import')) {
        fail('invalid context entry', 'Imported context cannot contain @import.')
      }
      def = { ...imported, ...def }
      delete def['@import']
    }
    if (Object.hasOwn(def, '@propagate')) {
      if (result.mode === 'json-ld-1.0') {
        fail('invalid context entry', '@propagate is unavailable in JSON-LD 1.0.')
      }
      if (typeof def['@propagate'] !== 'boolean') {
        fail('invalid @propagate value', '@propagate must be boolean.')
      }
      propagate = def['@propagate'] as boolean
    }
    if (!propagate && !result.previous) result = { ...result, previous: active }
    if (Object.hasOwn(def, '@base') && !remote) {
      const value = def['@base']
      if (value === null) result = omit(result, 'base')
      else if (typeof value !== 'string') fail('invalid base IRI', '@base must be null or string.')
      else {
        const expanded = absolute(value) ? value : resolve(value, result.base)
        if (!expanded) fail('invalid base IRI', `Cannot resolve @base '${value}'.`)
        result = { ...result, base: expanded }
      }
    }
    if (Object.hasOwn(def, '@vocab')) {
      const value = def['@vocab']
      if (value === null) result = omit(result, 'vocab')
      else if (typeof value !== 'string') {
        fail('invalid vocab mapping', '@vocab must be null or string.')
      } else {
        const expanded = expandIri(result, value, {
          documentRelative: result.mode !== 'json-ld-1.0',
          vocab: true,
        })
        if (!expanded || (!absolute(expanded) && !expanded.startsWith('_:'))) {
          fail('invalid vocab mapping', '@vocab does not expand to an IRI.')
        }
        result = { ...result, vocab: expanded }
      }
    }
    if (Object.hasOwn(def, '@language')) {
      const value = def['@language']
      if (value !== null && typeof value !== 'string') {
        fail('invalid default language', '@language must be null or string.')
      }
      result = { ...result, language: typeof value === 'string' ? value.toLowerCase() : null }
    }
    if (Object.hasOwn(def, '@direction')) {
      const value = def['@direction']
      if (value !== null && value !== 'ltr' && value !== 'rtl') {
        fail('invalid base direction', '@direction must be null, ltr, or rtl.')
      }
      result = { ...result, direction: value as 'ltr' | 'rtl' | null }
    }
    const terms = new Map(result.terms), defined = new Map<string, boolean>()
    for (const key of Object.keys(def)) {
      if (
        [
          '@base',
          '@vocab',
          '@language',
          '@direction',
          '@version',
          '@import',
          '@propagate',
          '@protected',
        ].includes(key)
      ) continue
      create(key, def, terms, result, state, base, defined, overrideProtected)
    }
    result = { ...result, terms }
    if (validateScoped) {
      for (const key of Object.keys(def)) {
        const scoped = terms.get(key)
        if (scoped?.context === undefined) continue
        try {
          await process(
            result,
            scoped.context,
            state,
            scoped.base ?? base,
            true,
            false,
            true,
            false,
          )
        } catch (error) {
          fail('invalid scoped context', `Scoped context for '${key}' is invalid.`, error)
        }
      }
    }
  }
  return result
}
/** Creates/removes one term definition with recursive prefix creation. */ function create(
  term: string,
  local: Readonly<Record<string, JsonLdValueType>>,
  terms: Map<string, TermDefinitionType>,
  active: ActiveContextType,
  state: ContextStateType,
  base: string | undefined,
  defined: Map<string, boolean>,
  overrideProtected = false,
): void {
  abort(state.signal)
  if (defined.get(term) === true) return
  if (defined.get(term) === false) {
    fail('cyclic IRI mapping', `Term '${term}' has a cyclic mapping.`)
  }
  defined.set(term, false)
  if (term === '@type') {
    const value = local[term]
    if (
      active.mode === 'json-ld-1.0' || !object(value) || !Object.keys(value).length ||
      Object.keys(value).some((key) => !['@container', '@protected'].includes(key)) ||
      (Object.hasOwn(value, '@container') && value['@container'] !== '@set')
    ) {
      fail('keyword redefinition', 'The @type definition only permits @set and @protected.')
    }
  } else if (term === '') {
    fail('invalid term definition', 'A term cannot be empty.')
  } else if (KEYWORDS.has(term)) {
    fail('keyword redefinition', `Invalid JSON-LD term '${term}'.`)
  }
  if (/^@[A-Za-z]+$/u.test(term) && term !== '@type') return
  let value = local[term]
  const previous = terms.get(term)
  terms.delete(term)
  if (value === null || (object(value) && value['@id'] === null)) {
    if (previous?.protected && !overrideProtected) {
      fail('protected term redefinition', `Protected term '${term}' cannot be removed.`)
    }
    const protectedValue = object(value)
      ? value['@protected'] ?? local['@protected'] ?? false
      : local['@protected'] ?? false
    if (typeof protectedValue !== 'boolean') {
      fail('invalid @protected value', '@protected must be boolean.')
    }
    terms.set(term, {
      id: null,
      prefix: false,
      protected: protectedValue,
      reverse: false,
      container: [],
    })
    defined.set(term, true)
    return
  }
  const simple = typeof value === 'string'
  if (simple) value = { '@id': value as string }
  if (!object(value)) {
    fail('invalid term definition', `Term '${term}' must map to string/null/object.`)
  }
  const map = value as Record<string, JsonLdValueType>
  const allowed = [
    '@id',
    '@reverse',
    '@container',
    '@context',
    '@direction',
    '@index',
    '@language',
    '@nest',
    '@prefix',
    '@protected',
    '@type',
  ]
  if (Object.keys(map).some((key) => !allowed.includes(key))) {
    fail('invalid term definition', `Term '${term}' contains an unsupported definition entry.`)
  }
  if (
    active.mode === 'json-ld-1.0' &&
    ['@context', '@direction', '@index', '@nest', '@prefix', '@protected'].some((key) =>
      Object.hasOwn(map, key)
    )
  ) {
    fail('invalid term definition', `Term '${term}' uses a JSON-LD 1.1 definition entry.`)
  }
  const protectedValue = map['@protected'] ?? local['@protected'] ?? false
  if (typeof protectedValue !== 'boolean') {
    fail('invalid @protected value', '@protected must be boolean.')
  }
  let id: string | null | undefined, reverse = false
  if (Object.hasOwn(map, '@reverse')) {
    if (Object.hasOwn(map, '@id') || Object.hasOwn(map, '@nest')) {
      fail('invalid reverse property', `Invalid reverse mapping for '${term}'.`)
    }
    if (typeof map['@reverse'] !== 'string') {
      fail('invalid IRI mapping', '@reverse mapping must be a string.')
    }
    if (/^@[A-Za-z]+$/u.test(map['@reverse'])) return
    id = expandTerm(map['@reverse'], local, terms, active, state, base, defined)
    reverse = true
  } else if (Object.hasOwn(map, '@id')) {
    const raw = map['@id']
    if (raw !== null && typeof raw !== 'string') {
      fail('invalid IRI mapping', '@id mapping must be null or string.')
    }
    if (typeof raw === 'string' && !KEYWORDS.has(raw) && /^@[A-Za-z]+$/u.test(raw)) return
    id = raw === null
      ? null
      : raw === term
      ? undefined
      : expandTerm(raw, local, terms, active, state, base, defined)
  }
  if (id === undefined) {
    const colon = term.indexOf(':')
    if (colon > 0) {
      const prefix = term.slice(0, colon)
      if (Object.hasOwn(local, prefix)) create(prefix, local, terms, active, state, base, defined)
      const p = terms.get(prefix)
      id = p?.id ? `${p.id}${term.slice(colon + 1)}` : term
    } else id = term === '@type' ? '@type' : active.vocab ? `${active.vocab}${term}` : term
  }
  if (id !== null && !KEYWORDS.has(id) && !absolute(id) && !id.startsWith('_:')) {
    fail('invalid IRI mapping', `Term '${term}' does not map to an absolute IRI or keyword.`)
  }
  if (id === '@context') fail('invalid keyword alias', '@context cannot be aliased.')
  const colon = term.indexOf(':')
  if (
    active.mode !== 'json-ld-1.0' && Object.hasOwn(map, '@id') && map['@id'] !== term &&
    ((colon > 0 && colon < term.length - 1) || term.includes('/'))
  ) {
    defined.set(term, true)
    if (expandTerm(term, local, terms, active, state, base, defined) !== id) {
      fail('invalid IRI mapping', 'A compact or relative IRI term cannot map to a different IRI.')
    }
  }
  let type: string | undefined
  if (Object.hasOwn(map, '@type')) {
    const raw = map['@type']
    if (typeof raw !== 'string') fail('invalid type mapping', '@type mapping must be string.')
    type = ['@id', '@vocab', '@json', '@none'].includes(raw)
      ? raw
      : expandTerm(raw, local, terms, active, state, base, defined)
  }
  const container = containers(map['@container'], active.mode, term)
  if (reverse && container.some((item) => item !== '@set' && item !== '@index')) {
    fail('invalid reverse property', 'Reverse properties only permit @set and @index containers.')
  }
  if (
    type && !['@id', '@vocab', '@json', '@none'].includes(type) &&
    (!absolute(type) || type.startsWith('_:'))
  ) {
    fail('invalid type mapping', 'A datatype mapping must be an absolute IRI.')
  }
  if (active.mode === 'json-ld-1.0' && (type === '@json' || type === '@none')) {
    fail('invalid type mapping', 'The @json and @none type mappings require JSON-LD 1.1.')
  }
  if (container.includes('@type')) {
    type ??= '@id'
    if (type !== '@id' && type !== '@vocab') {
      fail('invalid type mapping', 'A type map requires @id or @vocab coercion.')
    }
  }
  if (
    Object.hasOwn(map, '@index') &&
    (!container.includes('@index') || typeof map['@index'] !== 'string' ||
      !absolute(expandTerm(map['@index'], local, terms, active, state, base, defined) ?? ''))
  ) {
    fail(
      'invalid term definition',
      'A custom @index requires an index container and an IRI mapping.',
    )
  }
  if (
    Object.hasOwn(map, '@nest') &&
    (typeof map['@nest'] !== 'string' || (KEYWORDS.has(map['@nest']) && map['@nest'] !== '@nest'))
  ) {
    fail('invalid @nest value', 'A nest mapping must be a string other than a non-nest keyword.')
  }
  let language: string | null | undefined
  if (Object.hasOwn(map, '@language')) {
    const raw = map['@language']
    if (raw !== null && typeof raw !== 'string') {
      fail('invalid language mapping', '@language mapping must be null/string.')
    }
    language = typeof raw === 'string' ? raw.toLowerCase() : null
  }
  let direction: 'ltr' | 'rtl' | null | undefined
  if (Object.hasOwn(map, '@direction')) {
    const raw = map['@direction']
    if (raw !== null && raw !== 'ltr' && raw !== 'rtl') {
      fail('invalid base direction', 'Invalid @direction mapping.')
    }
    direction = raw as 'ltr' | 'rtl' | null
  }
  const scoped = Object.hasOwn(map, '@context') ? map['@context'] : undefined,
    index = typeof map['@index'] === 'string' ? map['@index'] : undefined,
    nest = typeof map['@nest'] === 'string' ? map['@nest'] : undefined
  let prefix = map['@prefix'] === true
  if (Object.hasOwn(map, '@prefix')) {
    if (term.includes(':') || term.includes('/') || (prefix && id !== null && KEYWORDS.has(id))) {
      fail('invalid term definition', 'A prefix must be a simple term mapped to an IRI.')
    }
    if (typeof map['@prefix'] !== 'boolean') {
      fail('invalid @prefix value', '@prefix must be boolean.')
    }
  }
  if (
    (simple || active.mode === 'json-ld-1.0') && !Object.hasOwn(map, '@prefix') &&
    typeof id === 'string' && !term.includes(':') && !term.includes('/') &&
    (/[:/?#\[\]@]$/u.test(id) || id.startsWith('_:'))
  ) prefix = true
  const next: TermDefinitionType = {
    id: id ?? null,
    prefix,
    compactPrefix: prefix && (simple || map['@prefix'] === true),
    protected: protectedValue,
    reverse,
    container,
    ...(type ? { type } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(direction !== undefined ? { direction } : {}),
    ...(scoped !== undefined ? { context: scoped, ...(base ? { base } : {}) } : {}),
    ...(index ? { index } : {}),
    ...(nest ? { nest } : {}),
  }
  if (previous?.protected && !overrideProtected && !same(previous, next)) {
    fail('protected term redefinition', `Protected term '${term}' cannot be redefined.`)
  }
  terms.set(term, previous?.protected && !overrideProtected ? previous : next)
  defined.set(term, true)
}
/** Expands a term-definition IRI, creating referenced prefixes first. */ function expandTerm(
  value: string,
  local: Readonly<Record<string, JsonLdValueType>>,
  terms: Map<string, TermDefinitionType>,
  active: ActiveContextType,
  state: ContextStateType,
  base: string | undefined,
  defined: Map<string, boolean>,
): string | undefined {
  if (KEYWORDS.has(value)) return value
  if (/^@[A-Za-z]+$/u.test(value)) return undefined
  if (Object.hasOwn(local, value) && defined.get(value) !== true) {
    create(value, local, terms, active, state, base, defined)
  }
  const direct = terms.get(value)
  if (direct) return direct.id ?? undefined
  const colon = value.indexOf(':')
  if (colon > 0) {
    const prefix = value.slice(0, colon)
    if (prefix === '_' || value.slice(colon + 1).startsWith('//')) return value
    if (Object.hasOwn(local, prefix)) create(prefix, local, terms, active, state, base, defined)
    const def = terms.get(prefix)
    if (def?.id && def.prefix) return `${def.id}${value.slice(colon + 1)}`
    if (absolute(value) || value.startsWith('_:')) return value
  }
  return active.vocab ? `${active.vocab}${value}` : value
}
/** Expands an IRI/term under an active context. */
export function expandIri(
  active: ActiveContextType,
  value: string,
  options: {
    /** Whether relative IRIs can resolve against the active document base. */
    readonly documentRelative?: boolean
    /** Default vocabulary IRI used by this parser context. */
    readonly vocab?: boolean
  } = {},
): string | undefined {
  if (KEYWORDS.has(value) || FRAME_KEYWORDS.has(value)) return value
  if (/^@[A-Za-z]+$/u.test(value)) return undefined
  if (options.vocab) {
    const direct = active.terms.get(value)
    if (direct) return direct.id ?? undefined
  }
  const colon = value.indexOf(':')
  if (colon >= 0) {
    const prefix = value.slice(0, colon), suffix = value.slice(colon + 1)
    if (prefix === '_' || suffix.startsWith('//')) return value
    const def = active.terms.get(prefix)
    if (def?.id && def.prefix) return `${def.id}${suffix}`
    if (absolute(value)) return value
  }
  if (options.vocab && active.vocab) return `${active.vocab}${value}`
  if (options.documentRelative && active.base) return resolve(value, active.base) ?? value
  return value
}
/** Returns aliases for one keyword. */
export function aliases(
  active: ActiveContextType,
  keyword: string,
): string[] {
  return [...active.terms].filter(([, v]) => v.id === keyword).map(([k]) => k).sort(compare)
}
/** Gets a definition for one active property. */
export function definition(
  active: ActiveContextType,
  property: string | null,
): TermDefinitionType | undefined {
  return property === null ? undefined : active.terms.get(property)
}
/** Tests for non-array JSON object. */
export function object(
  value: unknown,
): value is Record<string, JsonLdValueType> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Throws a stable JSON-LD error. */
export function fail(
  code: string,
  message: string,
  cause?: unknown,
): never {
  throw new JsonLdError(code, message, cause)
}
/** Throws caller cancellation. */
export function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
/** Resolves one IRI reference. */
export function resolve(value: string, base?: string): string | undefined {
  try {
    return resolveReference(value, base)
  } catch {
    return undefined
  }
}
/** Tests absolute URL-like IRI. */
export function absolute(value: string): boolean {
  // deno-lint-ignore no-control-regex -- RDF IRIs exclude literal C0 controls and ASCII space.
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) && !/[\u0000-\u0020<>"{}|^`\\]/u.test(value) &&
    value.indexOf('#') === value.lastIndexOf('#')
}
/** Unicode code-point comparator. */
export function compare(left: string, right: string): number {
  if (left === right) return 0
  const a = [...left], b = [...right]
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const av = a[i]!.codePointAt(0)!, bv = b[i]!.codePointAt(0)!
    if (av !== bv) return av - bv
  }
  return a.length - b.length
}
/** Clones active context term state. */ function clone(
  active: ActiveContextType,
): ActiveContextType {
  return { ...active, terms: new Map(active.terms) }
}
/** Omits one optional context property without assigning undefined. */ function omit<
  K extends keyof ActiveContextType,
>(active: ActiveContextType, key: K): ActiveContextType {
  const result = { ...active } as Record<string, unknown>
  delete result[key as string]
  return result as unknown as ActiveContextType
}
/** Parses one @container mapping. */ function containers(
  value: JsonLdValueType | undefined,
  mode: ProcessingModeType,
  term: string,
): readonly string[] {
  if (value === undefined) return []
  if (mode === 'json-ld-1.0' && typeof value !== 'string') {
    fail('invalid container mapping', 'JSON-LD 1.0 containers must be a single string.')
  }
  const list = Array.isArray(value) ? value : [value]
  if (!list.every((v) => typeof v === 'string')) {
    fail('invalid container mapping', `@container for '${term}' must contain strings.`)
  }
  const allowed = new Set(
    mode === 'json-ld-1.0'
      ? ['@list', '@set', '@index', '@language']
      : ['@graph', '@id', '@index', '@language', '@list', '@set', '@type'],
  )
  if (list.some((v) => !allowed.has(v as string))) {
    fail('invalid container mapping', `Invalid @container for '${term}'.`)
  }
  const core = list.filter((item) => item !== '@set')
  if (
    !list.length || (list.includes('@list') && list.length !== 1) || core.length > 2 ||
    (core.length === 2 &&
      !(core.includes('@graph') && (core.includes('@id') || core.includes('@index'))))
  ) {
    fail('invalid container mapping', `Invalid @container combination for '${term}'.`)
  }
  return [...new Set(list as string[])].sort(compare)
}
/** Tests protected-term structural equivalence. */ function same(
  a: TermDefinitionType,
  b: TermDefinitionType,
) {
  return JSON.stringify({ ...a, protected: false, container: [...a.container] }) ===
    JSON.stringify({ ...b, protected: false, container: [...b.container] })
}
