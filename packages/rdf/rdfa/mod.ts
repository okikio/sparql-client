/** Native RDFa 1.1 extraction over the package-owned markup parser. @module */
import { blankNode, defaultGraph, literal, namedNode, quad } from '../factory.ts'
import { resolve } from '../iri.ts'
import { parse as parseXml } from '../xml/mod.ts'
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
  '': XHTML,
  as: 'https://www.w3.org/ns/activitystreams#',
  cc: 'http://creativecommons.org/ns#',
  ctag: 'http://commontag.org/ns#',
  csvw: 'http://www.w3.org/ns/csvw#',
  dc: 'http://purl.org/dc/terms/',
  dc11: 'http://purl.org/dc/elements/1.1/',
  dcat: 'http://www.w3.org/ns/dcat#',
  dcterms: 'http://purl.org/dc/terms/',
  dqv: 'http://www.w3.org/ns/dqv#',
  duv: 'https://www.w3.org/ns/duv#',
  earl: 'http://www.w3.org/ns/earl#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  gr: 'http://purl.org/goodrelations/v1#',
  grddl: 'http://www.w3.org/2003/g/data-view#',
  ical: 'http://www.w3.org/2002/12/cal/icaltzd#',
  jsonld: 'http://www.w3.org/ns/json-ld#',
  ldp: 'http://www.w3.org/ns/ldp#',
  ma: 'http://www.w3.org/ns/ma-ont#',
  oa: 'http://www.w3.org/ns/oa#',
  odrl: 'http://www.w3.org/ns/odrl/2/',
  og: 'http://ogp.me/ns#',
  org: 'http://www.w3.org/ns/org#',
  owl: 'http://www.w3.org/2002/07/owl#',
  prov: 'http://www.w3.org/ns/prov#',
  qb: 'http://purl.org/linked-data/cube#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfa: 'http://www.w3.org/ns/rdfa#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  rev: 'http://purl.org/stuff/rev#',
  rif: 'http://www.w3.org/2007/rif#',
  rr: 'http://www.w3.org/ns/r2rml#',
  schema: 'http://schema.org/',
  sd: 'http://www.w3.org/ns/sparql-service-description#',
  sioc: 'http://rdfs.org/sioc/ns#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  skosxl: 'http://www.w3.org/2008/05/skos-xl#',
  sosa: 'http://www.w3.org/ns/sosa/',
  ssn: 'http://www.w3.org/ns/ssn/',
  time: 'http://www.w3.org/2006/time#',
  v: 'http://rdf.data-vocabulary.org/#',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  void: 'http://rdfs.org/ns/void#',
  wdr: 'http://www.w3.org/2007/05/powder#',
  wdrs: 'http://www.w3.org/2007/05/powder-s#',
  xhv: XHTML,
  xml: 'http://www.w3.org/XML/1998/namespace',
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
  /** Maximum graph statements, including RDF lists and pattern-copy expansion. Defaults to one million. */
  readonly maxQuads?: number
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** Direction used when materializing `rel` and `rev` relationships. */
type DirectionType = 'forward' | 'reverse' | 'none'
/** Relationship waiting for a descendant resource. */ interface IncompleteType {
  /** Expanded predicate IRI represented by this pending RDFa relationship. */
  readonly predicate: string
  /** Relationship direction. */ readonly direction: DirectionType
  /** Shared accumulated list used by incomplete inlist relationships. */ readonly list?: ListType
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
  /** Explicit blank-node labels scoped to this document, including the empty label. */
  readonly blanks: Map<string, ReturnType<typeof blankNode>>
  /** Initial term mappings. */ readonly terms: ReadonlyMap<string, string>
  /** Default vocabulary. */ readonly vocab?: string
  /** Inherited language. */ readonly language?: string
}
/** State owned by one parse operation. */ interface StateType {
  /** RDF graph that receives quads produced by this RDFa parse operation. */
  readonly graph: GraphTermType
  /** Deterministic output. */ readonly quads: Quad[]
  /** HTML scanner rules. */ readonly html: boolean
  /** HTML and XHTML share host processing while retaining different scanners. */
  readonly host: boolean
  /** Graph expansion ceiling that also bounds cyclic pattern-copy work. */ readonly maxQuads:
    number
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
  const hostProfile = profile(options),
    html = hostProfile === 'html',
    host = html || hostProfile === 'xhtml'
  const document = await parseMarkup(source, {
    html,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const roots = document.children.filter((v): v is MarkupElementType => v.kind === 'element')
  const base = hostBase(roots, options.base, host)
  const prefixes = new Map(Object.entries(PREFIXES)),
    terms = new Map<string, string>([
      ['describedby', 'http://www.w3.org/2007/05/powder-s#describedby'],
      ['license', `${XHTML}license`],
      ['role', `${XHTML}role`],
    ])
  if (host) { for (const term of TERMS) terms.set(term, `${XHTML}${term}`) }
  const parentSubject = base ? namedNode(base) : undefined
  const context: ContextType = {
    ...(base ? { base } : {}),
    ...(parentSubject ? { parentSubject } : {}),
    incomplete: [],
    lists: new Map(),
    prefixes,
    blanks: new Map(),
    terms,
    ...(options.vocab ? { vocab: options.vocab } : {}),
    ...(options.language ? { language: options.language.toLowerCase() } : {}),
  }
  const state: StateType = {
    graph: options.graph ?? defaultGraph(),
    quads: [],
    html,
    host,
    maxQuads: options.maxQuads ?? 1_000_000,
    text: document.text,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  if (!Number.isSafeInteger(state.maxQuads) || state.maxQuads < 1) {
    throw new RangeError('maxQuads must be a positive safe integer.')
  }
  for (const root of roots) visit(root, context, state, true)
  finishLists(context.lists, state)
  if (hostProfile === 'svg') {
    for (const root of roots) {
      await embeddedXml(root, options.base, options.language, state, options)
    }
  }
  if (host) copyPatterns(state)
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
    languageRaw = localLanguage(element, state.html),
    language = languageRaw === undefined ? inherited.language : languageRaw || undefined,
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
    blanks: inherited.blanks,
    terms: inherited.terms,
    ...(vocab ? { vocab } : {}),
    ...(language ? { language } : {}),
  }
  const propertyRaw = attr(element, 'property', state.html),
    relRaw = relation(attr(element, 'rel', state.html), state.host && propertyRaw !== undefined),
    revRaw = relation(attr(element, 'rev', state.html), state.host && propertyRaw !== undefined),
    rel = predicates(relRaw, local),
    rev = predicates(revRaw, local),
    property = predicates(propertyRaw, local),
    types = predicates(attr(element, 'typeof', state.html), local),
    hasProperty = propertyRaw !== undefined,
    hasType = hasAttr(element, 'typeof', state.html),
    hasRelation = relRaw !== undefined || revRaw !== undefined,
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
      hasProperty && !hasAttr(element, 'content', state.html) &&
      !hasAttr(element, 'datatype', state.html)
    ) {
      subject = about ?? (root ? documentTerm(base) : inherited.parentObject)
      if (hasType) {
        typed = about ?? (root ? documentTerm(base) : resourceValue ?? href ?? src ?? blankNode())
        object = typed
      }
    } else {
      subject = about ?? resourceValue ?? href ?? src
      if (!subject) {
        if (root) subject = documentTerm(base)
        else if (state.host && (element.name === 'head' || element.name === 'body')) {
          subject = inherited.parentObject
        } else if (hasType) subject = blankNode()
        else if (inherited.parentObject) {
          subject = inherited.parentObject
          if (!hasProperty) skip = true
        }
      }
      if (hasType) typed = subject
    }
  } else {
    subject = about ?? (root ? documentTerm(base) : inherited.parentObject)
    if (hasType && about) typed = subject
    object = resourceValue ?? href ?? src
    if (!object && hasType && !hasAttr(element, 'about', state.html)) object = blankNode()
    if (hasType && !hasAttr(element, 'about', state.html)) typed = object
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
  } else if (subject && (rel.length || rev.length)) {
    for (const p of rel) {
      pending.push(
        hasAttr(element, 'inlist', state.html)
          ? { predicate: p, direction: 'none', list: getList(lists, subject, p) }
          : { predicate: p, direction: 'forward' },
      )
    }
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
  const child: ContextType = skip ? { ...local } : {
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
    blanks: inherited.blanks,
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
    if (pending.direction === 'none') {
      pending.list?.values.push(subject)
      continue
    }
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
    datatype = raw === undefined || raw === '' ? undefined : term(raw, context),
    datetime = state.host
      ? attr(element, 'datetime', state.html) ??
        (element.name === 'time' ? textContent(element) : undefined)
      : undefined,
    lexical = content ?? datetime ?? textContent(element)
  if (raw !== undefined && raw !== '' && datatype && datatype !== XML_LITERAL) {
    return literal(lexical, namedNode(datatype))
  }
  if (raw === '') {
    return context.language ? literal(lexical, context.language) : literal(lexical)
  }
  if (datatype === XML_LITERAL) return literal(xmlChildren(element, state), namedNode(XML_LITERAL))
  if (content !== undefined) {
    return context.language ? literal(content, context.language) : literal(content)
  }
  if (datetime !== undefined) {
    const kind = timeDatatype(datetime)
    return kind
      ? literal(datetime, namedNode(`http://www.w3.org/2001/XMLSchema#${kind}`))
      : context.language
      ? literal(datetime, context.language)
      : literal(datetime)
  }
  const muted = state.host && hasAttr(element, 'property', state.html)
  if (
    relation(attr(element, 'rel', state.html), muted) === undefined &&
    relation(attr(element, 'rev', state.html), muted) === undefined
  ) {
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
  getList(lists, subject, predicate).values.push(object)
}

/** Creates even an empty inlist mapping before descendants resolve its values. */
function getList(
  lists: Map<string, ListType>,
  subject: SubjectTermType,
  predicate: string,
): ListType {
  const key = `${subject.termType}:${subject.value}\0${predicate}`
  let list = lists.get(key)
  if (!list) {
    list = { subject, predicate, values: [] }
    lists.set(key, list)
  }
  return list
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
  if (state.quads.length >= state.maxQuads) throw new RangeError('RDFa maxQuads exceeded.')
  state.quads.push(quad(subject, namedNode(predicate), object, state.graph))
}

/**
 * Saturates HTML pattern copying with indexed subscriptions. A unique triple
 * enters the queue once, so cycles terminate without re-copying known edges.
 * Only referenced pattern resources and consumed copy edges are removed.
 */
function copyPatterns(state: StateType): void {
  const copy = 'http://www.w3.org/ns/rdfa#copy',
    pattern = 'http://www.w3.org/ns/rdfa#Pattern',
    values: Quad[] = [],
    seen = new Set<string>(),
    outgoing = new Map<string, Quad[]>(),
    copies = new Map<string, Quad[]>(),
    patterns = new Set<string>(),
    consumed = new Set<Quad>(),
    referenced = new Set<string>()
  if (!state.quads.some((value) => value.predicate.value === copy)) return
  const key = (term: SubjectTermType | ObjectTermType) =>
    JSON.stringify([term.termType, term.value])
  function add(value: Quad): void {
    const object = value.object,
      identity = JSON.stringify([
        key(value.subject),
        value.predicate.value,
        key(object),
        object.termType === 'Literal'
          ? [object.language, object.datatype.value, object.direction]
          : null,
      ])
    if (seen.has(identity)) return
    if (values.length >= state.maxQuads) {
      throw new RangeError('RDFa maxQuads exceeded during pattern copying.')
    }
    seen.add(identity)
    values.push(value)
  }
  for (const value of state.quads) add(value)
  const transfer = (edge: Quad, value: Quad) => {
    consumed.add(edge)
    referenced.add(key(edge.object))
    add(quad(edge.subject, value.predicate, value.object, state.graph))
  }
  for (let index = 0; index < values.length; index++) {
    throwIfAborted(state.signal)
    const value = values[index]!, subject = key(value.subject)
    let rows = outgoing.get(subject)
    if (!rows) {
      rows = []
      outgoing.set(subject, rows)
    }
    rows.push(value)
    if (patterns.has(subject)) {
      for (const edge of copies.get(subject) ?? []) transfer(edge, value)
    }
    if (
      value.predicate.value === RDF.type && value.object.termType === 'NamedNode' &&
      value.object.value === pattern && !patterns.has(subject)
    ) {
      patterns.add(subject)
      for (const edge of copies.get(subject) ?? []) for (const row of rows) transfer(edge, row)
    }
    if (value.predicate.value === copy && value.object.termType !== 'Literal') {
      const target = key(value.object)
      let edges = copies.get(target)
      if (!edges) {
        edges = []
        copies.set(target, edges)
      }
      edges.push(value)
      if (patterns.has(target)) {
        for (const row of outgoing.get(target) ?? []) transfer(value, row)
      }
    }
  }
  const consumers = new Set([...consumed].map((edge) => key(edge.subject)))
  state.quads.length = 0
  for (const value of values) {
    if (referenced.has(key(value.subject)) || consumed.has(value)) continue
    if (
      value.predicate.value === RDF.type && value.object.termType === 'NamedNode' &&
      value.object.value === pattern && consumers.has(key(value.subject))
    ) continue
    state.quads.push(value)
  }
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
  if (value.trim() === '') return iriTerm('', context.base)
  const input = safe(value)
  if (!input) return undefined
  if (termAllowed && !input.includes(':')) {
    const expanded = term(input, context)
    return expanded ? namedNode(expanded) : undefined
  }
  const expanded = expandCurie(input, context)
  return expanded ?? (value.trim().startsWith('[') ? undefined : iriTerm(input, context.base))
}
/** Expands one CURIE. */ function expandCurie(
  value: string,
  context: ContextType,
): SubjectTermType | undefined {
  const colon = value.indexOf(':')
  if (colon < 0) return undefined
  const prefix = value.slice(0, colon).toLowerCase(), ref = value.slice(colon + 1)
  if (prefix === '_') {
    let node = context.blanks.get(ref)
    if (!node) {
      node = blankNode()
      context.blanks.set(ref, node)
    }
    return node
  }
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
    return resolve(value, base)
  } catch {
    return undefined
  }
}
/** Returns only absolute IRI values. */ function absolute(value: string) {
  try {
    return resolve(value)
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
  return value?.trim().toLowerCase()
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
        if (href !== undefined) return iri(href, supplied)?.split('#')[0]
      }
    }
  }
  return supplied?.split('#')[0]
}

