/** Native JSON-LD 1.1 compaction. @module */
import {
  type ActiveContextType,
  compare,
  type ContextStateType,
  definition,
  expandIri,
  JsonLdError,
  object,
  process,
} from './context.ts'
import type { JsonLdValueType } from './types.ts'
/** Options applied during compaction. */
export interface CompactOptionsType {
  /** Whether compaction can replace single-value arrays with their sole value. */
  readonly compactArrays?: boolean
  /** Compact absolute identifiers relative to base. */ readonly compactToRelative?: boolean
  /** Deterministic key order. */ readonly ordered?: boolean
}
/** Compacts one expanded JSON-LD value using an active context. */
export async function compactValue(
  active: ActiveContextType,
  activeProperty: string | null,
  element: JsonLdValueType,
  state: ContextStateType,
  options: CompactOptionsType = {},
): Promise<JsonLdValueType> {
  if (element === null || scalar(element)) return element
  if (object(element) && Object.hasOwn(element, '@preserve')) {
    return {
      '@preserve': await compactValue(
        active,
        activeProperty,
        element['@preserve']!,
        state,
        options,
      ),
    }
  }
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
  if (object(element) && Object.hasOwn(element, '@list')) {
    const list = array(
      await compactValue(active, activeProperty, element['@list']!, state, options),
    )
    if (definition(active, activeProperty)?.container.includes('@list')) return list
    return {
      [compactIri(active, '@list', undefined, true, false, options)]: list,
      ...(element['@index'] === undefined
        ? {}
        : { [compactIri(active, '@index', undefined, true, false, options)]: element['@index'] }),
    }
  }
  if (valueObject(element) || (idObject(element) && Object.keys(element).length === 1)) {
    return compactScalar(active, activeProperty, element, options)
  }
  let context = active.previous ?? active
  const propertyScope = definition(active, activeProperty)
  if (propertyScope?.context !== undefined) {
    context = await process(
      context,
      propertyScope.context,
      state,
      propertyScope.base ?? context.base,
      true,
      false,
      true,
    )
  }
  const typeContext = context
  const node = element as Record<string, JsonLdValueType>
  for (
    const type of array(node['@type'] ?? []).filter((v): v is string => typeof v === 'string').sort(
      compare,
    )
  ) {
    const term = selectTerm(typeContext, type), def = term ? typeContext.terms.get(term) : undefined
    if (def?.context !== undefined) {
      context = await process(context, def.context, state, def.base ?? context.base, false)
    }
  }
  const result = Object.create(null) as Record<string, JsonLdValueType>
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
        compactIri(typeContext, v, undefined, true, false, options)
      )
      result[alias] = collapse(
        values,
        options.compactArrays ?? true,
        context.mode === 'json-ld-1.1' ? definition(context, alias)?.container ?? [] : [],
      )
      continue
    }
    if (property === '@reverse' && object(raw)) {
      const compacted = await compactValue(context, '@reverse', raw, state, options)
      if (object(compacted)) {
        for (const key of Object.keys(compacted)) {
          if (!context.terms.get(key)?.reverse) continue
          result[key] = compacted[key]!
          delete compacted[key]
        }
        if (Object.keys(compacted).length) {
          result[compactIri(context, '@reverse', undefined, true, false, options)] = compacted
        }
      }
      continue
    }
    if (property.startsWith('@')) {
      result[compactIri(context, property, raw, true, false, options)] = await compactValue(
        context,
        property === '@graph' && activeProperty === null
          ? '@graph'
          : property === '@graph'
          ? activeProperty
          : compactIri(context, property, undefined, true, false, options),
        raw,
        state,
        options,
      )
      continue
    }
    if (Array.isArray(raw) && !raw.length) {
      result[compactIri(context, property, raw, true, false, options)] = []
    }
    for (const item of array(raw)) {
      const key = compactIri(context, property, item, true, activeProperty === '@reverse', options),
        term = context.terms.get(key),
        container = term?.container ?? []
      let target = result
      if (term?.nest !== undefined) {
        if (term.nest !== '@nest' && context.terms.get(term.nest)?.id !== '@nest') {
          throw new JsonLdError(
            'invalid @nest value',
            'A compaction nest mapping must name @nest or its alias.',
          )
        }
        target = getMap(result, term.nest)
      }
      let scoped = context
      if (term?.context !== undefined) {
        scoped = await process(
          context,
          term.context,
          state,
          term.base ?? context.base,
          true,
          false,
          true,
        )
      }
      if (container.includes('@graph') && object(item) && Object.hasOwn(item, '@graph')) {
        if ((!container.includes('@id') && Object.hasOwn(item, '@id'))) {
          add(
            target,
            key,
            await compactValue(scoped, key, item, state, options),
            container,
            options.compactArrays ?? true,
          )
          continue
        }
        const contents = await compactValue(scoped, key, item['@graph']!, state, options)
        if (container.includes('@id') || container.includes('@index')) {
          const index = container.includes('@id')
            ? typeof item['@id'] === 'string'
              ? compactIri(context, item['@id'], undefined, false, false, options)
              : '@none'
            : typeof item['@index'] === 'string'
            ? item['@index']
            : '@none'
          addMap(
            getMap(target, key),
            index === '@none'
              ? compactIri(context, '@none', undefined, true, false, options)
              : index,
            contents,
            (options.compactArrays ?? true) && !container.includes('@set'),
          )
        } else {
          const values = array(contents),
            value = values.length > 1
              ? { [compactIri(context, '@included', undefined, true, false, options)]: values }
              : contents
          if (values.length === 1) {
            for (const child of values) {
              add(target, key, child, container, options.compactArrays ?? true)
            }
          } else add(target, key, value, container, options.compactArrays ?? true)
        }
        continue
      }
      if (object(item) && Array.isArray(item['@list'])) {
        const list = array(await compactValue(scoped, key, item['@list'], state, options))
        if (container.includes('@list')) {
          if (Object.hasOwn(target, key)) {
            throw new JsonLdError(
              'compaction to list of lists',
              'Compaction would merge two lists into one list container.',
            )
          }
          target[key] = list
          continue
        }
        add(
          target,
          key,
          {
            [compactIri(context, '@list', undefined, true, false, options)]: list,
            ...(item['@index'] === undefined ? {} : {
              [compactIri(context, '@index', undefined, true, false, options)]: item['@index']!,
            }),
          },
          container,
          options.compactArrays ?? true,
        )
        continue
      }
      if (container.includes('@language') && object(item) && Object.hasOwn(item, '@value')) {
        const map = getMap(target, key),
          lang = typeof item['@language'] === 'string'
            ? item['@language']
            : compactIri(context, '@none', undefined, true, false, options)
        addMap(
          map,
          lang,
          item['@value']!,
          (options.compactArrays ?? true) && !container.includes('@set'),
        )
        continue
      }
      if (
        (container.includes('@index') || container.includes('@id') ||
          container.includes('@type')) && object(item)
      ) {
        const map = getMap(target, key), copy = { ...item }
        let index = compactIri(context, '@none', undefined, true, false, options)
        if (container.includes('@id') && typeof copy['@id'] === 'string') {
          index = compactIri(context, copy['@id'], undefined, false, false, options)
          delete copy['@id']
        } else if (container.includes('@type') && array(copy['@type'] ?? []).length) {
          const [type, ...types] = array(copy['@type']!)
          if (typeof type === 'string') {
            index = compactIri(context, type, undefined, true, false, options)
          }
          const typeScope = context.terms.get(index)
          if (typeScope?.context !== undefined) {
            scoped = await process(
              context,
              typeScope.context,
              state,
              typeScope.base ?? context.base,
              true,
              false,
              true,
            )
          }
          if (types.length) copy['@type'] = types
          else delete copy['@type']
        } else if (container.includes('@index')) {
          if (term?.index !== undefined && term.index !== '@index') {
            const property = expandIri(context, term.index, { vocab: true }),
              indexes = property ? array(copy[property] ?? []) : []
            const [first, ...rest] = indexes
            const indexValue = first === undefined
              ? undefined
              : await compactValue(context, term.index, first, state, options)
            if (typeof indexValue === 'string') {
              index = indexValue
              if (property && rest.length) copy[property] = rest
              else if (property) delete copy[property]
            }
          } else {
            if (typeof copy['@index'] === 'string') index = copy['@index']
            delete copy['@index']
          }
        }
        addMap(
          map,
          index,
          await compactValue(
            scoped,
            term?.index !== undefined && term.index !== '@index' && index !== '@none' ? null : key,
            copy,
            state,
            options,
          ),
          (options.compactArrays ?? true) && !container.includes('@set'),
        )
        continue
      }
      add(
        target,
        key,
        await compactValue(scoped, key, item, state, options),
        container,
        options.compactArrays ?? true,
      )
    }
  }
  return result
}
/** Compacts one expanded IRI/keyword to the best active term or compact IRI. */
export function compactIri(
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
    if (
      !(def.compactPrefix ||
        active.mode === 'json-ld-1.0' && def.container.includes('@index') && !term.includes(':')) ||
      !def.id || !value.startsWith(def.id) || value === def.id
    ) continue
    const candidate = `${term}:${value.slice(def.id.length)}`
    if (vocab && active.terms.has(candidate)) {
      const mapped = active.terms.get(candidate)!
      if (
        mapped.id !== value ||
        item !== undefined &&
          (!object(item) || !Object.hasOwn(item, '@id') && mapped.type !== item['@type'])
      ) continue
    }
    if (
      !best || candidate.length < best.length ||
      (candidate.length === best.length && compare(candidate, best) < 0)
    ) best = candidate
  }
  if (best) return best
  if (!vocab && (options.compactToRelative ?? true) && active.base) {
    return relative(value, active.base) ?? value
  }
  if (
    active.mode !== 'json-ld-1.0' && /^[^:]+:/u.test(value) && !value.startsWith('_:') &&
    active.terms.get(value.split(':')[0]!)?.prefix
  ) {
    throw new JsonLdError(
      'IRI confused with prefix',
      `Absolute IRI '${value}' would be confused with an active compact IRI prefix.`,
    )
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
  const preserveIndex = Object.hasOwn(value, '@index') && !term?.container.includes('@index')
  if (value['@type'] === '@json' && term?.type === '@json') return raw
  if (!preserveIndex && typeof value['@type'] === 'string' && term?.type === value['@type']) {
    return raw
  }
  if (!preserveIndex && term?.type !== '@none' && !Object.hasOwn(value, '@type')) {
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
  if (preserveIndex) {
    result[compactIri(active, '@index', undefined, true, false, options)] = value['@index']!
  }
  return result
}
/** Ranks candidate terms for one expanded IRI. */ function candidates(
  active: ActiveContextType,
  iri: string,
  item: JsonLdValueType | undefined,
  reverse: boolean,
) {
  if (object(item) && Object.hasOwn(item, '@preserve')) item = item['@preserve']
  const result: {
    /** Candidate compact term being scored for one expanded IRI. */
    term: string
    /** Ordering score used to select the preferred compact term. */
    score: number
  }[] = []
  for (const [term, def] of active.terms) {
    if (def.id !== iri) continue
    if (def.reverse !== reverse && def.reverse) continue
    let score = reverse === def.reverse ? 20 : 0
    if (object(item)) {
      const list = Object.hasOwn(item, '@list') ? array(item['@list']!) : undefined
      const graph = Object.hasOwn(item, '@graph')
      if ((!list || Object.hasOwn(item, '@index')) && def.container.includes('@list')) continue
      if (!graph && def.container.includes('@graph')) continue
      const values = list ?? [item]
      if (def.type && def.type !== '@none') {
        if (
          !values.every((value) =>
            object(value) && (
              def.type === '@id' || def.type === '@vocab'
                ? !Object.hasOwn(value, '@value') && !Object.hasOwn(value, '@list')
                : value['@type'] === def.type
            )
          )
        ) continue
        score += 60
        if (typeof item['@id'] === 'string' && (def.type === '@id' || def.type === '@vocab')) {
          const hasTerm = selectTerm(active, item['@id']) !== undefined
          if ((def.type === '@vocab') === hasTerm) score += 10
        }
      } else if (def.language !== undefined || def.direction !== undefined) {
        if (
          !values.every((value) =>
            object(value) && Object.hasOwn(value, '@value') &&
            !Object.hasOwn(value, '@type') &&
            (def.container.includes('@language') ||
              (value['@language'] ?? null) ===
                (def.language !== undefined ? def.language : active.language ?? null)) &&
            (value['@direction'] ?? null) ===
              (def.direction !== undefined ? def.direction : active.direction ?? null)
          )
        ) continue
        score += 50
      } else if (
        values.every((value) =>
          object(value) && Object.hasOwn(value, '@value') &&
          !Object.hasOwn(value, '@type') &&
          (value['@language'] ?? null) === (active.language ?? null) &&
          (value['@direction'] ?? null) === (active.direction ?? null)
        )
      ) score += 30
      if (list && def.container.includes('@list') && !Object.hasOwn(item, '@index')) score += 200
      if (graph && def.container.includes('@graph')) score += 200
      if (def.container.includes('@language')) {
        if (
          !Object.hasOwn(item, '@value') || Object.hasOwn(item, '@type') ||
          Object.hasOwn(item, '@index')
        ) continue
        score += Object.hasOwn(item, '@language') ? 150 : 15
      }
      if (def.container.includes('@index') && Object.hasOwn(item, '@index')) score += 130
      if (def.container.includes('@index') && def.index !== undefined && def.index !== '@index') {
        score += 130
      }
      if (def.container.includes('@id') && !Object.hasOwn(item, '@value')) score += 120
      if (def.container.includes('@type') && !Object.hasOwn(item, '@value')) score += 110
      if (def.container.includes('@set')) score += 80
      if (def.type === '@none') score += 10
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
  if (object(value) && value['@preserve'] === '@null' && current !== undefined) return
  if (object(current) && current['@preserve'] === '@null') {
    result[property] = force && !Array.isArray(value) ? [value] : value
    return
  }
  if (current === undefined) result[property] = force && !Array.isArray(value) ? [value] : value
  else if (Array.isArray(current)) current.push(value)
  else result[property] = [current, value]
}
/** Gets/creates object-valued map property. */ function getMap(
  result: Record<string, JsonLdValueType>,
  property: string,
) {
  const current = result[property]
  if (object(current)) return current
  const map = Object.create(null) as Record<string, JsonLdValueType>
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
  if (current === undefined) map[key] = compactArrays || Array.isArray(value) ? value : [value]
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
/** Computes a relative IRI without changing RDF lexical identity. */
function relative(value: string, base: string): string | undefined {
  const pattern = /^([A-Za-z][A-Za-z0-9+.-]*:)(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/su
  const target = pattern.exec(value), source = pattern.exec(base)
  if (!target || !source || target[1] !== source[1] || target[2] !== source[2]) return undefined
  if (target[3] === source[3]) {
    if (target[4] !== source[4] && target[4] !== undefined) return `${target[4]}${target[5] ?? ''}`
    if (target[4] === source[4] && target[5] !== undefined) return target[5]
  }
  const from = source[3]!.split('/'), to = target[3]!.split('/')
  from.pop()
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  let path = `${'../'.repeat(from.filter(Boolean).length)}${to.join('/')}` || './'
  if (path.startsWith('@') || /^[^/]*:/u.test(path)) path = `./${path}`
  return `${path}${target[4] ?? ''}${target[5] ?? ''}`
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
