/** Independent contracts for the declared compiler inheritance fixtures. @module */

/** Synthetic compiler workload, separate from an ontology inference profile. */
export interface WorkloadType {
  readonly classes: number
  readonly propertiesPerClass: number
  readonly shape: 'flat' | 'tree' | 'deep'
}

/** Counts the property references that the authored ancestry requires. */
export function references(value: WorkloadType): number {
  let total = 0
  for (let index = 0; index < value.classes; index++) {
    total += ancestors(index, value.shape).length * value.propertiesPerClass
  }
  return total
}

/**
 * Checks every class and property identity before generation or compiler timers.
 * Equal counts cannot hide a wrong inherited property, duplicate or omitted class.
 */
export function inspect(
  value: WorkloadType,
  actual: ReadonlyMap<string, readonly { readonly iri: string }[]>,
): number {
  if (actual.size !== value.classes) throw new Error('Compiler fixture class inventory differs.')
  for (let index = 0; index < value.classes; index++) {
    const expected = ancestors(index, value.shape).flatMap((ancestor) =>
      Array.from(
        { length: value.propertiesPerClass },
        (_, property) => `https://example.com/vocab/property${ancestor}_${property}`,
      )
    ).sort()
    const properties = actual.get(`https://example.com/vocab/Class${index}`)
    if (
      properties === undefined ||
      JSON.stringify(properties.map((property) => property.iri).sort()) !== JSON.stringify(expected)
    ) throw new Error('Compiler fixture inherited property identities differ.')
  }
  return references(value)
}

/** Parent arithmetic describes the fixture rather than reading the implementation's graph. */
function ancestors(index: number, shape: WorkloadType['shape']): number[] {
  const result = [index]
  if (shape === 'flat') return result
  while (index > 0) {
    index = shape === 'deep' ? index - 1 : Math.floor((index - 1) / 4)
    result.push(index)
  }
  return result
}
