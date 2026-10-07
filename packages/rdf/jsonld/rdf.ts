/**
 * Direct JSON-LD expanded-form to RDF conversion and RDF deserialization.
 *
 * The converter works on native RDF terms. It does not serialize through
 * N-Quads or delegate JSON-LD processing to another implementation.
 *
 * @module
 */

import { blankNode, defaultGraph, literal, namedNode, quad } from '../factory.ts'
import {
  type GraphTermType,
  type ObjectTermType,
  type Quad,
  RDF,
  type SubjectTermType,
  type Term,
  XSD,
} from '../term.ts'
import { absolute, compare, JsonLdError, object } from './context.ts'
import { listObject, valueObject } from './expand.ts'
import { flatten } from './node.ts'
import type {
  GeneralizedQuadType,
  JsonLdValueType,
  ProcessingModeType,
  RdfDirectionType,
} from './types.ts'

/** JSON-LD i18n datatype namespace used by the `i18n-datatype` direction mapping. */
const I18N = 'https://www.w3.org/ns/i18n#'
/** RDF namespace reconstructed from the canonical `rdf:type` IRI. */
const RDF_NS = RDF.type.slice(0, RDF.type.lastIndexOf('#') + 1)
/** Predicate used by compound literals for their lexical value. */
const RDF_VALUE = `${RDF_NS}value`
/** Predicate used by compound literals for their optional language. */
const RDF_LANGUAGE = `${RDF_NS}language`
/** Predicate used by compound literals for their base direction. */
const RDF_DIRECTION = `${RDF_NS}direction`
/** Datatype used by JSON-LD `@json` values. */
const RDF_JSON = `${RDF_NS}JSON`

/** Options for JSON-LD to RDF conversion. */
export interface ToRdfOptionsType {
  /** Permit blank-node predicates in generalized RDF output. */
  readonly produceGeneralizedRdf?: boolean
  /** Mapping used when an expanded value has `@direction`. */
  readonly rdfDirection?: RdfDirectionType
  /** Caller cancellation checked between node and list operations. */
  readonly signal?: AbortSignal
}

/** Options for RDF to JSON-LD conversion. */
export interface FromRdfOptionsType {
  /** Retain JSON-LD 1.0 collection and JSON datatype behavior when requested. */
  readonly processingMode?: ProcessingModeType
  /** Directional string mapping to recognize while reading RDF literals. */
  readonly rdfDirection?: RdfDirectionType
  /** Convert recognized XSD boolean and numeric lexical forms to JSON scalars. */
  readonly useNativeTypes?: boolean
  /** Preserve `rdf:type` as an ordinary property instead of emitting `@type`. */
  readonly useRdfType?: boolean
  /** Caller cancellation checked between quads and list reconstruction steps. */
  readonly signal?: AbortSignal
}

/**
 * Converts expanded JSON-LD directly to native RDF quads.
 *
 * JSON-LD lists are emitted as RDF collections. Directional strings use the
 * mapping selected by `rdfDirection`; without a mapping, the direction is not
 * representable in RDF 1.1 and is therefore omitted from the resulting
 * literal, as required by JSON-LD's RDF conversion model.
 */
