/** JSON-LD result comparison rules used by the W3C API and framing suites. @module */

interface BlankMapType {
  readonly forward: Map<string, string>
  readonly reverse: Map<string, string>
}

/** Compares JSON-LD results using unordered arrays except `@list`, case-insensitive language tags, and blank-node relabeling. */
export function matchJson(
  actual: unknown,
  expected: unknown,
  ordered: boolean,
  map: BlankMapType = { forward: new Map(), reverse: new Map() },
  key?: string,
  literal = false,
): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    if (!literal && key === '@language') return actual.toLowerCase() === expected.toLowerCase()
    if (
      !literal && (key === '@id' || key === '@type') && actual.startsWith('_:') &&
      expected.startsWith('_:')
    ) return blank(actual, expected, map)
    return actual === expected
  }
  if (
    actual === null || expected === null || typeof actual !== 'object' ||
    typeof expected !== 'object'
  ) return Object.is(actual, expected)
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      return false
    }
    if (ordered || literal || key === '@list') {
      return actual.every((value, index) =>
        matchJson(value, expected[index], ordered, map, key, literal)
      )
    }
    return unordered(actual, expected, ordered, map, key)
  }
  const left = actual as Record<string, unknown>
  const right = expected as Record<string, unknown>
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (
    !literal &&
    (leftKeys.some((name) => name.startsWith('_:')) ||
      rightKeys.some((name) => name.startsWith('_:')))
  ) {
    const leftBlank = leftKeys.filter((name) => name.startsWith('_:')),
      rightBlank = rightKeys.filter((name) => name.startsWith('_:'))
    const leftNamed = leftKeys.filter((name) => !name.startsWith('_:')),
      rightNamed = rightKeys.filter((name) => !name.startsWith('_:'))
    if (leftBlank.length !== rightBlank.length || leftNamed.join('\0') !== rightNamed.join('\0')) {
      return false
    }
    if (
      !leftNamed.every((name) =>
        matchJson(
          left[name],
          right[name],
          ordered,
          map,
          name,
          name === '@context' || (name === '@value' && left['@type'] === '@json'),
        )
      )
    ) return false
    return fitKeys(0, leftBlank, rightBlank, left, right, ordered, map, new Set())
  }
  if (leftKeys.join('\0') !== rightKeys.join('\0')) return false
  return leftKeys.every((name) =>
    matchJson(
      left[name],
      right[name],
      ordered,
      map,
      name,
      literal || name === '@context' || (name === '@value' && left['@type'] === '@json'),
    )
  )
}

/** Matches generalized blank property names using the same node bijection as references. */
function fitKeys(
  index: number,
  leftKeys: readonly string[],
  rightKeys: readonly string[],
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  ordered: boolean,
  map: BlankMapType,
  used: Set<number>,
): boolean {
  if (index === leftKeys.length) return true
  for (let target = 0; target < rightKeys.length; target++) {
    if (used.has(target)) continue
    const next = clone(map), a = leftKeys[index]!, b = rightKeys[target]!
    if (!blank(a, b, next) || !matchJson(left[a], right[b], ordered, next, a)) continue
    used.add(target)
    if (fitKeys(index + 1, leftKeys, rightKeys, left, right, ordered, next, used)) {
      copy(next, map)
      return true
    }
    used.delete(target)
  }
  return false
}

function unordered(
  actual: readonly unknown[],
  expected: readonly unknown[],
  ordered: boolean,
  map: BlankMapType,
  key?: string,
): boolean {
  const used = new Set<number>()
  return fit(0, actual, expected, ordered, map, used, key)
}

function fit(
  index: number,
  actual: readonly unknown[],
  expected: readonly unknown[],
  ordered: boolean,
  map: BlankMapType,
  used: Set<number>,
  key?: string,
): boolean {
  if (index === actual.length) return true
  for (let target = 0; target < expected.length; target++) {
    if (used.has(target)) continue
    const next = clone(map)
    if (!matchJson(actual[index], expected[target], ordered, next, key)) continue
    used.add(target)
    if (fit(index + 1, actual, expected, ordered, next, used, key)) {
      copy(next, map)
      return true
    }
    used.delete(target)
  }
  return false
}

function blank(actual: string, expected: string, map: BlankMapType): boolean {
  const mapped = map.forward.get(actual)
  if (mapped !== undefined) return mapped === expected
  if (map.reverse.has(expected)) return false
  map.forward.set(actual, expected)
  map.reverse.set(expected, actual)
  return true
}

function clone(map: BlankMapType): BlankMapType {
  return { forward: new Map(map.forward), reverse: new Map(map.reverse) }
}
function copy(from: BlankMapType, to: BlankMapType): void {
  to.forward.clear()
  to.reverse.clear()
  for (const [key, value] of from.forward) to.forward.set(key, value)
  for (const [key, value] of from.reverse) to.reverse.set(key, value)
}
