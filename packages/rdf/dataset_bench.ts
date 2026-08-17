/** Decision benchmark for exact-term dataset indexes. @module */

import { bench, do_not_optimize, group, run } from 'mitata'
import { Dataset } from './dataset.ts'
import { literal, namedNode, quad } from './factory.ts'
import type { Quad, Subject } from './term.ts'

const SIZE = 50_000
const SUBJECTS = 5_000
const predicate = namedNode('https://example.com/p')
const quads = Array.from({ length: SIZE }, (_, index) => quad(
  namedNode(`https://example.com/s/${index % SUBJECTS}`),
  predicate,
  literal(`value-${index}`),
))
const dataset = new Dataset(quads)
const target = namedNode('https://example.com/s/1729')
const expected = scan(quads, target)
const indexed = count(dataset.matchIter({ subject: target }))
if (indexed !== expected) throw new Error(`Dataset benchmark oracle failed: ${indexed} != ${expected}.`)

/** Baseline full scan over the same semantic quad values. */
function scan(values: readonly Quad[], subject: Subject): number {
  let matches = 0
  for (const value of values) if (value.subject.equals(subject)) matches++
  return matches
}

/** Counts a lazy match result without materializing another Dataset. */
function count(values: Iterable<Quad>): number {
  let matches = 0
  for (const _value of values) matches++
  return matches
}

group('rdf Dataset exact subject match: 50k quads', () => {
  bench('semantic full scan baseline', () => {
    do_not_optimize(scan(quads, target))
  })

  bench('four-index Dataset.matchIter', () => {
    do_not_optimize(count(dataset.matchIter({ subject: target })))
  })
})

await run()
