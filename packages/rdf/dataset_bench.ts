/** Competitive exact-pattern benchmark for the project Dataset and N3 Store. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { Store as N3Store } from 'n3'
import { report } from '../../bench/report.ts'
import { Dataset } from './dataset.ts'
import { literal, namedNode, quad } from './factory.ts'
import type {
  GraphTermType,
  ObjectTermType,
  PredicateTermType,
  Quad,
  SubjectTermType,
} from './term.ts'

const SIZE = 100_000
const quads = Array.from({ length: SIZE }, (_, index) =>
  quad(
    namedNode(`https://example.com/s/${index % 10_000}`),
    namedNode(`https://example.com/p/${index % 16}`),
    literal(`value-${index % 1000}`),
    namedNode(`https://example.com/g/${index % 8}`),
  ))
const dataset = new Dataset(quads)
const n3 = new N3Store(quads)
const target = 1729
const subject = namedNode(`https://example.com/s/${target % 10_000}`)
const predicate = namedNode(`https://example.com/p/${target % 16}`)
const object = literal(`value-${target % 1000}`)
const graph = namedNode(`https://example.com/g/${target % 8}`)

interface PatternType {
  readonly name: string
  readonly subject?: SubjectTermType
  readonly predicate?: PredicateTermType
  readonly object?: ObjectTermType
  readonly graph?: GraphTermType
}
const patterns: readonly PatternType[] = [
  { name: 'subject', subject },
  { name: 'predicate', predicate },
  { name: 'object', object },
  { name: 'graph', graph },
  { name: 'subject+predicate', subject, predicate },
  { name: 'subject+predicate+graph', subject, predicate, graph },
  { name: 'exact quad', subject, predicate, object, graph },
]

for (const pattern of patterns) {
  const expected = scan(quads, pattern)
  const own = count(dataset.matchIter(pattern))
  const baseline = n3.getQuads(
    pattern.subject ?? null,
    pattern.predicate ?? null,
    pattern.object ?? null,
    pattern.graph ?? null,
  ).length
  if (own !== expected || baseline !== expected) {
    throw new Error(
      `${pattern.name} benchmark oracle differs: scan=${expected} own=${own} n3=${baseline}.`,
    )
  }
  group(`Dataset ${pattern.name}: ${SIZE.toLocaleString()} quads`, () => {
    bench('semantic scan', () => do_not_optimize(scan(quads, pattern)))
    bench('@okikio Dataset', () => do_not_optimize(count(dataset.matchIter(pattern))))
    bench(
      'N3 Store',
      () =>
        do_not_optimize(
          n3.getQuads(
            pattern.subject ?? null,
            pattern.predicate ?? null,
            pattern.object ?? null,
            pattern.graph ?? null,
          ).length,
        ),
    )
  })
}

group(`Dataset write cost: ${SIZE.toLocaleString()} quads`, () => {
  bench('@okikio Dataset construct', () => do_not_optimize(new Dataset(quads).size)).gc('inner')
  bench('N3 Store construct', () => do_not_optimize(new N3Store(quads).size)).gc('inner')
})

await report()

function scan(values: readonly Quad[], pattern: PatternType): number {
  let matches = 0
  for (const value of values) {
    if (pattern.subject && !value.subject.equals(pattern.subject)) continue
    if (pattern.predicate && !value.predicate.equals(pattern.predicate)) continue
    if (pattern.object && !value.object.equals(pattern.object)) continue
    if (pattern.graph && !value.graph.equals(pattern.graph)) continue
    matches++
  }
  return matches
}
function count(values: Iterable<Quad>): number {
  let size = 0
  for (const _ of values) size++
  return size
}