export function toRdf(
  expanded: JsonLdValueType,
  options: ToRdfOptionsType = {},
): GeneralizedQuadType[] {
  const output: GeneralizedQuadType[] = []
  const ids = new Map<string, ReturnType<typeof blankNode>>()
  let sequence = 0

  /**
   * Keeps source identifiers stable within this conversion while allocating
   * fresh RDF identities for independently converted documents. Source blank
   * labels have document scope; retaining them as global RDF labels would
   * merge unrelated resources when callers combine conversion results.
   */
  const getBlank = (id: string) => {
    const key = id.startsWith('_:') ? id.slice(2) : id
    let value = ids.get(key)
    if (value === undefined) {
      value = blankNode()
      ids.set(key, value)
    }
    return value
  }

  /** Converts an expanded identifier to a native RDF subject. */
  const getSubject = (id: string): SubjectTermType =>
    id.startsWith('_:') ? getBlank(id) : namedNode(id)

  /** Converts an expanded graph identifier to a native RDF graph term. */
  const getGraph = (id: string): GraphTermType => {
    if (id === '@default') return defaultGraph()
    return id.startsWith('_:') ? getBlank(id) : namedNode(id)
  }

  /** Adds one quad to the output using the current graph. */
  const addQuad = (
    subject: SubjectTermType,
    predicate: string,
    value: ObjectTermType,
    graph: GraphTermType,
  ) => {
    if (predicate.startsWith('_:')) {
      if (!options.produceGeneralizedRdf) return
      const term = getBlank(predicate)
      output.push(
        Object.freeze({
          termType: 'Quad',
          value: '',
          subject,
          predicate: term,
          object: value,
          graph,
          equals(other?: Term | null) {
            if (other?.termType !== 'Quad') return false
            const candidate = other as Partial<GeneralizedQuadType>
            return subject.equals(candidate.subject) && term.equals(candidate.predicate) &&
              value.equals(candidate.object) && graph.equals(candidate.graph)
          },
        }),
      )
    } else if (absolute(predicate)) output.push(quad(subject, namedNode(predicate), value, graph))
  }

  /** Converts an expanded object or value into an RDF object term. */
  const getObject = (value: JsonLdValueType, graph: GraphTermType): ObjectTermType | undefined => {
    if (!object(value)) return undefined

    if (typeof value['@id'] === 'string') {
      return value['@id'].startsWith('_:') || absolute(value['@id'])
        ? getSubject(value['@id'])
        : undefined
    }

    if (listObject(value)) {
      const values = asArray(value['@list'] ?? []).map((item) => getObject(item, graph))
      if (values.length === 0) return namedNode(RDF.nil)

      const head = blankNode()
      let cursor = head

      for (let index = 0; index < values.length; index++) {
        abort(options.signal)
        const item = values[index]

        if (item !== undefined) addQuad(cursor, RDF.first, item, graph)
        const last = index === values.length - 1
        const next = last ? namedNode(RDF.nil) : blankNode()
        addQuad(cursor, RDF.rest, next, graph)
        if (!last && next.termType === 'BlankNode') cursor = next
      }

      return head
    }

    if (!valueObject(value)) return undefined

    const raw = value['@value']
    if (value['@type'] === '@json') return literal(canonicalJson(raw ?? null), namedNode(RDF_JSON))
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      return undefined
    }

    const lexical = typeof raw === 'string'
      ? raw
      : typeof raw === 'boolean'
      ? (raw ? 'true' : 'false')
      : !Number.isInteger(raw) || Math.abs(raw) >= 1e21 || value['@type'] === XSD.double
      ? double(raw)
      : String(raw)
    const language = typeof value['@language'] === 'string' ? value['@language'] : undefined
    const direction = value['@direction'] === 'ltr' || value['@direction'] === 'rtl'
      ? value['@direction']
      : undefined

    if (direction !== undefined && options.rdfDirection === 'i18n-datatype') {
      return literal(lexical, namedNode(`${I18N}${language ?? ''}_${direction}`))
    }

    if (direction !== undefined && options.rdfDirection === 'compound-literal') {
      const node = blankNode()
      addQuad(node, RDF_VALUE, literal(lexical), graph)
      if (language !== undefined) addQuad(node, RDF_LANGUAGE, literal(language), graph)
      addQuad(node, RDF_DIRECTION, literal(direction), graph)
      return node
    }

    if (language !== undefined) {
      return /^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/u.test(language)
        ? literal(lexical, language)
        : undefined
    }
    if (typeof value['@type'] === 'string') {
      return absolute(value['@type']) ? literal(lexical, namedNode(value['@type'])) : undefined
    }
    if (typeof raw === 'boolean') return literal(lexical, namedNode(XSD.boolean))
    if (typeof raw === 'number') {
      return Number.isInteger(raw) && Math.abs(raw) < 1e21
        ? literal(lexical, namedNode(XSD.integer))
        : literal(lexical, namedNode(XSD.double))
    }
    return literal(lexical)
  }

  /** Walks expanded node objects and emits their RDF statements. */
  const visit = (value: JsonLdValueType, graph: GraphTermType): void => {
    abort(options.signal)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, graph)
      return
    }

    if (!object(value) || valueObject(value) || listObject(value)) return

    const identifier = typeof value['@id'] === 'string' ? value['@id'] : `_:n${sequence++}`
    if (!identifier.startsWith('_:') && !absolute(identifier)) return
    const subject = getSubject(identifier)

    for (
      const [property, raw] of Object.entries(value).sort(([left], [right]) => compare(left, right))
    ) {
      if (property === '@graph') {
        if (
          typeof value['@id'] === 'string' && !value['@id'].startsWith('_:') &&
          !absolute(value['@id'])
        ) continue
        const target = typeof value['@id'] === 'string' ? getGraph(value['@id']) : graph
        visit(raw, target)
        continue
      }

      if (property === '@included') {
        visit(raw, graph)
        continue
      }

      if (property === '@type') {
        for (const type of asArray(raw)) {
          if (typeof type === 'string' && (type.startsWith('_:') || absolute(type))) {
            addQuad(subject, RDF.type, getSubject(type), graph)
          }
        }
        continue
      }

      if (property === '@reverse' && object(raw)) {
        for (const [predicate, items] of Object.entries(raw)) {
          for (const item of asArray(items)) {
            const reverseSubject = getObject(item, graph)
            if (
              reverseSubject !== undefined && reverseSubject.termType !== 'Literal' &&
              reverseSubject.termType !== 'Quad'
            ) {
              addQuad(reverseSubject, predicate, subject, graph)
              if (object(item) && !valueObject(item) && !listObject(item)) visit(item, graph)
            }
          }
        }
        continue
      }

      if (property.startsWith('@')) continue
      if (property.startsWith('_:') && !options.produceGeneralizedRdf) continue

      for (const item of asArray(raw)) {
        const rdfObject = getObject(item, graph)
        if (rdfObject !== undefined) addQuad(subject, property, rdfObject, graph)
        if (object(item) && !valueObject(item) && !listObject(item)) visit(item, graph)
      }
    }
  }

  // Node-map generation assigns one identifier before references are converted.
  // Visiting an anonymous child independently would lose its parent edge.
  visit(flatten(rdfNodes(expanded)), defaultGraph())
  return output
}

