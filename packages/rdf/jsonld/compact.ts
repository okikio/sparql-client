/** Native JSON-LD 1.1 compaction. @module */
import {
  type ActiveContextType,
  compare,
  type ContextStateType,
  definition,
  object,
  process,
} from './context.ts'
import type { JsonLdValueType } from './types.ts'
/** Options applied during compaction. */ export interface CompactOptionsType {
  /** Whether compaction can replace single-value arrays with their sole value. */
  readonly compactArrays?: boolean
  /** Compact absolute identifiers relative to base. */ readonly compactToRelative?: boolean
  /** Deterministic key order. */ readonly ordered?: boolean
}
/** Compacts one expanded JSON-LD value using an active context. */ export async function compactValue(
  active: ActiveContextType,
  activeProperty: string | null,
  element: JsonLdValueType,
  state: ContextStateType,
  options: CompactOptionsType = {},
): Promise<JsonLdValueType> {
  if (element === null || scalar(element)) return element
  if (Array.isArray(element)) {
    const result: JsonLdValueType[] = []
    for (const item of element) {
      const value = await compactValue(active, activeProperty, item, state, options)
      if (value !== null) result.push(value)
    }
    const container = definition(active, activeProperty)?.container ?? []
    return (options.compactArrays ?? true) && result.length === 1 && activeProperty !== '@graph' &&
        activeProperty !== '@set' && !container.includes('@list') && !container.includes('@set')
      ? result[0]!
      : result
  }
  if (valueObject(element) || (idObject(element) && Object.keys(element).length === 1)) {
    return compactScalar(active, activeProperty, element, options)
  }
  let context = active
  const node = element as Record<string, JsonLdValueType>
  for (
    const type of array(node['@type'] ?? []).filter((v): v is string => typeof v === 'string').sort(
      compare,
    )
  ) {
    const term = selectTerm(context, type), def = term ? context.terms.get(term) : undefined
    if (def?.context !== undefined) {
      context = await process(context, def.context, state, def.base ?? context.base, false)
    }
  }
  const result: Record<string, JsonLdValueType> = {}
  let entries = Object.entries(node)
  if (options.ordered) entries = entries.sort(([a], [b]) => compare(a, b))
  for (const [property, raw] of entries) {
    if (property === '@id') {
      const alias = compactIri(context, '@id', undefined, true, false, options)
      if (typeof raw === 'string') {
        result[alias] = compactIri(context, raw, undefined, false, false, options)
      }
      continue
    }
    if (property === '@type') {
      const alias = compactIri(context, '@type', undefined, true, false, options)
      const values = array(raw).filter((v): v is string => typeof v === 'string').map((v) =>
        compactIri(context, v, undefined, true, false, options)
      )
      result[alias] = collapse(
        values,
        options.compactArrays ?? true,
        definition(context, alias)?.container ?? [],
      )
      continue
    }
    if (property === '@reverse' && object(raw)) {
      const compacted = await compactValue(context, '@reverse', raw, state, options)
      if (object(compacted)) {
        result[compactIri(context, '@reverse', undefined, true, false, options)] = compacted
      }
      continue
    }
    if (property.startsWith('@')) {
      result[compactIri(context, property, raw, true, false, options)] = await compactValue(
        context,
        activeProperty,
        raw,
        state,
        options,
      )
      continue
    }
    for (const item of array(raw)) {
      const key = compactIri(context, property, item, true, false, options),
        term = context.terms.get(key),
        container = term?.container ?? []
      let scoped = context
      if (term?.context !== undefined) {
        scoped = await process(context, term.context, state, term.base ?? context.base, true)
      }
      if (object(item) && Array.isArray(item['@list'])) {
        const list = await compactValue(scoped, key, item['@list'], state, options)
        add(
          result,
          key,
          container.includes('@list')
            ? list
            : { [compactIri(context, '@list', undefined, true, false, options)]: list },
          container,
          options.compactArrays ?? true,
        )
        continue
      }
      if (container.includes('@language') && object(item) && Object.hasOwn(item, '@value')) {
        const map = getMap(result, key),
          lang = typeof item['@language'] === 'string' ? item['@language'] : '@none'
        addMap(map, lang, compactScalar(scoped, key, item, options), options.compactArrays ?? true)
        continue
      }
      if (container.includes('@index') && object(item)) {
        const map = getMap(result, key),
          index = typeof item['@index'] === 'string' ? item['@index'] : '@none',
          copy = { ...item }
        delete copy['@index']
        addMap(
          map,
          index,
          await compactValue(scoped, key, copy, state, options),
          options.compactArrays ?? true,
        )
        continue
      }
      add(
        result,
        key,
        await compactValue(scoped, key, item, state, options),
        container,
        options.compactArrays ?? true,
      )
    }
  }
  return result
}
/** Compacts one expanded IRI/keyword to the best active term or compact IRI. */ export function compactIri(
  active: ActiveContextType,
  value: string,
  item: JsonLdValueType | undefined,
  vocab: boolean,
  reverse = false,
  options: CompactOptionsType = {},
): string {
  const direct = candidates(active, value, item, reverse)
  if (vocab && direct.length) return direct[0]!
  if (vocab && active.vocab && value.startsWith(active.vocab)) {
    const suffix = value.slice(active.vocab.length)
    if (suffix && !active.terms.has(suffix)) return suffix
  }
  let best: string | undefined
  for (const [term, def] of active.terms) {
    if (!def.prefix || !def.id || !value.startsWith(def.id) || value === def.id) continue
    const candidate = `${term}:${value.slice(def.id.length)}`
    if (
      !best || candidate.length < best.length ||
      (candidate.length === best.length && compare(candidate, best) < 0)
    ) best = candidate
  }
  if (best) return best
  if (!vocab && (options.compactToRelative ?? true) && active.base) {
    return relative(value, active.base) ?? value
  }
  return value
}
/** Compacts identifier/value object to scalar where definition permits it. */ function compactScalar(
  active: ActiveContextType,
  property: string | null,
  value: Readonly<Record<string, JsonLdValueType>>,
  options: CompactOptionsType,
): JsonLdValueType {
  const term = definition(active, property)
  if (typeof value['@id'] === 'string') {
    if (term?.type === '@id') {
      return compactIri(active, value['@id'], undefined, false, false, options)
    }
    if (term?.type === '@vocab') {
      return compactIri(active, value['@id'], undefined, true, false, options)
    }
    return {
      [compactIri(active, '@id', undefined, true, false, options)]: compactIri(
        active,
        value['@id'],
        undefined,
        false,
        false,
        options,
      ),
    }
  }
  const raw = value['@value'] ?? null
  if (value['@type'] === '@json' && term?.type === '@json') return raw
  if (typeof value['@type'] === 'string' && term?.type === value['@type']) return raw
  if (!Object.hasOwn(value, '@type')) {
    const language = typeof value['@language'] === 'string'
        ? value['@language'].toLowerCase()
        : null,
      direction = value['@direction'] === 'ltr' || value['@direction'] === 'rtl'
        ? value['@direction']
        : null,
      termLanguage = term?.language !== undefined
        ? term.language?.toLowerCase() ?? null
        : active.language?.toLowerCase() ?? null,
      termDirection = term?.direction !== undefined
        ? term.direction ?? null
        : active.direction ?? null
    if (typeof raw !== 'string' || (language === termLanguage && direction === termDirection)) {
      return raw
    }
  }
  const result: Record<string, JsonLdValueType> = {
    [compactIri(active, '@value', undefined, true, false, options)]: raw,
  }
  if (typeof value['@type'] === 'string') {
    result[compactIri(active, '@type', undefined, true, false, options)] = compactIri(
      active,
      value['@type'],
      undefined,
      true,
      false,
      options,
    )
  }
  if (typeof value['@language'] === 'string') {
    result[compactIri(active, '@language', undefined, true, false, options)] = value['@language']
  }
  if (value['@direction'] === 'ltr' || value['@direction'] === 'rtl') {
    result[compactIri(active, '@direction', undefined, true, false, options)] = value['@direction']
  }
  return result
}
/** Ranks candidate terms for one expanded IRI. */ function candidates(
  active: ActiveContextType,
  iri: string,
  item: JsonLdValueType | undefined,
  reverse: boolean,
) {
  const result: {
    /** Candidate compact term being scored for one expanded IRI. */
    term: string
    /** Ordering score used to select the preferred compact term. */
    score: number
  }[] = []
  for (const [term, def] of active.terms) {
    if (def.id !== iri) continue
    let score = reverse === def.reverse ? 20 : 0
    if (object(item)) {
      if (Object.hasOwn(item, '@list') && def.container.includes('@list')) score += 20
      if (typeof item['@id'] === 'string' && (def.type === '@id' || def.type === '@vocab')) {
        score += 12
      }
      if (typeof item['@type'] === 'string' && def.type === item['@type']) score += 14
      if (Object.hasOwn(item, '@value') && def.container.includes('@language')) score += 8
    }
    result.push({ term, score })
  }
  return result.sort((a, b) =>
    b.score - a.score || a.term.length - b.term.length || compare(a.term, b.term)
  ).map((v) => v.term)
}
/** Selects shortest mapped term. */ function selectTerm(active: ActiveContextType, iri: string) {
  return candidates(active, iri, undefined, false)[0]
}
/** Adds compacted property value respecting array containers. */ function add(
  result: Record<string, JsonLdValueType>,
  property: string,
  value: JsonLdValueType,
  container: readonly string[],
  compactArrays: boolean,
) {
  const force = !compactArrays || container.includes('@set'), current = result[property]
  if (current === undefined) result[property] = force ? [value] : value
  else if (Array.isArray(current)) current.push(value)
  else result[property] = [current, value]
}
/** Gets/creates object-valued map property. */ function getMap(
  result: Record<string, JsonLdValueType>,
  property: string,
) {
  const current = result[property]
  if (object(current)) return current
  const map: Record<string, JsonLdValueType> = {}
  result[property] = map
  return map
}
/** Adds map entry. */ function addMap(
  map: Record<string, JsonLdValueType>,
  key: string,
  value: JsonLdValueType,
  compactArrays: boolean,
) {
  const current = map[key]
  if (current === undefined) map[key] = compactArrays ? value : [value]
  else if (Array.isArray(current)) current.push(value)
  else map[key] = [current, value]
}
/** Collapses one array when allowed. */ function collapse(
  values: JsonLdValueType[],
  compactArrays: boolean,
  container: readonly string[],
): JsonLdValueType {
  return compactArrays && values.length === 1 && !container.includes('@set') ? values[0]! : values
}
/** Computes relative IRI when authority matches. */ function relative(
  value: string,
  base: string,
) {
  try {
    const target = new URL(value), source = new URL(base)
    if (target.origin !== source.origin) return undefined
    const from = source.pathname.split('/')
    from.pop()
    const to = target.pathname.split('/')
    while (from[0] === to[0]) {
      from.shift()
      to.shift()
    }
    return `${'../'.repeat(from.filter(Boolean).length)}${
      to.join('/')
    }${target.search}${target.hash}` || './'
  } catch {
    return undefined
  }
}
/** Returns scalar/array as array. */ function array(value: JsonLdValueType): JsonLdValueType[] {
  return Array.isArray(value) ? value : [value]
}
/** Tests scalar. */ function scalar(value: JsonLdValueType): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
/** Tests value object. */ function valueObject(
  value: JsonLdValueType,
): value is Record<string, JsonLdValueType> {
  return object(value) && Object.hasOwn(value, '@value')
}
/** Tests identifier object. */ function idObject(
  value: JsonLdValueType,
): value is Record<string, JsonLdValueType> {
  return object(value) && typeof value['@id'] === 'string'
}
