/** Native JSON-LD 1.1 expansion. @module */
import {
  abort,
  type ActiveContextType,
  compare,
  type ContextStateType,
  definition,
  expandIri,
  fail,
  FRAME_KEYWORDS,
  KEYWORDS,
  object,
  process,
  type TermDefinitionType,
} from './context.ts'
import type { JsonLdValueType } from './types.ts'
/** Options affecting recursive expansion. */ export interface ExpandOptionsType {
  /** Whether expansion retains framing-only forms that normal expansion removes. */
  readonly frame?: boolean
  /** Deterministic code-point key order. */ readonly ordered?: boolean
}
/** Expands one JSON-LD value under an active context. */
export async function expandValue(
  active: ActiveContextType,
  activeProperty: string | null,
  element: JsonLdValueType,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType = {},
  fromMap = false,
): Promise<JsonLdValueType> {
  abort(state.signal)
  if (element === null) return null
  const propertyDefinition = definition(active, activeProperty)
  if (scalar(element)) {
    if (activeProperty === null || activeProperty === '@graph') return null
    let context = active
    if (propertyDefinition?.context !== undefined) {
      context = await process(
        active,
        propertyDefinition.context,
        state,
        propertyDefinition.base ?? baseUrl,
      )
    }
    return valueExpansion(context, activeProperty, element)
  }
  if (Array.isArray(element)) {
    const result: JsonLdValueType[] = []
    for (const item of element) {
      let expanded = await expandValue(
        active,
        activeProperty,
        item,
        baseUrl,
        state,
        options,
        fromMap,
      )
      if (propertyDefinition?.container.includes('@list') && Array.isArray(expanded)) {
        expanded = { '@list': expanded }
      }
      append(result, expanded)
    }
    return result
  }
  let context = active
  if (
    context.previous && !fromMap && !hasExpandedKey(element, context, '@value') &&
    !onlyExpandedId(element, context)
  ) context = context.previous
  if (propertyDefinition?.context !== undefined) {
    context = await process(
      context,
      propertyDefinition.context,
      state,
      propertyDefinition.base ?? baseUrl,
    )
  }
  if (Object.hasOwn(element, '@context')) {
    context = await process(context, element['@context']!, state, baseUrl)
  }
  const typeEntries = Object.entries(element).filter(([key]) =>
    expandIri(context, key, { vocab: true }) === '@type'
  ).sort(([a], [b]) => compare(a, b))
  for (const [, raw] of typeEntries) {
    for (const term of array(raw).filter((v): v is string => typeof v === 'string').sort(compare)) {
      const scoped = definition(context, term)
      if (scoped?.context !== undefined) {
        context = await process(context, scoped.context, state, scoped.base ?? baseUrl, false)
      }
    }
  }
  const result: Record<string, JsonLdValueType> = {}, nests: string[] = []
  await entries(element, context, result, nests, activeProperty, baseUrl, state, options)
  for (let i = 0; i < nests.length; i++) {
    const key = nests[i]!
    for (const nested of array(element[key]!)) {
      if (!object(nested)) {
        fail('invalid @nest value', '@nest value must contain node-object entries.')
      }
      const more: string[] = []
      await entries(nested, context, result, more, activeProperty, baseUrl, state, options)
      nests.push(...more)
    }
  }
  return validate(result, activeProperty, options.frame ?? false)
}
/** Expands ordinary and keyword entries into an existing node object. */ async function entries(
  element: Readonly<Record<string, JsonLdValueType>>,
  active: ActiveContextType,
  result: Record<string, JsonLdValueType>,
  nests: string[],
  activeProperty: string | null,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType,
) {
  let values = Object.entries(element)
  if (options.ordered) values = values.sort(([a], [b]) => compare(a, b))
  for (const [key, value] of values) {
    abort(state.signal)
    if (key === '@context') continue
    const property = expandIri(active, key, { vocab: true })
    if (
      !property ||
      (!property.includes(':') && !KEYWORDS.has(property) && !FRAME_KEYWORDS.has(property))
    ) continue
    if (KEYWORDS.has(property) || (options.frame && FRAME_KEYWORDS.has(property))) {
      await keyword(
        key,
        property,
        value,
        active,
        result,
        nests,
        activeProperty,
        baseUrl,
        state,
        options,
      )
      continue
    }
    const term = definition(active, key), container = term?.container ?? []
    let expanded: JsonLdValueType
    if (term?.type === '@json') expanded = { '@value': value, '@type': '@json' }
    else if (container.includes('@language') && object(value)) {
      expanded = languageMap(value, active, term, options.ordered)
    } else if (
      (container.includes('@index') || container.includes('@id') || container.includes('@type')) &&
      object(value)
    ) expanded = await mapValue(value, key, active, term, baseUrl, state, options)
    else expanded = await expandValue(active, key, value, baseUrl, state, options)
    if (expanded === null) continue
    if (container.includes('@list') && !listObject(expanded)) {
      expanded = { '@list': array(expanded) }
    }
    if (term?.reverse) {
      const reverse = (object(result['@reverse']) ? result['@reverse'] : {}) as Record<
        string,
        JsonLdValueType
      >
      result['@reverse'] = reverse
      for (const item of array(expanded)) {
        if (valueObject(item) || listObject(item)) {
          fail(
            'invalid reverse property value',
            `Reverse property '${key}' cannot contain value/list objects.`,
          )
        }
        add(reverse, property, item)
      }
    } else for (const item of array(expanded)) add(result, property, item)
  }
}
/** Expands one JSON-LD keyword/alias. */ async function keyword(
  sourceKey: string,
  expanded: string,
  value: JsonLdValueType,
  active: ActiveContextType,
  result: Record<string, JsonLdValueType>,
  nests: string[],
  activeProperty: string | null,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType,
) {
  if (Object.hasOwn(result, expanded) && expanded !== '@type' && expanded !== '@included') {
    fail('colliding keywords', `Multiple aliases for ${expanded}.`)
  }
  switch (expanded) {
    case '@id':
      if (typeof value !== 'string') fail('invalid @id value', '@id must be string.')
      result['@id'] = expandIri(active, value, { documentRelative: true }) ?? value
      return
    case '@type': {
      const output: JsonLdValueType[] = []
      for (const item of array(value)) {
        if (typeof item === 'string') {
          output.push(expandIri(active, item, { documentRelative: true, vocab: true }) ?? item)
        } else if (options.frame && object(item) && !Object.keys(item).length) output.push({})
        else fail('invalid type value', '@type must be string or strings.')
      }
      result['@type'] = [...array(result['@type'] ?? []), ...output]
      return
    }
    case '@graph':
      result['@graph'] = array(await expandValue(active, '@graph', value, baseUrl, state, options))
        .filter((v) => v !== null)
      return
    case '@included':
      if (active.mode === 'json-ld-1.0') return
      result['@included'] = [
        ...array(result['@included'] ?? []),
        ...array(await expandValue(active, null, value, baseUrl, state, options)).filter((v) =>
          v !== null
        ),
      ]
      return
    case '@value':
      result['@value'] = value
      return
    case '@language':
      if (typeof value !== 'string') {
        fail('invalid language-tagged string', '@language must be string.')
      }
      result['@language'] = value.toLowerCase()
      return
    case '@direction':
      if (value !== 'ltr' && value !== 'rtl') {
        fail('invalid base direction', '@direction must be ltr or rtl.')
      }
      result['@direction'] = value
      return
    case '@index':
      if (typeof value !== 'string') fail('invalid @index value', '@index must be string.')
      result['@index'] = value
      return
    case '@list':
      if (activeProperty !== null && activeProperty !== '@graph') {
        result['@list'] = array(
          await expandValue(active, activeProperty, value, baseUrl, state, options),
        )
      }
      return
    case '@set':
      result['@set'] = await expandValue(active, activeProperty, value, baseUrl, state, options)
      return
    case '@reverse': {
      if (!object(value)) fail('invalid @reverse value', '@reverse must be object.')
      const converted = await expandValue(active, '@reverse', value, baseUrl, state, options)
      if (!object(converted)) return
      const reverse = (object(result['@reverse']) ? result['@reverse'] : {}) as Record<
        string,
        JsonLdValueType
      >
      for (const [property, items] of Object.entries(converted)) {
        if (property === '@reverse') {
          if (object(items)) {
            for (const [p, list] of Object.entries(items)) {
              for (const item of array(list)) add(result, p, item)
            }
          }
        } else {for (const item of array(items)) {
            if (valueObject(item) || listObject(item)) {
              fail('invalid reverse property value', '@reverse cannot contain value/list objects.')
            }
            add(reverse, property, item)
          }}
      }
      if (Object.keys(reverse).length) result['@reverse'] = reverse
      return
    }
    case '@nest':
      nests.push(sourceKey)
      return
    default:
      if (options.frame && FRAME_KEYWORDS.has(expanded)) result[expanded] = value
  }
}
/** Expands a language map. */ function languageMap(
  input: Readonly<Record<string, JsonLdValueType>>,
  active: ActiveContextType,
  term: TermDefinitionType | undefined,
  ordered = false,
): JsonLdValueType[] {
  let values = Object.entries(input)
  if (ordered) values = values.sort(([a], [b]) => compare(a, b))
  const result: JsonLdValueType[] = []
  const direction = term?.direction !== undefined ? term.direction : active.direction
  for (const [language, raw] of values) {
    for (const item of array(raw)) {
      if (item === null) continue
      if (typeof item !== 'string') {
        fail('invalid language map value', 'Language map values must be strings.')
      }
      const value: Record<string, JsonLdValueType> = { '@value': item }
      if (language !== '@none') {
        value['@language'] = language.toLowerCase()
      }
      if (direction) value['@direction'] = direction
      result.push(value)
    }
  }
  return result
}
/** Expands index/id/type maps. */ async function mapValue(
  input: Readonly<Record<string, JsonLdValueType>>,
  activeProperty: string,
  active: ActiveContextType,
  term: TermDefinitionType | undefined,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType,
) {
  let entries = Object.entries(input)
  if (options.ordered) entries = entries.sort(([a], [b]) => compare(a, b))
  const output: JsonLdValueType[] = [],
    container = term?.container ?? [],
    indexKey = term?.index ?? '@index'
  for (const [index, value] of entries) {
    const expanded = array(
      await expandValue(active, activeProperty, value, baseUrl, state, options, true),
    )
    for (const candidate of expanded) {
      if (!object(candidate)) {
        output.push(candidate)
        continue
      }
      const item = { ...candidate }
      if (container.includes('@index') && !Object.hasOwn(item, '@index')) {
        if (indexKey === '@index') {
          item['@index'] = index
        } else {
          const property = expandIri(active, indexKey, { vocab: true })
          if (property) add(item, property, valueExpansion(active, indexKey, index))
        }
      } else if (container.includes('@id') && !Object.hasOwn(item, '@id')) {
        item['@id'] = expandIri(active, index, { documentRelative: true }) ?? index
      } else if (container.includes('@type')) {
        item['@type'] = [
          expandIri(active, index, { vocab: true }) ?? index,
          ...array(item['@type'] ?? []),
        ]
      }
      output.push(item)
    }
  }
  return output
}
/** Expands one scalar according to the active property definition. */ export function valueExpansion(
  active: ActiveContextType,
  property: string,
  value: JsonLdValueType,
): JsonLdValueType {
  const term = active.terms.get(property)
  if (term?.type === '@id' && typeof value === 'string') {
    return { '@id': expandIri(active, value, { documentRelative: true }) ?? value }
  }
  if (term?.type === '@vocab' && typeof value === 'string') {
    return { '@id': expandIri(active, value, { documentRelative: true, vocab: true }) ?? value }
  }
  const result: Record<string, JsonLdValueType> = { '@value': value }
  if (term?.type && term.type !== '@none') result['@type'] = term.type
  else if (typeof value === 'string') {
    const language = term?.language !== undefined ? term.language : active.language,
      direction = term?.direction !== undefined ? term.direction : active.direction
    if (language) result['@language'] = language
    if (direction) result['@direction'] = direction
  }
  return result
}
/** Validates one expanded object and removes free-floating values. */ function validate(
  result: Record<string, JsonLdValueType>,
  activeProperty: string | null,
  frame: boolean,
): JsonLdValueType {
  if (Object.hasOwn(result, '@value')) {
    if (result['@value'] === null) return null
    if (Array.isArray(result['@type'])) {
      const types = result['@type']
      if (types.length !== 1 || typeof types[0] !== 'string') {
        fail('invalid typed value', 'A value object must contain exactly one string @type.')
      }
      result['@type'] = types[0]!
    }
    if (
      Object.hasOwn(result, '@type') &&
      (Object.hasOwn(result, '@language') || Object.hasOwn(result, '@direction'))
    ) fail('invalid value object', 'Value object cannot combine @type with @language/@direction.')
  }
  if (Object.hasOwn(result, '@set')) return result['@set'] ?? null
  if ((activeProperty === null || activeProperty === '@graph') && !frame) {
    const keys = Object.keys(result)
    if (!keys.length || (keys.length === 1 && ['@id', '@value', '@list'].includes(keys[0]!))) {
      return null
    }
  }
  return result
}
/** Adds one expanded value preserving array form. */ export function add(
  target: Record<string, JsonLdValueType>,
  property: string,
  value: JsonLdValueType,
) {
  const current = target[property]
  if (current === undefined) target[property] = [value]
  else if (Array.isArray(current)) current.push(value)
  else target[property] = [current, value]
}
/** Returns one value as array. */ export function array(
  value: JsonLdValueType,
): JsonLdValueType[] {
  return Array.isArray(value) ? value : [value]
}
/** Tests value object. */ export function valueObject(value: JsonLdValueType) {
  return object(value) && Object.hasOwn(value, '@value')
}
/** Tests list object. */ export function listObject(value: JsonLdValueType) {
  return object(value) && Object.hasOwn(value, '@list')
}
/** Tests node object. */ export function nodeObject(value: JsonLdValueType) {
  return object(value) && !valueObject(value) && !listObject(value)
}
/** Appends expanded output flattening arrays/null. */ function append(
  result: JsonLdValueType[],
  value: JsonLdValueType,
) {
  if (value === null) return
  if (Array.isArray(value)) result.push(...value.filter((v) => v !== null))
  else result.push(value)
}
/** Tests scalar JSON value. */ function scalar(
  value: JsonLdValueType,
): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
/** Tests if an input has a key expanding to keyword. */ function hasExpandedKey(
  element: Readonly<Record<string, JsonLdValueType>>,
  active: ActiveContextType,
  keyword: string,
) {
  return Object.keys(element).some((key) => expandIri(active, key, { vocab: true }) === keyword)
}
/** Tests non-propagation identifier-only special case. */ function onlyExpandedId(
  element: Readonly<Record<string, JsonLdValueType>>,
  active: ActiveContextType,
) {
  const keys = Object.keys(element)
  return keys.length === 1 && expandIri(active, keys[0]!, { vocab: true }) === '@id'
}