/** Removes an explicitly unresolvable identifier before node-map blank allocation. */
function rdfNodes(value: JsonLdValueType): JsonLdValueType {
  if (Array.isArray(value)) return value.map(rdfNodes)
  if (!object(value) || valueObject(value)) return value
  if (Object.hasOwn(value, '@id') && value['@id'] === null) return null
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rdfNodes(item)]))
}

/**
 * Converts native RDF quads to expanded JSON-LD.
 *
 * Well-formed `rdf:first`/`rdf:rest` chains are reconstructed as JSON-LD
 * `@list` objects. Named graphs are represented with `@graph`. RDF 1.2 triple
 * terms are rejected because JSON-LD 1.1 does not define a lossless mapping
 * for them.
 */
export function fromRdf(
  source: Iterable<Quad>,
  options: FromRdfOptionsType = {},
): JsonLdValueType[] {
  const graphs = new Map<string, Map<string, Record<string, JsonLdValueType>>>()

  /** Returns or creates one expanded node in one graph. */
  const getNode = (graph: string, id: string) => {
    let map = graphs.get(graph)
    if (map === undefined) {
      map = new Map()
      graphs.set(graph, map)
    }

    let value = map.get(id)
    if (value === undefined) {
      value = { '@id': id }
      map.set(id, value)
    }
    return value
  }

  /** Converts an RDF subject or graph term to an expanded identifier. */
  const getId = (term: SubjectTermType | GraphTermType) => {
    if (term.termType === 'BlankNode') return `_:${term.value}`
    if (term.termType === 'DefaultGraph') return '@default'
    return term.value
  }

  /** Converts one RDF object term to expanded JSON-LD. */
  const getValue = (term: ObjectTermType): JsonLdValueType => {
    if (term.termType === 'NamedNode') return { '@id': term.value }
    if (term.termType === 'BlankNode') return { '@id': `_:${term.value}` }
    if (term.termType === 'Quad') {
      throw new TypeError('JSON-LD 1.1 does not define an RDF triple-term mapping.')
    }

    const datatype = term.datatype.value
    if (options.rdfDirection === 'i18n-datatype' && datatype.startsWith(I18N)) {
      const suffix = datatype.slice(I18N.length)
      const split = suffix.lastIndexOf('_')
      if (split >= 0) {
        const language = suffix.slice(0, split)
        const direction = suffix.slice(split + 1)
        if (direction !== 'ltr' && direction !== 'rtl') {
          throw new JsonLdError(
            'invalid base direction',
            'An i18n datatype has an invalid base direction.',
          )
        }
        if (language && !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/u.test(language)) {
          throw new JsonLdError(
            'invalid language-tagged string',
            'An i18n datatype has an invalid language tag.',
          )
        }
        const result: Record<string, JsonLdValueType> = {
          '@value': term.value,
          '@direction': direction,
        }
        if (language) result['@language'] = language.toLowerCase()
        return result
      }
    }

    if (datatype === RDF_JSON && options.processingMode !== 'json-ld-1.0') {
      try {
        return { '@value': JSON.parse(term.value) as JsonLdValueType, '@type': '@json' }
      } catch {
        throw new JsonLdError(
          'invalid JSON literal',
          'The rdf:JSON lexical value is not valid JSON.',
        )
      }
    }

    let value: JsonLdValueType = term.value
    if (options.useNativeTypes) {
      if (datatype === XSD.boolean && ['true', 'false', '1', '0'].includes(term.value)) {
        value = term.value === 'true' || term.value === '1'
      } else if (
        datatype === XSD.integer && /^[+-]?\d+$/u.test(term.value) &&
        Number.isFinite(Number(term.value))
      ) {
        value = Number(term.value)
      } else if (
        datatype === XSD.double && term.value.trim() !== '' && Number.isFinite(Number(term.value))
      ) {
        value = Number(term.value)
      }
    }

    const result: Record<string, JsonLdValueType> = { '@value': value }
    if (term.language) result['@language'] = term.language
    else if (datatype !== XSD.string && typeof value === 'string') result['@type'] = datatype
    return result
  }

  for (const statement of source) {
    abort(options.signal)
    const graphId = getId(statement.graph)
    const subjectId = getId(statement.subject)
    const record = getNode(graphId, subjectId)
    const predicate = statement.predicate.value

    if (predicate === RDF.type && !options.useRdfType && statement.object.termType !== 'Literal') {
      if (statement.object.termType === 'NamedNode') add(record, '@type', statement.object.value)
      else if (statement.object.termType === 'BlankNode') {
        add(record, '@type', `_:${statement.object.value}`)
      }
      continue
    }

    add(record, predicate, getValue(statement.object))
    if (statement.object.termType === 'BlankNode') getNode(graphId, `_:${statement.object.value}`)
  }

  const references = new Map<string, number>()
  for (const map of graphs.values()) {
    for (const node of map.values()) {
      for (const [property, raw] of Object.entries(node)) {
        if (property.startsWith('@')) continue
        for (const value of asArray(raw)) {
          if (object(value) && typeof value['@id'] === 'string') {
            references.set(value['@id'], (references.get(value['@id']) ?? 0) + 1)
          }
        }
      }
    }
  }
  if (options.rdfDirection === 'compound-literal') collapseDirections(graphs, references)

  for (const [graphId, map] of [...graphs]) {
    collapseLists(map, references, options.processingMode ?? 'json-ld-1.1')
    if (graphId === '@default') continue

    let defaultMap = graphs.get('@default')
    if (defaultMap === undefined) {
      defaultMap = new Map()
      graphs.set('@default', defaultMap)
    }

    let owner = defaultMap.get(graphId)
    if (owner === undefined) {
      owner = { '@id': graphId }
      defaultMap.set(graphId, owner)
    }
    owner['@graph'] = [...map.values()].filter((value) => Object.keys(value).length > 1).sort((
      left,
      right,
    ) => compare(String(left['@id']), String(right['@id'])))
  }

  return [...(graphs.get('@default')?.values() ?? [])]
    .filter((value) => Object.keys(value).length > 1)
    .sort((left, right) => compare(String(left['@id'] ?? ''), String(right['@id'] ?? '')))
}

