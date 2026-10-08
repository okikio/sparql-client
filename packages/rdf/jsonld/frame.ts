/** Native JSON-LD 1.1 framing over expanded node maps. @module */
import { compare, JsonLdError, object } from './context.ts'
import { array } from './expand.ts'
import { create, type GraphType, type NodeMapType } from './node.ts'
import type { EmbedType, JsonLdValueType } from './types.ts'
/** Options controlling native framing. */
export interface FrameOptionsType {
  /** Initial JSON-LD framing policy for embedding referenced nodes. */
  readonly embed?: EmbedType
  /** Include only explicitly framed properties. */ readonly explicit?: boolean
  /** Omit properties whose output would only be defaults. */ readonly omitDefault?: boolean
  /** Require all declared frame properties. */ readonly requireAll?: boolean
  /** Restrict the starting graph to the default graph. */ readonly frameDefault?: boolean
  /** Use the legacy default embedding policy when requested. */ readonly processingMode?:
    | 'json-ld-1.0'
    | 'json-ld-1.1'
  /** Deterministic key ordering. */ readonly ordered?: boolean
}
/** Frames an expanded document against an expanded frame. */
export function frame(
  document: JsonLdValueType,
  frameValue: JsonLdValueType,
  options: FrameOptionsType = {},
): JsonLdValueType[] {
  const graphs = create(document)
  let frame = Array.isArray(frameValue) ? frameValue[0] : frameValue
  if (!object(frame)) return []
  const outerGraph = Object.hasOwn(frame, '@graph')
  if (
    outerGraph &&
    !Object.keys(frame).some((key) => !key.startsWith('@') || key === '@id' || key === '@type')
  ) {
    const nested = array(frame['@graph']!)[0]
    if (object(nested)) frame = nested
  }
  const merged: GraphType = new Map()
  for (const map of graphs.values()) {
    for (const [id, node] of map) {
      const current = merged.get(id) ?? { '@id': id }
      for (const [property, value] of Object.entries(node)) {
        if (property === '@id') continue
        const values = array(current[property] ?? [])
        for (const item of array(value)) {
          if (!values.some((other) => JSON.stringify(other) === JSON.stringify(item))) {
            values.push(item)
          }
        }
        current[property] = values
      }
      merged.set(id, current)
    }
  }
  graphs.set('@merged', merged)
  const graph = outerGraph || options.frameDefault ? '@default' : '@merged'
  const byId = graphs.get(graph)!
  const output: JsonLdValueType[] = []
  for (
    const node of [...byId.values()].sort((a, b) => compare(String(a['@id']), String(b['@id'])))
  ) {
    if (matches(node, frame, options.requireAll ?? bool(frame['@requireAll'], false), byId)) {
      output.push(embed(node, frame, byId, new Map(), options, new Set(), graphs, graph))
    }
  }
  return output
}
/** Tests whether one node matches frame id/type/property patterns. */ function matches(
  node: Readonly<Record<string, JsonLdValueType>>,
  frame: Readonly<Record<string, JsonLdValueType>>,
  requireAll: boolean,
  byId: ReadonlyMap<string, Record<string, JsonLdValueType>>,
) {
  if (Object.hasOwn(frame, '@id')) {
    const wanted = array(frame['@id']!)
    if (!wanted.some((v) => object(v) && !Object.keys(v).length || v === node['@id'])) return false
  }
  if (Object.hasOwn(frame, '@type')) {
    const wanted = array(frame['@type']!), actual = array(node['@type'] ?? [])
    if (
      !wanted.length ? actual.length > 0 : !wanted.some((v) =>
        object(v) &&
          (Object.hasOwn(v, '@default') || !Object.keys(v).length && actual.length > 0) ||
        actual.includes(v)
      )
    ) return false
  }
  const props = Object.keys(frame).filter((k) => !k.startsWith('@'))
  if (
    props.some((property) => !array(frame[property]!).length && array(node[property] ?? []).length)
  ) return false
  const propertyMatches = (property: string) => {
    const patterns = array(frame[property] ?? []), values = array(node[property] ?? [])
    if (!patterns.length) return !values.length
    if (!values.length) return defaultValue(frame[property]!) !== undefined
    return patterns.some((pattern) => values.some((value) => patternMatches(value, pattern, byId)))
  }
  if (requireAll && props.some((p) => !propertyMatches(p))) return false
  if (
    !requireAll && !Object.hasOwn(frame, '@id') && !Object.hasOwn(frame, '@type') && props.length &&
    props.every((p) => !propertyMatches(p))
  ) return false
  return true
}
/** Matches value/list patterns without discarding their language and type constraints. */
function patternMatches(
  value: JsonLdValueType,
  pattern: JsonLdValueType,
  byId: ReadonlyMap<string, Record<string, JsonLdValueType>>,
): boolean {
  if (!object(pattern)) return value === pattern
  if (!Object.keys(pattern).length) return true
  if (!object(value)) return false
  if (Object.hasOwn(pattern, '@list')) {
    if (!Object.hasOwn(value, '@list')) return false
    return array(pattern['@list']!).some((wanted) =>
      array(value['@list']!).some((item) => patternMatches(item, wanted, byId))
    )
  }
  if (Object.hasOwn(pattern, '@value')) {
    if (!Object.hasOwn(value, '@value')) return false
    return ['@value', '@type', '@language', '@direction'].every((key) => {
      if (!Object.hasOwn(pattern, key)) return key === '@value' || !Object.hasOwn(value, key)
      const wanted = array(pattern[key]!)
      if (!wanted.length) return !Object.hasOwn(value, key)
      return wanted.some((wanted) =>
        object(wanted) && !Object.keys(wanted).length || wanted === value[key]
      )
    })
  }
  const target = typeof value['@id'] === 'string' ? byId.get(value['@id']) ?? value : value
  return matches(target, pattern, bool(pattern['@requireAll'], false), byId)
}
/** Recursively embeds references while preventing cycles and respecting embed policy. */ function embed(
  node: Record<string, JsonLdValueType>,
  frame: Record<string, JsonLdValueType>,
  byId: Map<string, Record<string, JsonLdValueType>>,
  embedded: Map<string, Record<string, JsonLdValueType>>,
  options: FrameOptionsType,
  path: Set<string>,
  graphs: NodeMapType,
  graph: string,
): JsonLdValueType {
  const id = typeof node['@id'] === 'string' ? node['@id'] : undefined,
    scope = `${graph}\u0000${id ?? ''}`,
    mode = embedMode(
      frame['@embed'] ?? options.embed ??
        (options.processingMode === 'json-ld-1.0' ? '@last' : '@once'),
    )
  if (id && mode === '@never') return { '@id': id }
  if (id && path.has(scope)) return { '@id': id }
  if (id && mode === '@once' && embedded.has(scope)) return { '@id': id }
  if (id && mode === '@link' && embedded.has(scope)) return embedded.get(scope)!
  if (id && mode === '@last' && embedded.has(scope)) {
    const previous = embedded.get(scope)!
    for (const key of Object.keys(previous)) if (key !== '@id') delete previous[key]
  }
  if (id) {
    path = new Set(path)
    path.add(scope)
  }
  const explicit = bool(frame['@explicit'], options.explicit ?? false),
    omitDefault = bool(frame['@omitDefault'], options.omitDefault ?? false),
    result: Record<string, JsonLdValueType> = {}
  if (id) {
    result['@id'] = id
    embedded.set(scope, result)
  }
  if (node['@type'] !== undefined) result['@type'] = node['@type']!
  else if (Object.hasOwn(frame, '@type')) {
    const fallback = defaultValue(frame['@type']!)
    if (fallback !== undefined) result['@type'] = fallback
  }
  const nestedOptions = {
    ...options,
    embed: mode,
    explicit,
    omitDefault,
    requireAll: bool(frame['@requireAll'], options.requireAll ?? false),
  }
  if (Object.hasOwn(frame, '@included')) {
    const raw = array(frame['@included']!)[0], sub = object(raw) ? raw : {}
    result['@included'] = [...byId.values()].filter((candidate) =>
      matches(candidate, sub, bool(sub['@requireAll'], options.requireAll ?? false), byId)
    ).map((candidate) => embed(candidate, sub, byId, embedded, options, path, graphs, graph))
  }
  let properties = explicit
    ? Object.keys(frame).filter((k) => !k.startsWith('@'))
    : [...Object.keys(node), ...Object.keys(frame)].filter((k) => !k.startsWith('@'))
  properties = [...new Set(properties)].sort(compare)
  for (const property of properties) {
    const subRaw = frame[property],
      sub = object(Array.isArray(subRaw) ? subRaw[0] : subRaw)
        ? (Array.isArray(subRaw) ? subRaw[0] : subRaw) as Record<string, JsonLdValueType>
        : {}
    const values = array(node[property] ?? [])
    if (!values.length) {
      if (!bool(sub['@omitDefault'], omitDefault) && subRaw !== undefined) {
        const fallback = defaultValue(subRaw)
        result[property] = [{ '@preserve': fallback ?? '@null' }]
      }
      continue
    }
    result[property] = values.filter((value) =>
      !subRaw || !Object.keys(sub).length || patternMatches(value, sub, byId)
    ).map((value) => {
      if (object(value) && typeof value['@id'] === 'string') {
        const target = byId.get(value['@id'])
        if (target) return embed(target, sub, byId, embedded, nestedOptions, path, graphs, graph)
      }
      if (object(value) && Array.isArray(value['@list'])) {
        const pattern = array(sub['@list'] ?? [{}])[0], listFrame = object(pattern) ? pattern : {}
        return {
          ...value,
          '@list': value['@list'].filter((item) =>
            !object(item) || typeof item['@id'] !== 'string' ||
            patternMatches(item, listFrame, byId)
          ).map((item) => {
            if (!object(item) || typeof item['@id'] !== 'string') return item
            const target = byId.get(item['@id'])
            return target
              ? embed(target, listFrame, byId, embedded, nestedOptions, path, graphs, graph)
              : item
          }),
        }
      }
      return value
    })
  }
  if (id && graphs.has(id) && (graph !== '@merged' || Object.hasOwn(frame, '@graph'))) {
    const map = graphs.get(id)!,
      raw = array(frame['@graph'] ?? [{}])[0],
      sub = object(raw) ? raw : {}
    const contents: JsonLdValueType[] = []
    for (
      const child of [...map.values()].sort((a, b) => compare(String(a['@id']), String(b['@id'])))
    ) {
      if (embedded.has(`${id}\u0000${String(child['@id'])}`)) continue
      if (matches(child, sub, bool(sub['@requireAll'], options.requireAll ?? false), map)) {
        contents.push(embed(child, sub, map, embedded, nestedOptions, path, graphs, id))
      }
    }
    result['@graph'] = contents
  }
  if (object(frame['@reverse'])) {
    const reverse: Record<string, JsonLdValueType> = {}
    for (const [property, pattern] of Object.entries(frame['@reverse'])) {
      const sub = array(pattern)[0], nested = object(sub) ? sub : {}
      for (const candidate of byId.values()) {
        if (
          !array(candidate[property] ?? []).some((value) => object(value) && value['@id'] === id)
        ) continue
        if (
          !matches(
            candidate,
            nested,
            bool(nested['@requireAll'], options.requireAll ?? false),
            byId,
          )
        ) continue
        const values = array(reverse[property] ?? [])
        values.push(embed(candidate, nested, byId, embedded, options, path, graphs, graph))
        reverse[property] = values
      }
    }
    if (Object.keys(reverse).length) result['@reverse'] = reverse
  }
  if (object(node['@reverse'])) result['@reverse'] = node['@reverse']!
  return result
}
/** Reads @default from one frame property. */ function defaultValue(
  value: JsonLdValueType,
): JsonLdValueType | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return object(first) && Object.hasOwn(first, '@default') ? first['@default'] : undefined
}
/** Normalizes JSON-LD framing embed spellings. */ function embedMode(
  value: JsonLdValueType,
): '@always' | '@once' | '@never' | '@last' | '@link' {
  if (value === true || value === '@always') return '@always'
  if (value === false || value === '@never') return '@never'
  if (value === '@once' || value === '@last' || value === '@link') return value
  throw new JsonLdError('invalid @embed value', 'A frame embed option is not a supported policy.')
}
/** Reads a boolean frame option with fallback. */ function bool(
  value: JsonLdValueType | undefined,
  fallback: boolean,
) {
  return typeof value === 'boolean'
    ? value
    : value === 'true'
    ? true
    : value === 'false'
    ? false
    : fallback
}