/** HTML properties mute unprefixed relation terms before subject selection. */
function relation(value: string | undefined, muted: boolean): string | undefined {
  if (!muted || value === undefined) return value
  const filtered = value.trim().split(/\s+/u).filter((token) => token.includes(':')).join(' ')
  return filtered || undefined
}

/** Infers HTML time datatypes from their XML Schema lexical forms. */
function timeDatatype(value: string): string | undefined {
  const timezone = '(?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])?',
    year = '-?(?:[0-9]{4}|[1-9][0-9]{4,})',
    date = `${year}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])`,
    time = '(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]+)?|24:00:00(?:\\.0+)?)'
  for (
    const [kind, pattern] of [
      [
        'duration',
        '-?P(?=[0-9]|T[0-9])(?:[0-9]+Y)?(?:[0-9]+M)?(?:[0-9]+D)?(?:T(?=[0-9])(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+(?:\\.[0-9]+)?S)?)?',
      ],
      ['dateTime', `${date}T${time}${timezone}`],
      ['date', `${date}${timezone}`],
      ['time', `${time}${timezone}`],
      ['gYearMonth', `${year}-(?:0[1-9]|1[0-2])${timezone}`],
      ['gYear', `${year}${timezone}`],
    ]
  ) if (new RegExp(`^(?:${pattern})$`, 'u').test(value)) return kind
  return undefined
}
/** Returns implicit document subject. */ function documentTerm(base?: string) {
  return base ? namedNode(base) : undefined
}
/** Returns original descendant markup for XMLLiteral. */ function xmlChildren(
  element: MarkupElementType,
  state: StateType,
) {
  if (!element.children.length) return ''
  if (!state.host) return state.text.slice(element.children[0]!.start, element.children.at(-1)!.end)
  const namespaces = namespacesAt(element, true)
  if (state.html && !namespaces.has('xmlns')) {
    namespaces.set('xmlns', 'http://www.w3.org/1999/xhtml')
  }
  const raw = state.text.slice(element.start, element.end),
    start = element.start + openingEnd(raw),
    end = element.start + raw.lastIndexOf('</')
  let cursor = start, result = ''
  for (const child of element.children) {
    if (child.kind !== 'element') continue
    result += state.text.slice(cursor, child.start) + xmlElement(child, namespaces, state.text)
    cursor = child.end
  }
  return result + state.text.slice(cursor, end >= start ? end : element.end)
}