/**
 * Reconstructs collections backwards from rdf:nil using single-reference cells.
 *
 * A cell with extra properties, multiple references, or a cycle remains an
 * ordinary RDF node. Only cells consumed by a valid list are removed.
 */
function collapseLists(
  map: Map<string, Record<string, JsonLdValueType>>,
  references: ReadonlyMap<string, number>,
  mode: ProcessingModeType,
) {
  interface UsageType {
    readonly node: Record<string, JsonLdValueType>
    readonly property: string
    readonly value: Record<string, JsonLdValueType>
  }
  const usages = new Map<string, UsageType[]>()
  for (const node of map.values()) {
    for (const [property, raw] of Object.entries(node)) {
      if (property.startsWith('@')) continue
      for (const value of asArray(raw)) {
        if (!object(value) || typeof value['@id'] !== 'string') continue
        const refs = usages.get(value['@id']) ?? []
        refs.push({ node, property, value })
        usages.set(value['@id'], refs)
      }
    }
  }
  for (const usage of usages.get(RDF.nil) ?? []) {
    let current = usage
    const list: JsonLdValueType[] = [], cells: string[] = []
    const seen = new Set<string>()
    while (current.property === RDF.rest) {
      const node = current.node, id = node['@id']
      if (typeof id !== 'string' || !id.startsWith('_:') || seen.has(id)) break
      const refs = usages.get(id) ?? [],
        first = asArray(node[RDF.first] ?? []),
        rest = asArray(node[RDF.rest] ?? [])
      const type = asArray(node['@type'] ?? [])
      if (
        refs.length !== 1 || references.get(id) !== 1 || first.length !== 1 || rest.length !== 1 ||
        Object.keys(node).some((key) => !['@id', '@type', RDF.first, RDF.rest].includes(key)) ||
        (type.length && (type.length !== 1 || type[0] !== `${RDF_NS}List`))
      ) break
      seen.add(id)
      cells.push(id)
      list.push(first[0]!)
      current = refs[0]!
    }
    if (mode === 'json-ld-1.0' && current.property === RDF.first && cells.length) {
      const id = cells.pop()!, node = map.get(id)!, value = asArray(node[RDF.rest]!)[0]
      if (!object(value)) continue
      list.pop()
      current = { node, property: RDF.rest, value }
    }
    delete current.value['@id']
    current.value['@list'] = list.reverse()
    for (const id of cells) map.delete(id)
  }
}

