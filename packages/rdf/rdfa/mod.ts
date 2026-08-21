/** Native RDFa 1.1 extraction over the package-owned markup parser. @module */
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
} from '../term.ts'
import { type TextSourceType, throwIfAborted } from '../text.ts'
/** RDFa vocabulary-use predicate emitted for documents that declare a default vocabulary. */
const USES_VOCABULARY = 'http://www.w3.org/ns/rdfa#usesVocabulary',
  XML_LITERAL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
  XHTML = 'http://www.w3.org/1999/xhtml/vocab#'
/** Initial RDFa prefix mappings defined by the processor profile. */
const PREFIXES: Readonly<Record<string, string>> = {
  cc: 'http://creativecommons.org/ns#',
  dc: 'http://purl.org/dc/terms/',
  dcterms: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  og: 'http://ogp.me/ns#',
  owl: 'http://www.w3.org/2002/07/owl#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfa: 'http://www.w3.org/ns/rdfa#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  schema: 'https://schema.org/',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  xhv: XHTML,
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}
/** Initial XHTML RDFa terms available without an explicit prefix declaration. */
const TERMS = new Set([
  'alternate',
  'appendix',
  'bookmark',
  'chapter',
  'contents',
  'copyright',
  'first',
  'glossary',
  'help',
  'icon',
  'index',
  'last',
  'license',
  'meta',
  'next',
  'p3pv1',
  'prev',
  'role',
  'section',
  'stylesheet',
  'subsection',
  'start',
  'top',
  'up',
])
/** RDFa host-language profile. */
export type ProfileType =
  | ''
  | 'core'
  | 'html'
  | 'xhtml'
  | 'svg'
  | 'xml'
/** Known host-language media types. */
export type ContentTypeType =
  | 'text/html'
  | 'application/xhtml+xml'
  | 'application/xml'
  | 'text/xml'
  | 'image/svg+xml'
/** Optional host-language feature flags. */
export type FeatureType = Readonly<
  Record<string, boolean>