/** Escapes decoded values for standalone XML fragment serialization. */
function xmlEscape(value: string, attribute = false): string {
  const text = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return attribute
    ? text.replaceAll('"', '&quot;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll(
      '\t',
      '&#9;',
    )
    : text
}

/** Collects explicit in-scope namespace declarations, including RDFa prefix attributes. */
function namespacesAt(element: MarkupElementType, prefix: boolean): Map<string, string> {
  const lineage: MarkupElementType[] = []
  for (let current: MarkupElementType | undefined = element; current; current = current.parent) {
    lineage.push(current)
  }
  const values = new Map<string, string>()
  for (const current of lineage.reverse()) {
    for (const attribute of current.attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        values.set(attribute.name, attribute.value)
      }
    }
    if (prefix) {
      for (const match of (attr(current, 'prefix') ?? '').matchAll(/([^\s:]+):\s+([^\s]+)/gu)) {
        values.set(`xmlns:${match[1]}`, match[2]!)
      }
    }
  }
  return values
}

/** Serializes a fragment root with inherited declarations while preserving its inner source. */
function xmlElement(
  element: MarkupElementType,
  namespaces: ReadonlyMap<string, string>,
  text: string,
  extra: ReadonlyMap<string, string> = new Map(),
): string {
  const attributes = new Map(
    element.attributes.map((attribute) => [attribute.name, attribute.value]),
  )
  for (const [name, value] of namespaces) if (!attributes.has(name)) attributes.set(name, value)
  for (const [name, value] of extra) if (!attributes.has(name)) attributes.set(name, value)
  const opening = `<${element.name}${
    [...attributes].map(([name, value]) => ` ${name}="${xmlEscape(value, true)}"`).join('')
  }>`
  // Source ranges retain comments, processing instructions, CDATA and descendant spelling.
  const raw = text.slice(element.start, element.end),
    start = openingEnd(raw),
    end = raw.lastIndexOf('</')
  return `${opening}${end >= start ? raw.slice(start, end) : ''}</${element.name}>`
}

