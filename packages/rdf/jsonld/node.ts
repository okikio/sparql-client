/** JSON-LD node-map generation and flattening. @module */
import { compare, object } from './context.ts'
import { array, listObject, valueObject } from './expand.ts'
import type { JsonLdValueType } from './types.ts'
/** Expanded node object stored in a graph map. */ export type NodeType = Record<
  string,
  JsonLdValueType
>
/** Graph keyed by expanded node identifier. */ export type GraphType = Map<string, NodeType>
/** Node map keyed by graph identifier. */ export type NodeMapType = Map<string, GraphType>
/** Deterministic blank-node issuer. */ export class Issuer {
  /** Blank-node identifier map owned by this issuer. */
  readonly ids = new Map<string, string>()
  /** Next numeric suffix allocated by this issuer. */
  #next = 0
  /** Gets or allocates a _:b identifier. */ issue(existing?: string) {
    if (existing) {
      const found = this.ids.get(existing)
      if (found) return found
    }
    const value = `_:b${this.#next++}`
    if (existing) this.ids.set(existing, value)
    return value
  }
}
/** Creates a complete node map from expanded JSON-LD. */ export function create(
  expanded: JsonLdValueType,
  issuer = new Issuer(),
): NodeMapType {
  const maps: NodeMapType = new Map([['@default', new Map()]])
  visit(expanded, maps, '@default', undefined, undefined, issuer)
  return maps
}
/** Flattens expanded JSON-LD into a deterministic top-level node list. */ export function flatten(
  expanded: JsonLdValueType,
): JsonLdValueType[] {
  const maps = create(expanded), defaultGraph = maps.get('@default')!
  for (const [graph, nodes] of maps) {
    if (graph === '@default') continue
    let owner = defaultGraph.get(graph)
    if (!owner) {
      owner = { '@id': graph }
      defaultGraph.set(graph, owner)
    }
    owner['@graph'] = [...nodes.values()].filter((v) => !identifierOnly(v)).sort(byId)
  }
  return [...defaultGraph.values()].filter((v) => !identifierOnly(v)).sort(byId)
}
/** Recursively creates/reuses nodes and relationships. */ function visit(
  value: JsonLdValueType,
  maps: NodeMapType,
  graph: string,
  activeSubject: string | undefined,
  activeProperty: string | undefined,
  issuer: Issuer,
  list?: JsonLdValueType[],
): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, maps, graph, activeSubject, activeProperty, issuer, list)
    return
  }
  if (!object(value)) return
  if (valueObject(value)) {
    if (list) list.push(value)
    else if (activeSubject && activeProperty) {
      addNode(maps, graph, activeSubject, activeProperty, value)
    }
    return
  }
  if (listObject(value)) {
    const output: JsonLdValueType[] = []
    for (const item of array(value['@list'] ?? [])) {
      visit(item, maps, graph, activeSubject, activeProperty, issuer, output)
    }
    const obj: {
      /** Allows additional keyed values required by obj. */
      [key: string]: JsonLdValueType
    } = { '@list': output }
    if (typeof value['@index'] === 'string') obj['@index'] = value['@index']
    if (list) list.push(obj)
    else if (activeSubject && activeProperty) {
      addNode(maps, graph, activeSubject, activeProperty, obj)
    }
    return
  }
  let id = typeof value['@id'] === 'string' ? value['@id'] : issuer.issue()
  if (id.startsWith('_:')) id = issuer.issue(id)
  const node = getNode(maps, graph, id)
  for (const [property, raw] of Object.entries(value).sort(([a], [b]) => compare(a, b))) {
    if (property === '@id') continue
    if (property === '@type') {
      for (let type of array(raw)) {
        if (typeof type !== 'string') continue
        if (type.startsWith('_:')) type = issuer.issue(type)
        add(node, '@type', type)
      }
      continue
    }
    if (property === '@index') {
      if (!Object.hasOwn(node, '@index')) node['@index'] = raw
      continue
    }
    if (property === '@reverse' && object(raw)) {
      for (const [reverseProperty, items] of Object.entries(raw)) {
        for (const item of array(items)) {
          const reverseId = visit(item, maps, graph, undefined, undefined, issuer)
          if (reverseId) addNode(maps, graph, reverseId, reverseProperty, { '@id': id })
        }
      }
      continue
    }
    if (property === '@graph') {
      visit(raw, maps, id, undefined, undefined, issuer)
      continue
    }
    if (property === '@included') {
      visit(raw, maps, graph, undefined, undefined, issuer)
      continue
    }
    if (property.startsWith('@')) {
      node[property] = raw
      continue
    }
    for (const item of array(raw)) {
      if (valueObject(item) || listObject(item)) visit(item, maps, graph, id, property, issuer)
      else {
        const objectId = visit(item, maps, graph, undefined, undefined, issuer)
        if (objectId) add(node, property, { '@id': objectId })
      }
    }
  }
  if (activeSubject && activeProperty) {
    addNode(maps, graph, activeSubject, activeProperty, { '@id': id })
  }
  if (list) list.push({ '@id': id })
  return id
}
/** Gets/creates one graph node. */ function getNode(
  maps: NodeMapType,
  graph: string,
  id: string,
): NodeType {
  let nodes = maps.get(graph)
  if (!nodes) {
    nodes = new Map()
    maps.set(graph, nodes)
  }
  let node = nodes.get(id)
  if (!node) {
    node = { '@id': id }
    nodes.set(id, node)
  }
  return node
}
/** Adds one node property value preserving arrays and duplicate suppression. */ function add(
  node: NodeType,
  property: string,
  value: JsonLdValueType,
) {
  const current = node[property]
  if (current === undefined) node[property] = [value]
  else if (
    Array.isArray(current) && !current.some((v) => JSON.stringify(v) === JSON.stringify(value))
  ) current.push(value)
}
/** Adds one relationship to a graph node. */ function addNode(
  maps: NodeMapType,
  graph: string,
  id: string,
  property: string,
  value: JsonLdValueType,
) {
  add(getNode(maps, graph, id), property, value)
}
/** Tests whether a flattened node contains only its identifier. */ function identifierOnly(
  node: NodeType,
) {
  return Object.keys(node).length === 1 && typeof node['@id'] === 'string'
}
/** Sorts flattened nodes by identifier. */ function byId(a: NodeType, b: NodeType) {
  return compare(String(a['@id'] ?? ''), String(b['@id'] ?? ''))
}
