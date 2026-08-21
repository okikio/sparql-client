/** Native RDF 1.1/1.2 XML parsing over the package-owned range-first markup parser. @module */
import { blankNode, defaultGraph, literal, namedNode, quad, triple } from '../factory.ts'
import { attr, type MarkupElementType, parseMarkup, textContent } from '../markup.ts'
import {
  type GraphTermType,
  type ObjectTermType,
  type Quad,
  RDF,
  type SubjectTermType,
} from '../term.ts'
import { type TextSourceType, throwIfAborted } from '../text.ts'
/** RDF namespace IRI used to expand RDF/XML syntax names. */
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  XML_NS = 'http://www.w3.org/XML/1998/namespace',
  ITS_NS = 'http://www.w3.org/2005/11/its',
  ITS_VERSION = `${ITS_NS}version`,
  XML_LITERAL = `${RDF_NS}XMLLiteral`

/** Core RDF/XML syntax IRIs that cannot be used as node or property element names. */
const CORE_SYNTAX_TERMS = new Set([
  `${RDF_NS}RDF`,
  `${RDF_NS}ID`,
  `${RDF_NS}about`,
  `${RDF_NS}annotation`,
  `${RDF_NS}annotationNodeID`,
  `${RDF_NS}parseType`,
  `${RDF_NS}resource`,
  `${RDF_NS}nodeID`,
  `${RDF_NS}datatype`,
  `${RDF_NS}version`,
])

/** Withdrawn RDF/XML terms retained only so the parser can reject their obsolete syntax. */
const OLD_SYNTAX_TERMS = new Set([
  `${RDF_NS}aboutEach`,
  `${RDF_NS}aboutEachPrefix`,
  `${RDF_NS}bagID`,
])