/** Imports SVG metadata RDF/XML through the same package-owned native XML processor. */
async function embeddedXml(
  element: MarkupElementType,
  inheritedBase: string | undefined,
  inheritedLanguage: string | undefined,
  state: StateType,
  options: ParseOptionsType,
  inheritedNamespaces: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  throwIfAborted(state.signal)
  const namespaces = new Map(inheritedNamespaces)
  for (const attribute of element.attributes) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
      namespaces.set(attribute.name, attribute.value)
    }
  }
  const colon = element.name.indexOf(':'),
    namespace = namespaces.get(colon < 0 ? 'xmlns' : `xmlns:${element.name.slice(0, colon)}`),
    local = element.name.slice(colon + 1)
  if (namespace === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' && local === 'RDF') {
    const extra = new Map<string, string>()
    if (inheritedLanguage) extra.set('xml:lang', inheritedLanguage)
    for await (
      const value of parseXml(xmlElement(element, namespaces, state.text, extra), {
        ...(inheritedBase === undefined ? {} : { base: inheritedBase }),
        graph: state.graph,
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
        ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(state.signal ? { signal: state.signal } : {}),
      })
    ) emit(state, value.subject, value.predicate.value, value.object)
    return
  }
  const base = xmlBase(element, inheritedBase, false),
    language = localLanguage(element, false) ?? inheritedLanguage
  for (const child of element.children) {
    if (child.kind === 'element') {
      await embeddedXml(child, base, language, state, options, namespaces)
    }
  }
}

/** Finds the start-tag boundary without treating a quoted greater-than sign as markup. */
function openingEnd(text: string): number {
  let quote = ''
  for (let index = 1; index < text.length; index++) {
    const character = text[index]!
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '>') return index + 1
  }
  throw new SyntaxError('XML fragment has an unterminated start tag.')
}
