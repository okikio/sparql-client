/** RDF dataset isomorphism oracle used by conformance tests. @module */

import { type Quad, type TermType } from '@okikio/rdf'

/** Compares datasets modulo blank-node labels, including blank nodes nested in RDF 1.2 triple terms. */
export function isomorphic(actual: readonly Quad[], expected: readonly Quad[]): boolean {
  if (actual.length !== expected.length) return false
  const left = blanks(actual)
  const right = blanks(expected)
  if (left.length !== right.length) return false
  if (left.length === 0) {
    return mappedKeys(actual, new Map()).join('\n') === mappedKeys(expected, new Map()).join('\n')
  }

  const colors = refine(actual, expected, left, right)
  if (!colors) return false
  const groups = partitions(left, right, colors.left, colors.right)
  if (!groups) return false

  const map = new Map<string, string>()
  const used = new Set<string>()
  const ambiguous: Array<{ left: string[]; right: string[] }> = []
  for (const group of groups) {
    if (group.left.length === 1) {
      map.set(group.left[0]!, group.right[0]!)
      used.add(group.right[0]!)
    } else {
      ambiguous.push(group)
    }
  }
  ambiguous.sort((a, b) => a.left.length - b.left.length)
  const target = new Set(mappedKeys(expected, new Map()))
  if (!compatible(actual, map, target)) return false
  return assignGroups(0, ambiguous, map, used, actual, target)
}

interface ColorsType {
  readonly left: ReadonlyMap<string, string>
  readonly right: ReadonlyMap<string, string>
}

/** Refines blank-node neighborhoods until both datasets reach a stable structural coloring. */
function refine(
  leftQuads: readonly Quad[],
  rightQuads: readonly Quad[],
  left: readonly string[],
  right: readonly string[],
): ColorsType | undefined {
  let leftColors = new Map(left.map((id) => [id, '0']))
  let rightColors = new Map(right.map((id) => [id, '0']))
  const rounds = Math.max(2, left.length + 1)
  for (let round = 0; round < rounds; round++) {
    const leftSignatures = new Map(left.map((id) => [id, signature(id, leftQuads, leftColors)]))
    const rightSignatures = new Map(right.map((id) => [id, signature(id, rightQuads, rightColors)]))
    const vocabulary = [...new Set([...leftSignatures.values(), ...rightSignatures.values()])]
      .sort()
    const palette = new Map(vocabulary.map((value, index) => [value, String(index)]))
    const nextLeft = new Map(left.map((id) => [id, palette.get(leftSignatures.get(id)!)!]))
    const nextRight = new Map(right.map((id) => [id, palette.get(rightSignatures.get(id)!)!]))
    if (!sameCounts(nextLeft, nextRight)) return undefined
    if (sameColors(leftColors, nextLeft) && sameColors(rightColors, nextRight)) {
      return { left: nextLeft, right: nextRight }
    }
    leftColors = nextLeft
    rightColors = nextRight
  }
  return { left: leftColors, right: rightColors }
}

function signature(
  id: string,
  quads: readonly Quad[],
  colors: ReadonlyMap<string, string>,
): string {
  const values: string[] = []
  for (const value of quads) {
    if (contains(value, id)) values.push(colorQuad(value, id, colors))
  }
  values.sort()
  return values.join('\n')
}

function colorQuad(value: Quad, self: string, colors: ReadonlyMap<string, string>): string {
  return `Q${colorTerm(value.subject, self, colors)}|${colorTerm(value.predicate, self, colors)}|${
    colorTerm(value.object, self, colors)
  }|${colorTerm(value.graph, self, colors)}`
}

function colorTerm(value: TermType, self: string, colors: ReadonlyMap<string, string>): string {
  if (value.termType === 'BlankNode') {
    return value.value === self ? 'B:SELF' : `B:${colors.get(value.value) ?? '?'}`
  }
  if (value.termType === 'NamedNode') return `N:${value.value}`
  if (value.termType === 'Variable') return `V:${value.value}`
  if (value.termType === 'DefaultGraph') return 'D:'
  if (value.termType === 'Literal') {
    return `L:${value.value}|${value.language.toLowerCase()}|${value.direction}|${value.datatype.value}`
  }
  return `T:${colorTerm(value.subject, self, colors)}|${colorTerm(value.predicate, self, colors)}|${
    colorTerm(value.object, self, colors)
  }`
}

