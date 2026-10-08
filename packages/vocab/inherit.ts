/** Iterative SCC condensation for finite ontology inheritance graphs. @module */
import type { PropertyType, VocabularyModelType } from './model.ts'
import { compare } from './order.ts'

/**
 * Resolves structural properties through an SCC DAG. Cyclic classes share the
 * same property set and never emit recursive interface heritage. This is a
 * generator projection, not RDF entailment. Cost includes the materialized
 * property sets that must also appear in generated output.
 */
export function inherit(
  model: VocabularyModelType,
  options: { readonly maxProperties?: number; readonly signal?: AbortSignal } = {},
): ReadonlyMap<string, readonly PropertyType[]> {
  const maxProperties = options.maxProperties ?? 1_000_000
  if (!Number.isSafeInteger(maxProperties) || maxProperties < 1) {
    throw new RangeError('maxProperties must be a positive safe integer.')
  }
  let references = 0
  const admit = (size: number) => {
    if (options.signal?.aborted) throw options.signal.reason
    if (references + size > maxProperties) {
      throw new RangeError(`Vocabulary inheritance exceeds maxProperties (${maxProperties}).`)
    }
  }
  const declared = new Set(model.classes.map((value) => value.iri))
  const graph = new Map(
    model.classes.map((
      value,
    ) => [value.iri, value.superClasses.filter((iri) => declared.has(iri))]),
  )
  const reverse = new Map([...graph.keys()].map((iri) => [iri, [] as string[]]))
  for (const [child, parents] of graph) {
    for (const parent of parents) reverse.get(parent)!.push(child)
  }
  const visited = new Set<string>(), order: string[] = []
  for (const iri of graph.keys()) {
    if (visited.has(iri)) continue
    visited.add(iri)
    const stack = [{ iri, index: 0 }]
    while (stack.length) {
      if (options.signal?.aborted) throw options.signal.reason
      const frame = stack.at(-1)!, next = graph.get(frame.iri)![frame.index++]
      if (next === undefined) {
        order.push(frame.iri)
        stack.pop()
      } else if (!visited.has(next)) {
        visited.add(next)
        stack.push({ iri: next, index: 0 })
      }
    }
  }
  const component = new Map<string, number>(), members: string[][] = []
  for (const iri of order.reverse()) {
    if (component.has(iri)) continue
    const index = members.length, values: string[] = [], stack = [iri]
    component.set(iri, index)
    while (stack.length) {
      if (options.signal?.aborted) throw options.signal.reason
      const current = stack.pop()!
      values.push(current)
      for (const child of reverse.get(current)!) {
        if (!component.has(child)) {
          component.set(child, index)
          stack.push(child)
        }
      }
    }
    members.push(values)
  }
  const parents = members.map(() => new Set<number>())
  for (const [child, supers] of graph) {
    for (const parent of supers) {
      if (component.get(child) !== component.get(parent)) {
        parents[component.get(child)!]!.add(component.get(parent)!)
      }
    }
  }
  const own = members.map(() => new Map<string, PropertyType>())
  for (const property of model.properties) {
    for (const domain of property.domains) {
      const index = component.get(domain)
      if (index !== undefined) own[index]!.set(property.iri, property)
    }
  }
  const resolved = new Map<number, readonly PropertyType[]>()
  for (let index = 0; index < members.length; index++) {
    const stack = [{ index, expanded: false }]
    while (stack.length) {
      if (options.signal?.aborted) throw options.signal.reason
      const frame = stack.pop()!
      if (resolved.has(frame.index)) continue
      if (!frame.expanded) {
        stack.push({ ...frame, expanded: true })
        for (const parent of parents[frame.index]!) {
          if (!resolved.has(parent)) stack.push({ index: parent, expanded: false })
        }
      } else {
        admit(own[frame.index]!.size)
        const properties = new Map(own[frame.index])
        for (const parent of parents[frame.index]!) {
          for (const property of resolved.get(parent)!) {
            if (!properties.has(property.iri)) admit(properties.size + 1)
            properties.set(property.iri, property)
          }
        }
        references += properties.size
        resolved.set(
          frame.index,
          [...properties.values()].sort((a, b) => compare(a.iri, b.iri)),
        )
      }
    }
  }
  return new Map([...component].map(([iri, index]) => [iri, resolved.get(index)!]))
}