>
/** Native RDFa parser options. */
export interface ParseOptionsType {
  /** Effective base IRI used while resolving relative identifiers during RDFa parsing. */
  readonly base?: string
  /** Target graph. */ readonly graph?: GraphTermType
  /** Initial language. */ readonly language?: string
  /** Initial default vocabulary. */ readonly vocab?: string
  /** Host media type. */ readonly contentType?: ContentTypeType
  /** Explicit profile. */ readonly profile?: ProfileType
  /** Reserved feature switches. */ readonly features?: FeatureType
  /** Max decoded bytes. */ readonly maxBytes?: number
  /** Max nodes. */ readonly maxNodes?: number
  /** Max depth. */ readonly maxDepth?: number
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** Direction used when materializing `rel` and `rev` relationships. */
type DirectionType = 'forward' | 'reverse'
/** Relationship waiting for a descendant resource. */ interface IncompleteType {
  /** Expanded predicate IRI represented by this pending RDFa relationship. */
  readonly predicate: string
  /** Relationship direction. */ readonly direction: DirectionType
}
/** Accumulated RDFa list. */ interface ListType {
  /** RDF subject that owns this accumulated RDFa list. */
  readonly subject: SubjectTermType
  /** Predicate IRI. */ readonly predicate: string
  /** Values in source order. */ readonly values: ObjectTermType[]
}
/** Recursive RDFa evaluation context. */ interface ContextType {
  /** Effective base IRI inherited by this RDFa evaluation context. */
  readonly base?: string
  /** Parent subject. */ readonly parentSubject?: SubjectTermType
  /** Parent object used for chaining. */ readonly parentObject?: SubjectTermType
  /** Pending parent relations. */ readonly incomplete: readonly IncompleteType[]
  /** Open list mappings. */ readonly lists: Map<string, ListType>
  /** Prefix mappings. */ readonly prefixes: ReadonlyMap<string, string>
  /** Initial term mappings. */ readonly terms: ReadonlyMap<string, string>
  /** Default vocabulary. */ readonly vocab?: string
  /** Inherited language. */ readonly language?: string
}
/** State owned by one parse operation. */ interface StateType {
  /** RDF graph that receives quads produced by this RDFa parse operation. */
  readonly graph: GraphTermType
  /** Deterministic output. */ readonly quads: Quad[]
  /** HTML host rules. */ readonly html: boolean
  /** Original source for XML literals. */ readonly text: string
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/**
 * Parses RDFa 1.1 to native quads using package-owned markup events and state.
 * Prefix/CURIE expansion, vocabularies, relation chaining, reverse relations,
 * `typeof`, typed values, and `inlist` collections are handled directly.
 */
export async function* parse(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<Quad> {
  const html = profile(options) === 'html'
  const document = await parseMarkup(source, {
    html,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const roots = document.children.filter((v): v is MarkupElementType => v.kind === 'element')
  const base = hostBase(roots, options.base, html)
  const prefixes = new Map(Object.entries(PREFIXES)), terms = new Map<string, string>()
  if (html) { for (const term of TERMS) terms.set(term, `${XHTML}${term}`) }
  const parentSubject = base ? namedNode(base) : undefined
  const context: ContextType = {
    ...(base ? { base } : {}),
    ...(parentSubject ? { parentSubject } : {}),
    incomplete: [],
    lists: new Map(),
    prefixes,
    terms,
    ...(options.vocab ? { vocab: options.vocab } : {}),
    ...(options.language ? { language: options.language.toLowerCase() } : {}),
  }
  const state: StateType = {
    graph: options.graph ?? defaultGraph(),
    quads: [],
    html,
    text: document.text,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  for (const root of roots) visit(root, context, state, true)
  finishLists(context.lists, state)
  for (const q of state.quads) {
    throwIfAborted(options.signal)
    yield q
  }
}
/** Processes one element through the recursive RDFa evaluation sequence. */ function visit(
  element: MarkupElementType,
  inherited: ContextType,
  state: StateType,
  root = false,
): void {
  throwIfAborted(state.signal)
  const prefixes = mappings(element, inherited.prefixes, state.html),
    base = xmlBase(element, inherited.base, state.html),
    language = localLanguage(element, state.html) ?? inherited.language,
    vocabRaw = attr(element, 'vocab', state.html),
    vocab = vocabRaw === undefined
      ? inherited.vocab
      : vocabRaw === ''
      ? undefined
      : iri(vocabRaw, base)
  if (vocabRaw !== undefined && vocab && base) {
    emit(state, namedNode(base), USES_VOCABULARY, namedNode(vocab))
  }
  const local: ContextType = {
    ...(base ? { base } : {}),
    ...(inherited.parentSubject ? { parentSubject: inherited.parentSubject } : {}),
    ...(inherited.parentObject ? { parentObject: inherited.parentObject } : {}),
    incomplete: inherited.incomplete,
    lists: inherited.lists,
    prefixes,
    terms: inherited.terms,
    ...(vocab ? { vocab } : {}),
    ...(language ? { language } : {}),
  }
  const rel = predicates(attr(element, 'rel', state.html), local),
    rev = predicates(attr(element, 'rev', state.html), local),
    property = predicates(attr(element, 'property', state.html), local),
    types = predicates(attr(element, 'typeof', state.html), local),
    hasRelation = rel.length > 0 || rev.length > 0,
    about = resource(attr(element, 'about', state.html), local, false),
    resourceValue = resource(attr(element, 'resource', state.html), local, false),
    href = iriTerm(attr(element, 'href', state.html), base),
    src = iriTerm(attr(element, 'src', state.html), base)
  let subject: SubjectTermType | undefined,
    object: SubjectTermType | undefined,
    typed: SubjectTermType | undefined,
    skip = false
  if (!hasRelation) {
    if (
      property.length && !hasAttr(element, 'content', state.html) &&
      !hasAttr(element, 'datatype', state.html)
    ) {
      subject = about ?? (root ? documentTerm(base) : inherited.parentObject)
      if (types.length) {
        typed = about ?? (root ? documentTerm(base) : resourceValue ?? href ?? src ?? blankNode())
        object = typed
      }
    } else {
      subject = about ?? resourceValue ?? href ?? src
      if (!subject) {
        if (root) subject = documentTerm(base)
        else if (types.length) subject = blankNode()
        else if (inherited.parentObject) {
          subject = inherited.parentObject
          if (!property.length) skip = true
        }
      }
      if (types.length) typed = subject
    }
  } else {
    subject = about ?? (root ? documentTerm(base) : inherited.parentObject)
    if (types.length && about) typed = subject
    object = resourceValue ?? href ?? src
    if (!object && types.length && !about) object = blankNode()
    if (types.length && !about) typed = object
  }
  if (typed) { for (const type of types) emit(state, typed, RDF.type, namedNode(type)) }
  let lists = inherited.lists
  if (
    subject &&
    ((inherited.parentObject && !subject.equals(inherited.parentObject)) ||
      (!inherited.parentObject && inherited.parentSubject &&
        !subject.equals(inherited.parentSubject)))
  ) lists = new Map()
  const pending: IncompleteType[] = []
  if (subject && object) {
    if (hasAttr(element, 'inlist', state.html)) {
      for (const p of rel) addList(lists, subject, p, object)
    } else for (const p of rel) emit(state, subject, p, object)
    for (const p of rev) emit(state, object, p, subject)
  } else if (subject && hasRelation) {
    for (const p of rel) pending.push({ predicate: p, direction: 'forward' })
    for (const p of rev) pending.push({ predicate: p, direction: 'reverse' })
    object = blankNode()
  }
  if (property.length && subject) {
    const value = propertyObject(element, local, state, typed)
    if (value) {
      if (hasAttr(element, 'inlist', state.html)) {
        for (const p of property) addList(lists, subject, p, value)
      } else for (const p of property) emit(state, subject, p, value)
    }
  }
  if (!skip && subject) complete(inherited, subject, state)
  const child: ContextType = skip
    ? { ...inherited, prefixes, ...(language ? { language } : {}), ...(vocab ? { vocab } : {}) }
    : {
      ...(base ? { base } : {}),
      ...(subject ?? inherited.parentSubject
        ? { parentSubject: subject ?? inherited.parentSubject }
        : {}),
      ...(object ?? subject ?? inherited.parentSubject
        ? { parentObject: object ?? subject ?? inherited.parentSubject }
        : {}),
      incomplete: pending,
      lists,
      prefixes,
      terms: inherited.terms,
      ...(vocab ? { vocab } : {}),
      ...(language ? { language } : {}),
    }
  for (const c of element.children) if (c.kind === 'element') visit(c, child, state)
  if (lists !== inherited.lists) finishLists(lists, state)
}
/** Completes parent relationships once a descendant subject appears. */ function complete(
  context: ContextType,
  subject: SubjectTermType,
  state: StateType,
) {
  if (!context.parentSubject) return
  for (const pending of context.incomplete) {
    pending.direction === 'forward'
      ? emit(state, context.parentSubject, pending.predicate, subject)
      : emit(state, subject, pending.predicate, context.parentSubject)
  }
}
/** Resolves a property value through RDFa literal/resource precedence. */ function propertyObject(
  element: MarkupElementType,
  context: ContextType,
  state: StateType,
  typed?: SubjectTermType,
): ObjectTermType | undefined {
  const content = attr(element, 'content', state.html),
    raw = attr(element, 'datatype', state.html),
    datatype = raw === undefined || raw === '' ? undefined : term(raw, context)
  if (raw !== undefined && raw !== '' && datatype && datatype !== XML_LITERAL) {
    return literal(content ?? textContent(element), namedNode(datatype))
  }
  if (raw === '') {
    return context.language
      ? literal(content ?? textContent(element), context.language)
      : literal(content ?? textContent(element))
  }
  if (datatype === XML_LITERAL) return literal(xmlChildren(element, state), namedNode(XML_LITERAL))
  if (content !== undefined) {
    return context.language ? literal(content, context.language) : literal(content)
  }
  if (!hasAttr(element, 'rel', state.html) && !hasAttr(element, 'rev', state.html)) {
    const resourceValue = resource(attr(element, 'resource', state.html), context, false) ??
      iriTerm(attr(element, 'href', state.html), context.base) ??
      iriTerm(attr(element, 'src', state.html), context.base)
    if (resourceValue) return resourceValue
  }
  if (hasAttr(element, 'typeof', state.html) && !hasAttr(element, 'about', state.html) && typed) {
    return typed
  }
  const value = textContent(element)
  return context.language ? literal(value, context.language) : literal(value)
}
/** Adds a list value. */ function addList(
  lists: Map<string, ListType>,
  subject: SubjectTermType,
  predicate: string,
  object: ObjectTermType,
) {
  const key = `${subject.termType}:${subject.value}\0${predicate}`
  let list = lists.get(key)
  if (!list) {
    list = { subject, predicate, values: [] }
    lists.set(key, list)
  }
  list.values.push(object)
}
/** Emits accumulated RDF collections. */ function finishLists(
  lists: Map<string, ListType>,
  state: StateType,
) {
  for (const list of lists.values()) {
    if (!list.values.length) {
      emit(state, list.subject, list.predicate, namedNode(RDF.nil))
      continue
    }
    const head = blankNode()
    emit(state, list.subject, list.predicate, head)
    let cursor = head
    for (let i = 0; i < list.values.length; i++) {
      emit(state, cursor, RDF.first, list.values[i]!)
      const last = i === list.values.length - 1, next = last ? namedNode(RDF.nil) : blankNode()
      emit(state, cursor, RDF.rest, next)
      if (!last) cursor = next as ReturnType<typeof blankNode>
    }
  }
  lists.clear()
}
/** Appends one statement. */ function emit(
  state: StateType,
  subject: SubjectTermType,
  predicate: string,
  object: ObjectTermType,
) {
  state.quads.push(quad(subject, namedNode(predicate), object, state.graph))
}
/** Builds local prefix mappings. */ function mappings(
  element: MarkupElementType,
  inherited: ReadonlyMap<string, string>,
  html: boolean,
) {
  const values = new Map(inherited)
  for (const a of element.attributes) {
    const lower = a.name.toLowerCase()
    if (lower.startsWith('xmlns:')) values.set(lower.slice(6), a.value)
  }
  const prefix = attr(element, 'prefix', html)
  if (prefix) {
    for (const m of prefix.matchAll(/([^\s:]+):\s+([^\s]+)/gu)) {
      values.set(m[1]!.toLowerCase(), m[2]!)
    }
  }
  return values
}
/** Expands a predicate/token list. */ function predicates(
  value: string | undefined,
  context: ContextType,
) {
  return value?.trim().split(/\s+/u).filter(Boolean).map((v) => term(v, context)).filter((
    v,
  ): v is string => Boolean(v)) ?? []
}
/** Expands one term, CURIE, or absolute IRI. */ function term(
  value: string,
  context: ContextType,
): string | undefined {
  const input = safe(value)
  if (!input) return undefined
  if (!input.includes(':') && /^[A-Za-z_][A-Za-z0-9._\-/]*$/u.test(input)) {
    if (context.vocab) return `${context.vocab}${input}`
    return context.terms.get(input) ?? context.terms.get(input.toLowerCase())
  }
  const curie = expandCurie(input, context)
  if (curie?.termType === 'NamedNode') return curie.value
  return absolute(input)
}
/** Resolves SafeCURIE/CURIE/blank node/IRI resources. */ function resource(
  value: string | undefined,
  context: ContextType,
  termAllowed: boolean,
): SubjectTermType | undefined {
  if (value === undefined) return undefined
  const input = safe(value)
  if (!input) return undefined
  if (termAllowed && !input.includes(':')) {
    const expanded = term(input, context)
    return expanded ? namedNode(expanded) : undefined
  }
  return expandCurie(input, context) ?? iriTerm(input, context.base)
}
/** Expands one CURIE. */ function expandCurie(
  value: string,
  context: ContextType,
): SubjectTermType | undefined {
  const colon = value.indexOf(':')
  if (colon < 0) return undefined
  const prefix = value.slice(0, colon).toLowerCase(), ref = value.slice(colon + 1)
  if (prefix === '_') return blankNode(ref)
  const base = context.prefixes.get(prefix)
  return base === undefined ? undefined : namedNode(`${base}${ref}`)
}
/** Resolves ordinary IRI reference. */ function iriTerm(value: string | undefined, base?: string) {
  if (value === undefined) return undefined
  const resolved = iri(value, base)
  return resolved ? namedNode(resolved) : undefined
}
/** Resolves an IRI reference. */ function iri(value: string, base?: string) {
  try {
    return base ? new URL(value, base).href : new URL(value).href
  } catch {
    return undefined
  }
}
/** Returns only absolute IRI values. */ function absolute(value: string) {
  try {
    return new URL(value).href
  } catch {
    return undefined
  }
}
/** Removes SafeCURIE brackets. */ function safe(value: string) {
  const input = value.trim()
  if (!input.startsWith('[')) return input
  if (!input.endsWith(']')) return undefined
  return input.slice(1, -1).trim() || undefined
}
/** Applies xml:base outside HTML. */ function xmlBase(
  element: MarkupElementType,
  inherited: string | undefined,
  html: boolean,
) {
  if (html) return inherited
  const value = attr(element, 'xml:base', false)
  return value === undefined ? inherited : iri(value, inherited)
}
/** Gets local language. */ function localLanguage(element: MarkupElementType, html: boolean) {
  const value = attr(element, 'xml:lang', html) ?? attr(element, 'lang', html)
  return value?.trim().toLowerCase() || undefined
}
/** Selects host profile. */ function profile(options: ParseOptionsType): ProfileType {
  if (options.profile) return options.profile
  if (options.contentType === 'application/xhtml+xml') return 'xhtml'
  if (options.contentType === 'image/svg+xml') return 'svg'
  if (options.contentType === 'application/xml' || options.contentType === 'text/xml') return 'xml'
  return 'html'
}
/** Applies first HTML base[href]. */ function hostBase(
  roots: readonly MarkupElementType[],
  supplied: string | undefined,
  html: boolean,
) {
  if (!html) return supplied
  for (const root of roots) {
    for (const e of elements(root, true)) {
      if (e.name === 'base') {
        const href = attr(e, 'href', true)
        if (href !== undefined) return iri(href, supplied)
      }
    }
  }
  return supplied
}
/** Returns implicit document subject. */ function documentTerm(base?: string) {
  return base ? namedNode(base) : undefined
}
/** Returns original descendant markup for XMLLiteral. */ function xmlChildren(
  element: MarkupElementType,
  state: StateType,
) {
  if (!element.children.length) return ''
  return state.text.slice(element.children[0]!.start, element.children.at(-1)!.end)
}