function partitions(
  left: readonly string[],
  right: readonly string[],
  leftColors: ReadonlyMap<string, string>,
  rightColors: ReadonlyMap<string, string>,
): Array<{ left: string[]; right: string[] }> | undefined {
  const ids = [...new Set(left.map((id) => leftColors.get(id)!))].sort()
  const result: Array<{ left: string[]; right: string[] }> = []
  for (const color of ids) {
    const a = left.filter((id) => leftColors.get(id) === color).sort()
    const b = right.filter((id) => rightColors.get(id) === color).sort()
    if (a.length !== b.length) return undefined
    result.push({ left: a, right: b })
  }
  return result
}

function assignGroups(
  index: number,
  groups: readonly { left: readonly string[]; right: readonly string[] }[],
  map: Map<string, string>,
  used: Set<string>,
  quads: readonly Quad[],
  expected: ReadonlySet<string>,
): boolean {
  if (index === groups.length) return mappedKeys(quads, map).every((value) => expected.has(value))
  const group = groups[index]!
  return assignOne(
    0,
    group.left,
    group.right,
    map,
    used,
    quads,
    expected,
    () => assignGroups(index + 1, groups, map, used, quads, expected),
  )
}

function assignOne(
  index: number,
  left: readonly string[],
  right: readonly string[],
  map: Map<string, string>,
  used: Set<string>,
  quads: readonly Quad[],
  expected: ReadonlySet<string>,
  next: () => boolean,
): boolean {
  if (index === left.length) return next()
  const source = left[index]!
  for (const target of right) {
    if (used.has(target)) continue
    map.set(source, target)
    used.add(target)
    if (
      compatible(quads, map, expected) &&
      assignOne(index + 1, left, right, map, used, quads, expected, next)
    ) return true
    used.delete(target)
    map.delete(source)
  }
  return false
}

/** Rejects a partial mapping as soon as any fully-mapped quad is absent from the expected dataset. */
function compatible(
  quads: readonly Quad[],
  map: ReadonlyMap<string, string>,
  expected: ReadonlySet<string>,
): boolean {
  for (const value of quads) {
    const ids = new Set<string>()
    collect(value, ids)
    if ([...ids].every((id) => map.has(id)) && !expected.has(mapQuad(value, map))) return false
  }
  return true
}

function sameCounts(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  return JSON.stringify(count(left)) === JSON.stringify(count(right))
}

function count(values: ReadonlyMap<string, string>): Array<readonly [string, number]> {
  const result = new Map<string, number>()
  for (const color of values.values()) result.set(color, (result.get(color) ?? 0) + 1)
  return [...result].sort(([a], [b]) => a.localeCompare(b))
}

function sameColors(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (right.get(key) !== value) return false
  return true
}

function blanks(quads: readonly Quad[]): string[] {
  const result = new Set<string>()
  for (const value of quads) collect(value, result)
  return [...result].sort()
}

function contains(term: TermType, id: string): boolean {
  if (term.termType === 'BlankNode') return term.value === id
  return term.termType === 'Quad' &&
    (contains(term.subject, id) || contains(term.predicate, id) || contains(term.object, id) ||
      contains(term.graph, id))
}

function collect(term: TermType, result: Set<string>): void {
  if (term.termType === 'BlankNode') result.add(term.value)
  if (term.termType !== 'Quad') return
  collect(term.subject, result)
  collect(term.predicate, result)
  collect(term.object, result)
  collect(term.graph, result)
}

function mappedKeys(quads: readonly Quad[], map: ReadonlyMap<string, string>): string[] {
  return quads.map((value) => mapQuad(value, map)).sort()
}

function mapQuad(value: Quad, map: ReadonlyMap<string, string>): string {
  return `Q${mapTerm(value.subject, map)}|${mapTerm(value.predicate, map)}|${
    mapTerm(value.object, map)
  }|${mapTerm(value.graph, map)}`
}

function mapTerm(value: TermType, map: ReadonlyMap<string, string>): string {
  if (value.termType === 'BlankNode') return `B:${map.get(value.value) ?? value.value}`
  if (value.termType === 'NamedNode') return `N:${value.value}`
  if (value.termType === 'Variable') return `V:${value.value}`
  if (value.termType === 'DefaultGraph') return 'D:'
  if (value.termType === 'Literal') {
    return `L:${value.value}|${value.language.toLowerCase()}|${value.direction}|${value.datatype.value}`
  }
  return `T:${mapTerm(value.subject, map)}|${mapTerm(value.predicate, map)}|${
    mapTerm(value.object, map)
  }`
}
