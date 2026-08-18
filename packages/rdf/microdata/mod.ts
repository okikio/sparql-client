/** Native HTML Microdata-to-RDF conversion. @module */
import { blankNode, defaultGraph, literal, namedNode, quad } from '../factory.ts'
import {
  attr,
  elements,
  hasAttr,
  type MarkupElementType,
  parseMarkup,
  textContent,
} from '../markup.ts'
import {
  type GraphTermType,
  type ObjectTermType,
  type Quad,
  RDF,
  type SubjectTermType,
  XSD,
} from '../term.ts'
import { type TextSourceType, throwIfAborted } from '../text.ts'
/** Microdata registry predicate used to connect a vocabulary to additional vocabulary behavior. */
const USES_VOCABULARY = 'http://www.w3.org/ns/rdfa#usesVocabulary',
  XSD_G_YEAR = 'http://www.w3.org/2001/XMLSchema#gYear',
  XSD_G_YEAR_MONTH = 'http://www.w3.org/2001/XMLSchema#gYearMonth',
  XSD_TIME = 'http://www.w3.org/2001/XMLSchema#time',
  XSD_DURATION = 'http://www.w3.org/2001/XMLSchema#duration'
/** Built-in Microdata vocabulary registry used when the caller does not supply a replacement. */
const DEFAULT_VOCABULARIES: VocabularyRegistryType = {
  'http://schema.org/': { properties: { additionalType: { subPropertyOf: RDF.type } } },
  'https://schema.org/': { properties: { additionalType: { subPropertyOf: RDF.type } } },
  'http://microformats.org/profile/hcard': {},
}
/** Metadata that expands one vocabulary property into extra predicates. */ export interface VocabularyPropertyType {
  /** Predicate or predicates emitted in addition to the Microdata property itself. */
  readonly subPropertyOf?: string | readonly string[]
  /** Equivalent predicates receiving the same value. */ readonly equivalentProperty?:
    | string
    | readonly string[]
  /** Extension metadata retained for custom registries. */ readonly [key: string]: unknown
}
/** One Microdata vocabulary registry entry. */ export interface VocabularyType {
  /** Vocabulary-specific Microdata property rules keyed by `itemprop` token. */
  readonly properties?: Readonly<Record<string, VocabularyPropertyType>>
  /** Extension metadata retained for custom registries. */ readonly [key: string]: unknown
}
/** Microdata vocabulary registry keyed by vocabulary IRI prefix. */ export type VocabularyRegistryType =
  Readonly<Record<string, VocabularyType>>