/** XML NCName grammar used by `rdf:ID` and `rdf:nodeID`. Colons are deliberately excluded. */
const NCNAME =
  /^[A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}][-.A-Z_a-z0-9\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0300-\u036F\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*$/u
/** One RDF/XML property attribute after namespace expansion and grammar validation. */ interface PropertyAttributeType {
  /** Expanded predicate IRI. */ readonly iri: string
  /** Decoded XML attribute value before RDF term conversion. */ readonly value: string
}
/** Options for native RDF/XML parsing. */
export interface ParseOptionsType {
  /** Initial base IRI used to resolve relative RDF/XML identifiers. */
  readonly base?: string
  /** Target graph. */ readonly graph?: GraphTermType
  /** Reject malformed XML. Retained for API clarity; native parsing is strict. */ readonly strict?:
    boolean
  /** Track positions in future diagnostics. */ readonly trackPosition?: boolean
  /** Permit repeated rdf:ID/base pairs. */ readonly allowDuplicateRdfIds?: boolean
  /** Validate generated IRIs. */ readonly validateIri?: boolean
  /** Accept unknown rdf:version values. */ readonly parseUnsupportedVersions?: boolean
  /** Media-type RDF/XML version. */ readonly version?: '1.1' | '1.2-basic' | '1.2'
  /** Maximum decoded source bytes. */ readonly maxBytes?: number
  /** Maximum markup nodes. */ readonly maxNodes?: number
  /** Maximum nesting depth. */ readonly maxDepth?: number
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/** Namespace/base/language state inherited by XML descendants. */ interface ContextType {
  /** In-scope XML namespace prefix mappings inherited by this element. */
  readonly ns: ReadonlyMap<string, string>
  /** In-scope base IRI. */ readonly base?: string
  /** In-scope language. */ readonly language?: string
  /** In-scope direction. */ readonly direction?: 'ltr' | 'rtl'
  /** Effective RDF version. */ readonly version: '1.1' | '1.2-basic' | '1.2'
}
/** Per-operation parser state. */ interface StateType {
  /** RDF graph that receives quads produced by this RDF/XML parse operation. */
  readonly graph: GraphTermType
  /** Original source for XML literal slices. */ readonly text: string
  /** Result quads. */ readonly quads: Quad[]
  /** Stable rdf:nodeID blank nodes. */ readonly nodes: Map<string, ReturnType<typeof blankNode>>
  /** Used rdf:ID/base keys. */ readonly ids: Set<string>
  /** Whether repeated rdf:ID is allowed. */ readonly allowDuplicate: boolean
  /** IRI validation switch. */ readonly validateIri: boolean
  /** Caller cancellation. */ readonly signal?: AbortSignal
}
/**
 * Parses RDF/XML directly into native RDF terms.
 *
 * Namespace expansion, `xml:base`, language, typed nodes, property attributes,
 * collections, XML literals, classic `rdf:ID` reification, RDF 1.2 triple terms,
 * and RDF 1.2 annotation reifiers are handled without an external SAX/RDF parser.
 */
export async function* parse(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<Quad> {
  const document = await parseMarkup(source, {
    html: false,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const roots = document.children.filter((v): v is MarkupElementType => v.kind === 'element')
  if (roots.length !== 1) {
    throw new SyntaxError('RDF/XML document must contain one document element.')
  }
  const root = roots[0]!
  const rootContext = context(root, {
    ns: new Map([['rdf', RDF_NS], ['xml', XML_NS], ['its', ITS_NS]]),
    ...(options.base ? { base: options.base } : {}),
    version: options.version ?? '1.2',
  })
  const rootName = expandName(root.name, rootContext)
  const state: StateType = {
    graph: options.graph ?? defaultGraph(),
    text: document.text,
    quads: [],
    nodes: new Map(),
    ids: new Set(),
    allowDuplicate: options.allowDuplicateRdfIds ?? false,
    validateIri: options.validateIri ?? true,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  if (rootName === `${RDF_NS}RDF`) {
    const version = attr(root, 'rdf:version')
    if (
      version && !['1.1', '1.2-basic', '1.2'].includes(version) &&
      !(options.parseUnsupportedVersions ?? false)
    ) throw new SyntaxError(`Unsupported rdf:version '${version}'.`)
    for (const child of children(root)) node(child, rootContext, state)
  } else node(root, rootContext, state)
  for (const value of state.quads) {
    throwIfAborted(options.signal)
    yield value
  }
}
/** Parses one RDF node element and returns its subject. */ function node(
  element: MarkupElementType,
  parent: ContextType,
  state: StateType,
): SubjectTermType {
  throwIfAborted(state.signal)
  const ctx = context(element, parent)
  const type = expandName(element.name, ctx)
  assertNodeIri(type)
  const about = attr(element, 'rdf:about'),
    id = attr(element, 'rdf:ID'),
    nodeId = attr(element, 'rdf:nodeID')
  if ([about, id, nodeId].filter((v) => v !== undefined).length > 1) {
    throw new SyntaxError('RDF/XML node element cannot combine rdf:about, rdf:ID, and rdf:nodeID.')
  }
  let subject: SubjectTermType
  if (about !== undefined) subject = namedNode(resolveIri(about, ctx.base, state))
  else if (id !== undefined) {
    const iri = idIri(id, ctx, state)
    subject = namedNode(iri)
  } else if (nodeId !== undefined) subject = blank(state, nodeId)
  else subject = blankNode()
  if (type !== `${RDF_NS}Description`) {
    emit(state, subject, RDF.type, namedNode(type))
  }
  for (const a of propertyAttributes(element, ctx)) {
    emit(
      state,
      subject,
      a.iri,
      a.iri === RDF.type
        ? namedNode(resolveIri(a.value, ctx.base, state))
        : langLiteral(a.value, ctx),
    )
  }
  let li = 1
  for (const child of children(element)) {
    let predicate = expandName(child.name, context(child, ctx))
    if (predicate === `${RDF_NS}li`) predicate = `${RDF_NS}_${li++}`
    property(child, subject, predicate, ctx, state)
  }
  return subject
}
/** Parses one RDF property element and emits its statement plus reification/annotation statements. */ function property(
  element: MarkupElementType,
  subject: SubjectTermType,
  predicate: string,
  parent: ContextType,
  state: StateType,
): void {
  assertPropertyIri(predicate)
  const ctx = context(element, parent),
    parseType = attr(element, 'rdf:parseType'),
    resourceAttr = attr(element, 'rdf:resource'),
    nodeId = attr(element, 'rdf:nodeID'),
    datatype = attr(element, 'rdf:datatype'),
    kids = children(element),
    attrs = propertyAttributes(element, ctx)
  validatePropertyShape(element, parseType, resourceAttr, nodeId, datatype, kids, attrs)
  let object: ObjectTermType
  if (parseType === 'Resource') {
    const b = blankNode()
    object = b
    let li = 1
    for (const child of kids) {
      let p = expandName(child.name, context(child, ctx))
      if (p === `${RDF_NS}li`) p = `${RDF_NS}_${li++}`
      property(child, b, p, ctx, state)
    }
  } else if (parseType === 'Collection') {
    const values = kids.map((child) => node(child, ctx, state))
    object = list(values, state)
  } else if (parseType === 'Literal') {
    object = literal(xmlChildren(element, state), namedNode(XML_LITERAL))
  } else if (parseType === 'Triple') {
    if (kids.length !== 1) {
      throw new SyntaxError('rdf:parseType="Triple" requires exactly one node element.')
    }
    const temp: StateType = { ...state, quads: [] }
    node(kids[0]!, ctx, temp)
    if (temp.quads.length !== 1) {
      throw new SyntaxError('RDF/XML triple term must describe exactly one triple.')
    }
    const q = temp.quads[0]!
    object = triple(q.subject, q.predicate, q.object)
  } else if (parseType !== undefined) {
    // RDF/XML treats unknown parseType tokens as `Literal`, not as ordinary text syntax.
    object = literal(xmlChildren(element, state), namedNode(XML_LITERAL))
  } else if (resourceAttr !== undefined) {
    object = namedNode(resolveIri(resourceAttr, ctx.base, state))
    emitPropertyAttributes(attrs, object, ctx, state)
  } else if (nodeId !== undefined) {
    object = blank(state, nodeId)
    emitPropertyAttributes(attrs, object, ctx, state)
  } else if (kids.length === 1) object = node(kids[0]!, ctx, state)
  else if (kids.length > 1) {
    throw new SyntaxError('RDF/XML resource property element contains more than one node element.')
  } else {
    const value = textContent(element)
    object = datatype !== undefined
      ? literal(value, namedNode(resolveIri(datatype, ctx.base, state)))
      : langLiteral(value, ctx)
    if (attrs.length) {
      const b = blankNode()
      object = b
      emitPropertyAttributes(attrs, b, ctx, state)
    }
  }
  emit(state, subject, predicate, object)
  const statement = quad(subject, namedNode(predicate), object)
  const id = attr(element, 'rdf:ID')
  if (id !== undefined) {
    const reifier = namedNode(idIri(id, ctx, state))
    emit(state, reifier, RDF.type, namedNode(RDF.statement))
    emit(state, reifier, RDF.subject, subject)
    emit(state, reifier, RDF.predicate, namedNode(predicate))
    emit(state, reifier, RDF.object, object)
  }
  const annotation = attr(element, 'rdf:annotation'),
    annotationNode = attr(element, 'rdf:annotationNodeID')
  if (annotation !== undefined || annotationNode !== undefined) {
    const reifier = annotation !== undefined
      ? namedNode(resolveIri(annotation, ctx.base, state))
      : blank(state, annotationNode!)
    emit(state, reifier, RDF.reifies, statement)
  }
}
/** Builds an RDF collection and returns its head. */ function list(
  values: readonly SubjectTermType[],
  state: StateType,
): ObjectTermType {
  if (!values.length) return namedNode(RDF.nil)
  const head = blankNode()
  let cursor = head
  for (let i = 0; i < values.length; i++) {
    emit(state, cursor, RDF.first, values[i]!)
    const last = i === values.length - 1, next = last ? namedNode(RDF.nil) : blankNode()
    emit(state, cursor, RDF.rest, next)
    if (!last) cursor = next as ReturnType<typeof blankNode>
  }
  return head
}
/** Applies namespace, base, language, direction, and version declarations. */ function context(
  element: MarkupElementType,
  parent: ContextType,
): ContextType {
  const ns = new Map(parent.ns)
  for (const a of element.attributes) {
    if (a.name === 'xmlns') ns.set('', a.value)
    else if (a.name.startsWith('xmlns:')) ns.set(a.name.slice(6), a.value)
  }
  const baseRaw = attr(element, 'xml:base'),
    base = baseRaw === undefined ? parent.base : resolve(baseRaw, parent.base),
    langRaw = attr(element, 'xml:lang'),
    dirRaw = attr(element, 'its:dir'),
    version = attr(element, 'rdf:version') as ContextType['version'] | undefined
  return {
    ns,
    ...(base ? { base } : {}),
    ...(langRaw !== undefined
      ? (langRaw ? { language: langRaw.toLowerCase() } : {})
      : parent.language
      ? { language: parent.language }
      : {}),
    ...(dirRaw === 'ltr' || dirRaw === 'rtl'
      ? { direction: dirRaw }
      : parent.direction
      ? { direction: parent.direction }
      : {}),
    version: version ?? parent.version,
  }
}
/** Expands an element/attribute QName through the in-scope namespace map. */ function expandName(
  name: string,
  ctx: ContextType,
): string {
  const colon = name.indexOf(':')
  if (colon < 0) {
    const base = ctx.ns.get('')
    if (!base) throw new SyntaxError(`Unqualified RDF/XML name '${name}' has no default namespace.`)
    return `${base}${name}`
  }
  const base = ctx.ns.get(name.slice(0, colon))
  if (!base) throw new SyntaxError(`Unknown XML namespace prefix '${name.slice(0, colon)}'.`)
  return `${base}${name.slice(colon + 1)}`
}
/** Expands a non-xmlns attribute QName. */ function attributeIri(
  name: string,
  ctx: ContextType,
): string | undefined {
  if (name === 'xmlns' || name.startsWith('xmlns:')) return undefined
  const colon = name.indexOf(':')
  if (colon < 0) return undefined
  const base = ctx.ns.get(name.slice(0, colon))
  return base ? `${base}${name.slice(colon + 1)}` : undefined
}
/**
 * Returns RDF property attributes while excluding XML/RDF syntax attributes.
 *
 * `rdf:type` remains in this list because the RDF/XML grammar defines it as a
 * property attribute whose value is converted to an IRI rather than a literal.
 */
function propertyAttributes(
  element: MarkupElementType,
  ctx: ContextType,
): PropertyAttributeType[] {
  const values: PropertyAttributeType[] = []
  for (const attribute of element.attributes) {
    const iri = attributeIri(attribute.name, ctx)
    if (!iri || control(iri) || contextAttribute(iri)) continue
    if (iri.startsWith(XML_NS)) {
      throw new SyntaxError(
        `RDF/XML does not allow XML attribute '${attribute.name}' in this position.`,
      )
    }
    assertPropertyAttributeIri(iri)
    values.push({ iri, value: attribute.value })
  }
  return values
}

/** Tests XML/ITS attributes that alter parse context instead of creating RDF properties. */
function contextAttribute(iri: string): boolean {
  return iri === `${XML_NS}lang` || iri === `${XML_NS}base` || iri === `${ITS_NS}dir` ||
    iri === ITS_VERSION
}

/**
 * Emits attributes that describe one empty-property resource.
 *
 * RDF/XML creates one resource `r` for the property element and applies every
 * property attribute to that same resource. `rdf:type` is the one attribute
 * whose value is an IRI; all other property attributes produce literals.
 */
function emitPropertyAttributes(
  attrs: readonly PropertyAttributeType[],
  resource: SubjectTermType,
  ctx: ContextType,
  state: StateType,
): void {
  for (const a of attrs) {
    emit(
      state,
      resource,
      a.iri,
      a.iri === RDF.type
        ? namedNode(resolveIri(a.value, ctx.base, state))
        : langLiteral(a.value, ctx),
    )
  }
}

/**
 * Rejects attribute/content combinations that cannot match an RDF/XML property production.
 *
 * The native parser does not use a schema validator before semantic conversion, so this check
 * prevents invalid combinations such as `rdf:parseType` plus `rdf:resource`, or a child node
 * plus property attributes, from being silently interpreted with implementation precedence.
 */
function validatePropertyShape(
  element: MarkupElementType,
  parseType: string | undefined,
  resource: string | undefined,
  nodeId: string | undefined,
  datatype: string | undefined,
  kids: readonly MarkupElementType[],
  attrs: readonly PropertyAttributeType[],
): void {
  const selectors = [resource, nodeId, datatype].filter((value) => value !== undefined).length
  if (selectors > 1) {
    throw new SyntaxError(
      'RDF/XML property element cannot combine rdf:resource, rdf:nodeID, and rdf:datatype.',
    )
  }
  const annotation = attr(element, 'rdf:annotation')
  const annotationNode = attr(element, 'rdf:annotationNodeID')
  if (annotation !== undefined && annotationNode !== undefined) {
    throw new SyntaxError(
      'RDF/XML property element cannot combine rdf:annotation and rdf:annotationNodeID.',
    )
  }
  const text = element.children.some((value) => value.kind === 'text' && value.value.trim() !== '')
  if (parseType !== undefined && (selectors || attrs.length)) {
    throw new SyntaxError(
      'RDF/XML rdf:parseType property cannot combine resource, node, datatype, or property attributes.',
    )
  }
  if (parseType === 'Resource' || parseType === 'Collection' || parseType === 'Triple') {
    if (text) throw new SyntaxError(`rdf:parseType="${parseType}" cannot contain direct text.`)
  }
  if (parseType === undefined && kids.length && (selectors || attrs.length || text)) {
    throw new SyntaxError(
      'RDF/XML resource property with a child node cannot combine text, resource, node, datatype, or property attributes.',
    )
  }
  if (
    parseType === undefined && text &&
    (resource !== undefined || nodeId !== undefined || attrs.length)
  ) {
    throw new SyntaxError(
      'RDF/XML literal property cannot combine text with resource, node, or property attributes.',
    )
  }
}

/** Tests whether an attribute IRI belongs to RDF/XML structural syntax instead of a property. */ function control(
  iri: string,
) {
  return CORE_SYNTAX_TERMS.has(iri)
}
/** Enforces the RDF 1.2 `nodeElementIRI` exclusion set. */ function assertNodeIri(
  iri: string,
): void {
  if (CORE_SYNTAX_TERMS.has(iri) || iri === `${RDF_NS}li` || OLD_SYNTAX_TERMS.has(iri)) {
    throw new SyntaxError(`RDF/XML node element cannot use reserved name '${iri}'.`)
  }
}
/** Enforces the RDF 1.2 `propertyElementURI` exclusion set while retaining `rdf:li`. */ function assertPropertyIri(
  iri: string,
): void {
  if (CORE_SYNTAX_TERMS.has(iri) || iri === `${RDF_NS}Description` || OLD_SYNTAX_TERMS.has(iri)) {
    throw new SyntaxError(`RDF/XML property element cannot use reserved name '${iri}'.`)
  }
}
/** Enforces the RDF 1.2 `propertyAttributeIRI` exclusion set. */ function assertPropertyAttributeIri(
  iri: string,
): void {
  if (
    CORE_SYNTAX_TERMS.has(iri) || iri === `${RDF_NS}Description` || iri === `${RDF_NS}li` ||
    OLD_SYNTAX_TERMS.has(iri)
  ) {
    throw new SyntaxError(`RDF/XML property attribute cannot use reserved name '${iri}'.`)
  }
}
/** Returns child elements only. */ function children(element: MarkupElementType) {
  return element.children.filter((v): v is MarkupElementType => v.kind === 'element')
}
/** Resolves and validates one IRI. */ function resolveIri(
  value: string,
  base: string | undefined,
  state: StateType,
) {
  const iri = resolve(value, base)
  if (!iri) throw new SyntaxError(`Invalid RDF/XML IRI '${value}'.`)
  if (state.validateIri) {
    try {
      new URL(iri)
    } catch {
      throw new SyntaxError(`Invalid RDF/XML IRI '${iri}'.`)
    }
  }
  return iri
}
/** Resolves an IRI reference. */ function resolve(value: string, base?: string) {
  try {
    return base ? new URL(value, base).href : new URL(value).href
  } catch {
    return undefined
  }
}
/** Resolves rdf:ID and enforces document uniqueness. */ function idIri(
  value: string,
  ctx: ContextType,
  state: StateType,
) {
  if (!NCNAME.test(value)) {
    throw new SyntaxError(`Invalid rdf:ID '${value}'.`)
  }
  const iri = resolveIri(`#${value}`, ctx.base, state), key = `${ctx.base ?? ''}\0${value}`
  if (!state.allowDuplicate && state.ids.has(key)) {
    throw new SyntaxError(`Duplicate rdf:ID '${value}'.`)
  }
  state.ids.add(key)
  return iri
}
/** Gets a stable blank node for one valid XML NCName used by `rdf:nodeID`. */ function blank(
  state: StateType,
  id: string,
) {
  if (!NCNAME.test(id)) throw new SyntaxError(`Invalid rdf:nodeID '${id}'.`)
  let value = state.nodes.get(id)
  if (!value) {
    value = blankNode(id)
    state.nodes.set(id, value)
  }
  return value
}
/** Creates plain/language/directional literal from inherited context. */ function langLiteral(
  value: string,
  ctx: ContextType,
): ObjectTermType {
  return ctx.language
    ? literal(value, {
      language: ctx.language,
      ...(ctx.direction ? { direction: ctx.direction } : {}),
    })
    : literal(value)
}
/** Emits one quad to operation buffer. */ function emit(
  state: StateType,
  subject: SubjectTermType,
  predicate: string,
  object: ObjectTermType,
) {
  state.quads.push(quad(subject, namedNode(predicate), object, state.graph))
}
/** Returns original child markup for rdf:XMLLiteral. */ function xmlChildren(
  element: MarkupElementType,
  state: StateType,
) {
  if (!element.children.length) return ''
  return state.text.slice(element.children[0]!.start, element.children.at(-1)!.end)
}
