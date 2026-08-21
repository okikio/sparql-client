/** Native JSON-LD 1.1 framing over expanded node maps. @module */
import { compare, object } from './context.ts'
import { array } from './expand.ts'
import { flatten } from './node.ts'
import type { EmbedType, JsonLdValueType } from './types.ts'
/** Options controlling native framing. */
export interface FrameOptionsType {
  /** Initial JSON-LD framing policy for embedding referenced nodes. */
  readonly embed?: EmbedType
  /** Include only explicitly framed properties. */ readonly explicit?: boolean
  /** Omit properties whose output would only be defaults. */ readonly omitDefault?: boolean
  /** Require all declared frame properties. */ readonly requireAll?: boolean
  /** Deterministic key ordering. */ readonly ordered?: boolean
}
/** Frames an expanded document against an expanded frame. */
export function frame(
  document: JsonLdValueType,
  frameValue: JsonLdValueType,
  options: FrameOptionsType = {},
): JsonLdValueType[] {
  const nodes = flatten(document).filter(object),
    byId = new Map<string, Record<string, JsonLdValueType>>()
  for (const node of nodes) if (typeof node['@id'] === 'string') byId.set(node['@id'], node)
  const frame = Array.isArray(frameValue) ? frameValue[0] : frameValue
  if (!object(frame)) return []
  const output: JsonLdValueType[] = []
  const embedded = new Set<string>()
  for (const node of nodes) {
    if (matches(node, frame, options.requireAll ?? bool(frame['@requireAll'], false))) {
      output.push(embed(node, frame, byId, embedded, options, new Set()))
    }
  }
  return output
}
/** Tests whether one node matches frame id/type/property patterns. */ function matches(
  node: Readonly<Record<string, JsonLdValueType>>,
  frame: Readonly<Record<string, JsonLdValueType>>,
  requireAll: boolean,
) {
  if (Object.hasOwn(frame, '@id')) {
    const wanted = array(frame['@id']!)
    if (!wanted.some((v) => object(v) && !Object.keys(v).length || v === node['@id'])) return false
  }
  if (Object.hasOwn(frame, '@type')) {
    const wanted = array(frame['@type']!), actual = array(node['@type'] ?? [])
    if (!wanted.some((v) => object(v) && !Object.keys(v).length || actual.includes(v))) return false
  }
  const props = Object.keys(frame).filter((k) => !k.startsWith('@'))
  if (requireAll && props.some((p) => !Object.hasOwn(node, p))) return false
  if (
    !requireAll && props.length && props.every((p) => {
      const value = frame[p]
      return !Object.hasOwn(node, p) && (value === undefined || defaultValue(value) === undefined)
    })
  ) return false
  return true
}
/** Recursively embeds references while preventing cycles and respecting embed policy. */ function embed(
  node: Record<string, JsonLdValueType>,
  frame: Record<string, JsonLdValueType>,
  byId: Map<string, Record<string, JsonLdValueType>>,
  embedded: Set<string>,
  options: FrameOptionsType,
  path: Set<string>,
): JsonLdValueType {
  const id = typeof node['@id'] === 'string' ? node['@id'] : undefined,
    mode = embedMode(frame['@embed'] ?? options.embed ?? '@once')
  if (id && mode === '@never') return { '@id': id }
  if (id && path.has(id)) return { '@id': id }
  if (id && mode === '@once' && embedded.has(id)) return { '@id': id }
  if (id) {
    embedded.add(id)
    path = new Set(path)
    path.add(id)
  }
  const explicit = bool(frame['@explicit'], options.explicit ?? false),
    omitDefault = bool(frame['@omitDefault'], options.omitDefault ?? false),
    result: Record<string, JsonLdValueType> = {}
  if (id) result['@id'] = id
  if (node['@type'] !== undefined) result['@type'] = node['@type']!
  let properties = explicit
    ? Object.keys(frame).filter((k) => !k.startsWith('@'))
    : Object.keys(node).filter((k) => !k.startsWith('@'))
  properties = [...new Set(properties)].sort(compare)
  for (const property of properties) {
    const subRaw = frame[property],
      sub = object(Array.isArray(subRaw) ? subRaw[0] : subRaw)
        ? (Array.isArray(subRaw) ? subRaw[0] : subRaw) as Record<string, JsonLdValueType>
        : {}
    const values = array(node[property] ?? [])
    if (!values.length) {
      if (!omitDefault && subRaw !== undefined) {
        const fallback = defaultValue(subRaw)
        if (fallback !== undefined) result[property] = [{ '@preserve': fallback }]
      }
      continue
    }
    result[property] = values.map((value) => {
      if (object(value) && typeof value['@id'] === 'string') {
        const target = byId.get(value['@id'])
        if (target) return embed(target, sub, byId, embedded, options, path)
      }
      return value
    })
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
): '@always' | '@once' | '@never' {
  if (value === true || value === '@always') return '@always'
  if (value === false || value === '@never') return '@never'
  return '@once'
}
/** Reads a boolean frame option with fallback. */ function bool(
  value: JsonLdValueType | undefined,
  fallback: boolean,
) {
  return typeof value === 'boolean' ? value : fallback
}
