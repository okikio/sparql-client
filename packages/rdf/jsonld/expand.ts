/** Native JSON-LD 1.1 expansion. @module */
import {
  abort,
  absolute,
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

/** Default maximum number of nested `@nest` levels processed from untrusted input. */
const MAX_NEST_DEPTH = 128

/** Queued `@nest` value together with the depth at which its entries are interpreted. */
interface NestType {
  /** Actual nested JSON-LD value. Storing the value avoids looking it up on an unrelated outer object. */
  readonly value: JsonLdValueType
  /** One-based nesting depth used to enforce the configured work limit. */
  readonly depth: number
  /** Context applied by the term that names this nest entry. */
  readonly context: ActiveContextType
}

/** Options affecting recursive expansion. */
export interface ExpandOptionsType {
  /** Whether expansion retains framing-only forms that normal expansion removes. */
  readonly frame?: boolean
  /** Deterministic code-point key order. */ readonly ordered?: boolean
  /** Maximum accepted `@nest` depth before expansion stops. Defaults to 128. */
  readonly maxNestDepth?: number
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
        true,
        false,
        true,
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
      true,
      false,
      true,
    )
  }
  if (Object.hasOwn(element, '@context')) {
    context = await process(context, element['@context']!, state, baseUrl)
  }
  const typeContext = context
  const typeEntries = Object.entries(element).filter(([key]) =>
    expandIri(context, key, { vocab: true }) === '@type'
  ).sort(([a], [b]) => compare(a, b))
  for (const [, raw] of typeEntries) {
    for (const term of array(raw).filter((v): v is string => typeof v === 'string').sort(compare)) {
      const scoped = definition(typeContext, term)
      if (scoped?.context !== undefined) {
        context = await process(context, scoped.context, state, scoped.base ?? baseUrl, false)
      }
    }
  }
  const result = Object.create(null) as Record<string, JsonLdValueType>, nests: NestType[] = []
  await entries(
    element,
    context,
    result,
    nests,
    activeProperty,
    baseUrl,
    state,
    options,
    0,
    typeContext,
  )
  const maxNestDepth = options.maxNestDepth ?? MAX_NEST_DEPTH
  for (let i = 0; i < nests.length; i++) {
    const nest = nests[i]!
    if (nest.depth > maxNestDepth) {
      throw new RangeError(`JSON-LD @nest depth exceeds the configured limit of ${maxNestDepth}.`)
    }
    for (const nested of array(nest.value)) {
      if (!object(nested) || hasExpandedKey(nested, nest.context, '@value')) {
        fail('invalid @nest value', '@nest value must contain node-object entries.')
      }
      await entries(
        nested,
        nest.context,
        result,
        nests,
        activeProperty,
        baseUrl,
        state,
        options,
        nest.depth,
        typeContext,
      )
    }
  }
  return validate(result, activeProperty, options.frame ?? false)
}
/** Expands ordinary and keyword entries into an existing node object. */ async function entries(
  element: Readonly<Record<string, JsonLdValueType>>,
  active: ActiveContextType,
  result: Record<string, JsonLdValueType>,
  nests: NestType[],
  activeProperty: string | null,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType,
  nestDepth: number,
  typeContext: ActiveContextType,
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
      if (activeProperty === '@reverse') {
        fail('invalid reverse property map', 'A reverse property map cannot contain keywords.')
      }
      await keyword(
        property,
        value,
        active,
        result,
        nests,
        activeProperty,
        baseUrl,
        state,
        options,
        nestDepth,
        typeContext,
        key,
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
    if (
      active.mode === 'json-ld-1.0' && container.includes('@list') && listObject(expanded) &&
      object(expanded) && array(expanded['@list']!).some(listObject)
    ) {
      fail('list of lists', 'JSON-LD 1.0 cannot contain nested lists.')
    }
    if (
      container.includes('@graph') && !container.includes('@id') && !container.includes('@index')
    ) {
      expanded = array(expanded).map((item) => ({ '@graph': array(item) }))
    }
    if (term?.reverse) {
      const reverse =
        (object(result['@reverse']) ? result['@reverse'] : Object.create(null)) as Record<
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
    } else {
      // An explicitly empty property remains present in expanded JSON-LD.
      // Compaction and node-map generation distinguish it from an absent property.
      result[property] ??= []
      for (const item of array(expanded)) add(result, property, item)
    }
  }
}
/** Expands one JSON-LD keyword/alias. */ async function keyword(
  expanded: string,
  value: JsonLdValueType,
  active: ActiveContextType,
  result: Record<string, JsonLdValueType>,
  nests: NestType[],
  activeProperty: string | null,
  baseUrl: string | undefined,
  state: ContextStateType,
  options: ExpandOptionsType,
  nestDepth: number,
  typeContext: ActiveContextType,
  key: string,
) {
  if (Object.hasOwn(result, expanded) && expanded !== '@type' && expanded !== '@included') {
    fail('colliding keywords', `Multiple aliases for ${expanded}.`)
  }
  switch (expanded) {
    case '@id':
      if (options.frame) {
        result['@id'] = array(value).map((item) => {
          if (object(item) && !Object.keys(item).length) return {}
          if (typeof item !== 'string') {
            fail('invalid frame', 'A frame identifier must be an IRI or wildcard.')
          }
          const id = expandIri(active, item, { documentRelative: true })
          if (id === undefined || !absolute(id)) {
            fail('invalid frame', 'A frame identifier must be an absolute IRI.')
          }
          return id
        })
        return
      }
      if (typeof value !== 'string') fail('invalid @id value', '@id must be string.')
      {
        const id = expandIri(active, value, { documentRelative: true })
        result['@id'] = id ?? null
      }
      return
    case '@type': {
      const output: JsonLdValueType[] = []
      for (const item of array(value)) {
        if (typeof item === 'string') {
          const type = expandIri(typeContext, item, { documentRelative: true, vocab: true })
          if (options.frame && type !== '@json' && (type === undefined || !absolute(type))) {
            fail('invalid frame', 'A frame type must be an absolute IRI.')
          }
          if (type !== undefined) output.push(type)
        } else if (options.frame && object(item) && !Object.keys(item).length) output.push({})
        else if (options.frame && object(item) && Object.hasOwn(item, '@default')) {
          const fallback = array(item['@default']!).map((value) =>
            typeof value === 'string'
              ? expandIri(typeContext, value, { documentRelative: true, vocab: true }) ?? value
              : value
          )
          output.push({ '@default': fallback })
        } else fail('invalid type value', '@type must be string or strings.')
      }
      result['@type'] = [...array(result['@type'] ?? []), ...output]
      return
    }
    case '@graph':
      result['@graph'] = array(await expandValue(active, '@graph', value, baseUrl, state, options))
        .filter((v) => v !== null)
      return
    case '@included': {
      if (active.mode === 'json-ld-1.0') return
      const included = array(await expandValue(active, '@included', value, baseUrl, state, options))
        .filter((v) => v !== null)
      if (included.some((item) => !nodeObject(item))) {
        fail('invalid @included value', '@included only permits node objects.')
      }
      result['@included'] = [
        ...array(result['@included'] ?? []),
        ...included,
      ]
      return
    }
    case '@value':
      result['@value'] = value
      return
    case '@language':
      if (options.frame) {
        result['@language'] = array(value).map((item) =>
          typeof item === 'string' ? item.toLowerCase() : item
        )
        return
      }
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
        if (active.mode === 'json-ld-1.0' && array(result['@list']!).some(listObject)) {
          fail('list of lists', 'JSON-LD 1.0 cannot contain nested lists.')
        }
      }
      return
    case '@set':
      result['@set'] = await expandValue(active, activeProperty, value, baseUrl, state, options)
      return
    case '@reverse': {
      if (!object(value)) fail('invalid @reverse value', '@reverse must be object.')
      const converted = await expandValue(active, '@reverse', value, baseUrl, state, options)
      if (!object(converted)) return
      const reverse =
        (object(result['@reverse']) ? result['@reverse'] : Object.create(null)) as Record<
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
    case '@nest': {
      const scoped = definition(active, key)
      const context = scoped?.context === undefined
        ? active
        : await process(active, scoped.context, state, scoped.base ?? baseUrl, true, false, true)
      nests.push({ value, depth: nestDepth + 1, context })
      return
    }
    default:
      if (options.frame && FRAME_KEYWORDS.has(expanded)) {
        result[expanded] = expanded === '@default' && object(value) &&
            (Object.hasOwn(value, '@value') || Object.hasOwn(value, '@id'))
          ? await expandValue(active, activeProperty, value, baseUrl, state, {
            ...options,
            frame: false,
          })
          : value
      }
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
      if (expandIri(active, language, { vocab: true }) !== '@none') {
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
    let context = (container.includes('@id') || container.includes('@type'))
      ? active.previous ?? active
      : active
    const scoped = definition(context, index)
    if (container.includes('@type') && scoped?.context !== undefined) {
      context = await process(context, scoped.context, state, scoped.base ?? baseUrl)
    }
    const expanded = array(
      await expandValue(context, activeProperty, array(value), baseUrl, state, options, true),
    )
    for (const candidate of expanded) {
      if (!object(candidate)) {
        output.push(candidate)
        continue
      }
      const item = container.includes('@graph') && !Object.hasOwn(candidate, '@graph')
        ? { '@graph': [candidate] } as Record<string, JsonLdValueType>
        : { ...candidate }
      const none = expandIri(active, index, { vocab: true }) === '@none'
      if (none) {
        output.push(item)
        continue
      }
      if (container.includes('@index') && !Object.hasOwn(item, '@index')) {
        if (indexKey === '@index') {
          item['@index'] = index
        } else {
          const property = expandIri(active, indexKey, { vocab: true })
          if (property) {
            if (valueObject(item)) {
              fail(
                'invalid value object',
                'A custom index cannot add properties to a value object.',
              )
            }
            item[property] = [
              valueExpansion(active, indexKey, index),
              ...array(item[property] ?? []),
            ]
          }
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
/** Expands one scalar according to the active property definition. */
export function valueExpansion(
  active: ActiveContextType,
  property: string,
  value: JsonLdValueType,
): JsonLdValueType {
  const term = active.terms.get(property)
  if (term?.type === '@id' && typeof value === 'string') {
    const id = expandIri(active, value, { documentRelative: true })
    return id === undefined ? null : { '@id': id }
  }
  if (term?.type === '@vocab' && typeof value === 'string') {
    const id = expandIri(active, value, { documentRelative: true, vocab: true })
    return id === undefined ? null : { '@id': id }
  }
  const result: Record<string, JsonLdValueType> = { '@value': value }
  if (term?.type && !['@none', '@id', '@vocab'].includes(term.type)) result['@type'] = term.type
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
    if (!frame && Array.isArray(result['@type'])) {
      const types = result['@type']
      if (types.length !== 1 || typeof types[0] !== 'string') {
        fail('invalid typed value', 'A value object must contain exactly one string @type.')
      }
      result['@type'] = types[0]!
    }
    if (
      Object.keys(result).some((key) =>
        !['@value', '@type', '@language', '@direction', '@index'].includes(key)
      )
    ) {
      fail('invalid value object', 'A value object contains an unsupported property.')
    }
    if (
      !frame && Object.hasOwn(result, '@type') &&
      (Object.hasOwn(result, '@language') || Object.hasOwn(result, '@direction'))
    ) fail('invalid value object', 'Value object cannot combine @type with @language/@direction.')
    if (result['@type'] !== '@json' && !frame) {
      if (object(result['@value']) || Array.isArray(result['@value'])) {
        fail('invalid value object value', 'An object or array value requires @type @json.')
      }
      if (Object.hasOwn(result, '@language') && typeof result['@value'] !== 'string') {
        fail('invalid language-tagged value', 'A language-tagged value must be a string.')
      }
      const type = result['@type']
      if (typeof type === 'string' && (!absolute(type) || type.startsWith('_:'))) {
        fail('invalid typed value', 'A value datatype must be an absolute IRI.')
      }
      if (result['@value'] === null) return null
    }
  }
  if (Object.hasOwn(result, '@set') || Object.hasOwn(result, '@list')) {
    if (
      Object.keys(result).some((key) => !['@set', '@list', '@index'].includes(key)) ||
      (Object.hasOwn(result, '@set') && Object.hasOwn(result, '@list'))
    ) {
      fail(
        'invalid set or list object',
        'A set or list object only permits @index alongside its contents.',
      )
    }
    if (Object.hasOwn(result, '@set')) return result['@set'] ?? null
  }
  if (Object.keys(result).length === 1 && Object.hasOwn(result, '@language')) return null
  if ((activeProperty === null || activeProperty === '@graph') && !frame) {
    const keys = Object.keys(result)
    if (
      !keys.length || Object.hasOwn(result, '@value') || Object.hasOwn(result, '@list') ||
      (keys.length === 1 && keys[0] === '@id')
    ) {
      return null
    }
  }
  return result
}
/** Adds one expanded value preserving array form. */
export function add(
  target: Record<string, JsonLdValueType>,
  property: string,
  value: JsonLdValueType,
) {
  const current = target[property]
  if (current === undefined) target[property] = [value]
  else if (Array.isArray(current)) current.push(value)
  else target[property] = [current, value]
}
/** Returns one value as array. */
export function array(
  value: JsonLdValueType,
): JsonLdValueType[] {
  return Array.isArray(value) ? value : [value]
}
/** Tests value object. */
export function valueObject(value: JsonLdValueType): boolean {
  return object(value) && Object.hasOwn(value, '@value')
}
/** Tests list object. */
export function listObject(value: JsonLdValueType): boolean {
  return object(value) && Object.hasOwn(value, '@list')
}
/** Tests node object. */
export function nodeObject(value: JsonLdValueType): boolean {
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