/**
 * Replaces JSON-LD compound-literal helper nodes with directional value
 * objects before ordinary list reconstruction.
 */
function collapseDirections(
  graphs: Map<string, Map<string, Record<string, JsonLdValueType>>>,
  references: ReadonlyMap<string, number>,
) {
  for (const map of graphs.values()) {
    const directions = new Map<string, JsonLdValueType>()

    for (const [id, node] of map) {
      if (!id.startsWith('_:') || references.get(id) !== 1) continue
      const values = asArray(node[RDF_VALUE] ?? [])
      const languages = asArray(node[RDF_LANGUAGE] ?? [])
      const directionsRaw = asArray(node[RDF_DIRECTION] ?? [])
      if (values.length !== 1 || directionsRaw.length !== 1) continue
      if (!valueObject(values[0]!) || !valueObject(directionsRaw[0]!)) continue

      const valueNode = values[0] as Record<string, JsonLdValueType>
      const directionNode = directionsRaw[0] as Record<string, JsonLdValueType>
      const lexical = valueNode['@value']
      const direction = directionNode['@value']
      if (typeof lexical !== 'string') continue
      if (direction !== 'ltr' && direction !== 'rtl') {
        throw new JsonLdError(
          'invalid base direction',
          'A compound literal has an invalid base direction.',
        )
      }

      const result: Record<string, JsonLdValueType> = { '@value': lexical, '@direction': direction }
      if (languages.length === 1 && valueObject(languages[0]!)) {
        const languageNode = languages[0] as Record<string, JsonLdValueType>
        const language = languageNode['@value']
        if (typeof language === 'string') {
          if (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/u.test(language)) {
            throw new JsonLdError(
              'invalid language-tagged string',
              'A compound literal language tag is invalid.',
            )
          }
          result['@language'] = language.toLowerCase()
        }
      }
      directions.set(id, result)
    }

    if (directions.size === 0) continue
    for (const node of map.values()) {
      for (const [property, raw] of Object.entries(node)) {
        if (
          property.startsWith('@') || property === RDF_VALUE || property === RDF_LANGUAGE ||
          property === RDF_DIRECTION
        ) {
          continue
        }
        node[property] = asArray(raw).map((item) => {
          if (!object(item) || typeof item['@id'] !== 'string') return item
          return directions.get(item['@id']) ?? item
        })
      }
    }
    for (const id of directions.keys()) map.delete(id)
  }
}

/** Serializes JSON literal keys lexicographically while retaining array order. */
function canonicalJson(value: JsonLdValueType): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (object(value)) {
    return `{${
      Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
        .join(',')
    }}`
  }
  return JSON.stringify(value)
}

/** Formats a JSON number using the canonical XSD double exponent spelling. */
function double(value: number): string {
  const [raw = '0', exponent = '0'] = value.toExponential(15).split('e')
  const mantissa = raw.replace(/(\d)0+$/u, '$1')
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${Number(exponent)}`
}

/** Adds one expanded value while preserving JSON-LD's array-valued property form. */
function add(target: Record<string, JsonLdValueType>, property: string, value: JsonLdValueType) {
  const current = target[property]
  if (current === undefined) target[property] = [value]
  else if (Array.isArray(current)) {
    if (!current.some((item) => JSON.stringify(item) === JSON.stringify(value))) current.push(value)
  } else target[property] = [current, value]
}

/** Returns a scalar or array JSON-LD value in array form. */
function asArray(value: JsonLdValueType): JsonLdValueType[] {
  return Array.isArray(value) ? value : [value]
}

/** Throws the caller's abort reason before additional conversion work starts. */
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