/** Options for native Microdata-to-RDF parsing. */ export interface ParseOptionsType {
  /** Effective document base IRI used to resolve Microdata identifiers and URL values. */
  readonly base?: string
  /** Target RDF graph. */ readonly graph?: GraphTermType
  /** Parse as XML/XHTML when true. */ readonly xml?: boolean
  /** Replaces the default vocabulary registry. */ readonly vocabularies?: VocabularyRegistryType
  /** Maximum decoded source bytes. */ readonly maxBytes?: number
  /** Maximum markup node count. */ readonly maxNodes?: number
  /** Maximum markup depth. */ readonly maxDepth?: number
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** Shared state for one conversion. */ interface StateType {
  /** Effective document base IRI shared by this Microdata conversion operation. */
  readonly base?: string
  /** Document subject for vocabulary-use statements. */ readonly document?: SubjectTermType
  /** Target graph. */ readonly graph: GraphTermType
  /** Vocabulary registry. */ readonly vocabularies: VocabularyRegistryType
  /** itemref targets by id. */ readonly ids: ReadonlyMap<string, MarkupElementType>
  /** Stable subjects for item identity/cycles. */ readonly memory: Map<
    MarkupElementType,
    SubjectTermType
  >
  /** Vocabularies already reported. */ readonly used: Set<string>
  /** Deterministic result buffer. */ readonly quads: Quad[]
  /** HTML attribute rules enabled. */ readonly html: boolean
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** Effective context inherited by nested items. */ interface ItemContextType {
  /** Vocabulary type IRI that controls property expansion for the current Microdata item. */
  readonly type?: string
  /** Derived vocabulary. */ readonly vocabulary?: string
  /** Inherited language. */ readonly language?: string
}
/** One property-bearing element plus inherited language. */ interface PropertyElementType {
  /** Markup element whose Microdata property value is being evaluated. */
  readonly element: MarkupElementType
  /** Effective language. */ readonly language?: string
}
/**
 * Parses Microdata and yields native RDF quads without a DOM or external parser.
 * Item identity is memoized so repeated `itemref` and nested-item references reuse one subject.
 */
export async function* parse(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<Quad> {
  const html = !(options.xml ?? false)
  const document = await parseMarkup(source, {
    html,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  throwIfAborted(options.signal)
  const roots = document.children.filter((v): v is MarkupElementType => v.kind === 'element')
  const all = roots.flatMap((root) => [...elements(root, true)])
  const base = documentBase(all, options.base, html)
  const ids = new Map<string, MarkupElementType>()
  for (const element of all) {
    const id = attr(element, 'id', html)
    if (id !== undefined && !ids.has(id)) ids.set(id, element)
  }
  const state: StateType = {
    ...(base ? { base, document: namedNode(base) } : {}),
    graph: options.graph ?? defaultGraph(),
    vocabularies: options.vocabularies ?? DEFAULT_VOCABULARIES,
    ids,
    memory: new Map(),
    used: new Set(),
    quads: [],
    html,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  for (const element of all) {
    throwIfAborted(options.signal)
    if (
      !hasAttr(element, 'itemscope', html) || hasAttr(element, 'itemprop', html) ||
      hasAttr(element, 'itemprop-reverse', html)
    ) continue
    const lang = language(element, html)
    item(element, state, lang ? { language: lang } : {})
  }
  for (const value of state.quads) {
    throwIfAborted(options.signal)
    yield value
  }
}
/** Converts one item and returns its stable subject. */ function item(
  element: MarkupElementType,
  state: StateType,
  parent: ItemContextType,
): SubjectTermType {
  throwIfAborted(state.signal)
  const existing = state.memory.get(element)
  if (existing) return existing
  const identifier = attr(element, 'itemid', state.html)
  const subject = identifier ? resource(identifier, state.base) ?? blankNode() : blankNode()
  state.memory.set(element, subject)
  const types = tokens(attr(element, 'itemtype', state.html)).map((v) =>
    resource(v, state.base)?.value
  ).filter((v): v is string => Boolean(v))
  for (const type of types) emit(state, subject, RDF.type, namedNode(type))
  const type = types[0] ?? parent.type
  const vocabulary = type ? vocabularyFor(type, state.vocabularies) : parent.vocabulary
  if (
    vocabulary && state.document && registryVocabulary(vocabulary, state.vocabularies) &&
    !state.used.has(vocabulary)
  ) {
    state.used.add(vocabulary)
    emit(state, state.document, USES_VOCABULARY, namedNode(vocabulary))
  }
  const inheritedLanguage = language(element, state.html) ?? parent.language
  const context: ItemContextType = {
    ...(type ? { type } : {}),
    ...(vocabulary ? { vocabulary } : {}),
    ...(inheritedLanguage ? { language: inheritedLanguage } : {}),
  }
  for (const property of properties(element, state, context.language)) {
    throwIfAborted(state.signal)
    const direct = tokens(attr(property.element, 'itemprop', state.html)),
      reverse = tokens(attr(property.element, 'itemprop-reverse', state.html))
    if (!direct.length && !reverse.length) continue
    const object = value(property.element, state, {
      ...context,
      ...(property.language ? { language: property.language } : {}),
    })
    for (const name of direct) {
      const predicate = predicateIri(name, context, state.base)
      if (!predicate) continue
      emit(state, subject, predicate, object)
      aliases(state, subject, name, predicate, object, context)
    }
    if (object.termType === 'Literal' || object.termType === 'Quad') continue
    for (const name of reverse) {
      const predicate = predicateIri(name, context, state.base)
      if (!predicate) continue
      emit(state, object, predicate, subject)
      aliases(state, object, name, predicate, subject, context)
    }
  }
  return subject
}
/** Collects property descendants without crossing nested item children. */ function properties(
  element: MarkupElementType,
  state: StateType,
  inheritedLanguage?: string,
): PropertyElementType[] {
  const output: PropertyElementType[] = [], visited = new Set<MarkupElementType>()
  /** Walks one property-memory root with language inheritance. */ function walk(
    current: MarkupElementType,
    currentLanguage?: string,
  ) {
    if (visited.has(current)) return
    visited.add(current)
    const own = language(current, state.html) ?? currentLanguage
    if (
      hasAttr(current, 'itemprop', state.html) || hasAttr(current, 'itemprop-reverse', state.html)
    ) output.push({ element: current, ...(own ? { language: own } : {}) })
    if (current !== element && hasAttr(current, 'itemscope', state.html)) return
    for (const child of current.children) if (child.kind === 'element') walk(child, own)
  }
  for (const child of element.children) if (child.kind === 'element') walk(child, inheritedLanguage)
  for (const id of tokens(attr(element, 'itemref', state.html))) {
    const reference = state.ids.get(id)
    if (reference) walk(reference, language(reference, state.html) ?? inheritedLanguage)
  }
  return output
}
/** Resolves the RDF value contributed by one property element. */ function value(
  element: MarkupElementType,
  state: StateType,
  context: ItemContextType,
): ObjectTermType {
  if (hasAttr(element, 'itemscope', state.html)) return item(element, state, context)
  const tag = localName(element.name), urlAttr = urlProperty(tag)
  if (urlAttr) {
    const raw = attr(element, urlAttr, state.html),
      iri = raw === undefined ? undefined : resource(raw, state.base)
    if (iri) return iri
  }
  if (tag === 'meta') {
    return languageLiteral(attr(element, 'content', state.html) ?? '', context.language)
  }
  if (tag === 'data' || tag === 'meter') {
    return scalar(attr(element, 'value', state.html) ?? textContent(element))
  }
  if (tag === 'time') {
    return time(attr(element, 'datetime', state.html) ?? textContent(element), context.language)
  }
  return languageLiteral(textContent(element), context.language)
}
/** Emits registry aliases for one property. */ function aliases(
  state: StateType,
  subject: SubjectTermType,
  name: string,
  predicate: string,
  object: ObjectTermType,
  context: ItemContextType,
) {
  if (!context.vocabulary) return
  const entry = state.vocabularies[context.vocabulary]?.properties?.[name]
  if (!entry) return
  for (const alias of [...asList(entry.subPropertyOf), ...asList(entry.equivalentProperty)]) {
    const resolved = predicateIri(alias, context, state.base) ?? absolute(alias)
    if (resolved && resolved !== predicate) emit(state, subject, resolved, object)
  }
}
/** Appends one generated statement. */ function emit(
  state: StateType,
  subject: SubjectTermType,
  predicate: string,
  object: ObjectTermType,
) {
  state.quads.push(quad(subject, namedNode(predicate), object, state.graph))
}
/** Resolves one property token with vocabulary rules. */ function predicateIri(
  name: string,
  context: ItemContextType,
  base?: string,
) {
  const direct = absolute(name)
  if (direct) return direct
  if (context.vocabulary) return joinVocabulary(context.vocabulary, name)
  if (!base) return undefined
  const url = new URL(base)
  url.hash = name
  return url.href
}
/** Derives the active vocabulary from an item type. */ function vocabularyFor(
  type: string,
  registry: VocabularyRegistryType,
) {
  let match = ''
  for (const candidate of Object.keys(registry)) {
    if (type.startsWith(candidate) && candidate.length > match.length) match = candidate
  }
  if (match) return match
  const hash = type.lastIndexOf('#')
  if (hash >= 0) return type.slice(0, hash + 1)
  const slash = type.lastIndexOf('/')
  return slash >= 0 ? type.slice(0, slash + 1) : type
}
/** Tests explicit registry membership. */ function registryVocabulary(
  value: string,
  registry: VocabularyRegistryType,
) {
  return Object.hasOwn(registry, value)
}
/** Joins a vocabulary and property token. */ function joinVocabulary(vocab: string, name: string) {
  return vocab.endsWith('/') || vocab.endsWith('#') ? `${vocab}${name}` : `${vocab}#${name}`
}
/** Applies the first HTML base element. */ function documentBase(
  values: readonly MarkupElementType[],
  supplied: string | undefined,
  html: boolean,
) {
  if (!html) return supplied
  const base = values.find((e) =>
    localName(e.name) === 'base' && attr(e, 'href', true) !== undefined
  )
  const href = base ? attr(base, 'href', true) : undefined
  return href ? resolve(href, supplied) : supplied
}
/** Gets directly declared language. */ function language(
  element: MarkupElementType,
  html: boolean,
) {
  const value = attr(element, 'lang', html) ?? attr(element, 'xml:lang', html)
  return value?.trim().toLowerCase() || undefined
}
/** Creates language/plain literal. */ function languageLiteral(
  value: string,
  language?: string,
): ObjectTermType {
  return language ? literal(value, language) : literal(value)
}
/** Converts numeric data/meter lexical values. */ function scalar(value: string): ObjectTermType {
  const n = value.trim()
  if (/^[+-]?\d+$/u.test(n)) return literal(n, namedNode(XSD.integer))
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/u.test(n) && /[.eE]/u.test(n)) {
    return literal(n, namedNode(XSD.double))
  }
  return literal(value)
}
/** Converts time lexical values to matching XSD datatype. */ function time(
  value: string,
  language?: string,
): ObjectTermType {
  const n = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u.test(n)) {
    return literal(n, namedNode(XSD.dateTime))
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(n)) return literal(n, namedNode(XSD.date))
  if (/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u.test(n)) {
    return literal(n, namedNode(XSD_TIME))
  }
  if (/^\d{4}-\d{2}$/u.test(n)) return literal(n, namedNode(XSD_G_YEAR_MONTH))
  if (/^\d{4}$/u.test(n)) return literal(n, namedNode(XSD_G_YEAR))
  if (
    /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u.test(n)
  ) return literal(n, namedNode(XSD_DURATION))
  return languageLiteral(value, language)
}
/** Returns URL-valued attribute for one HTML element. */ function urlProperty(name: string) {
  if (['a', 'area', 'link'].includes(name)) return 'href'
  if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].includes(name)) return 'src'
  if (name === 'object') return 'data'
  return undefined
}
/** Resolves resource IRI to named node. */ function resource(value: string, base?: string) {
  const resolved = resolve(value.trim(), base)
  return resolved ? namedNode(resolved) : undefined
}
/** Resolves an IRI reference. */ function resolve(value: string, base?: string) {
  if (!value) return undefined
  try {
    return base ? new URL(value, base).href : new URL(value).href
  } catch {
    return undefined
  }
}
/** Returns value only if absolute IRI. */ function absolute(value: string) {
  try {
    return new URL(value).href
  } catch {
    return undefined
  }
}
/** Splits a space-separated token list. */ function tokens(value?: string) {
  return value?.trim().split(/\s+/u).filter(Boolean) ?? []
}
/** Returns lower-cased local element name. */ function localName(name: string) {
  const colon = name.indexOf(':')
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase()
}
/** Normalizes one-or-many registry predicate mappings. */ function asList(
  value?: string | readonly string[],
): readonly string[] {
  return value === undefined ? [] : typeof value === 'string' ? [value] : value
}
