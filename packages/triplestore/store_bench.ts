/** Decision benchmark for persistent-store lookup and recovery mechanisms. @module */

import { bench, do_not_optimize, group, run } from 'mitata'
import { Dataset, literal, namedNode, quad, type Quad, type Subject } from '@okikio/rdf'
import { MemoryFileSystem } from './_memory_test.ts'
import { open } from './mod.ts'

const SIZE = 50_000
const SUBJECTS = 5_000
const predicate = namedNode('https://example.com/p')
const quads = Array.from({ length: SIZE }, (_, index) => quad(
  namedNode(`https://example.com/s/${index % SUBJECTS}`),
  predicate,
  literal(`value-${index}`),
))
const target = namedNode('https://example.com/s/1729')
const memory = new Dataset(quads)
const fs = new MemoryFileSystem()
const store = await open(fs, { path: '/db' })
await store.addAll(quads)
const expected = scan(quads, target)
if (await count(store.match(target)) !== expected) throw new Error('Triplestore lookup oracle failed.')

/** Full-scan baseline over the same semantic quads. */
function scan(values: readonly Quad[], subject: Subject): number {
  let matches = 0
  for (const value of values) if (value.subject.equals(subject)) matches++
  return matches
}

/** Counts sync or async RDF values without materialization. */
async function count(values: Iterable<Quad> | AsyncIterable<Quad>): Promise<number> {
  let matches = 0
  for await (const _value of values) matches++
  return matches
}

group('triplestore exact subject lookup: 50k committed quads', () => {
  bench('semantic array scan baseline', () => {
    do_not_optimize(scan(quads, target))
  })

  bench('in-memory Dataset exact index', () => {
    do_not_optimize([...memory.matchIter({ subject: target })].length)
  })

  bench('persistent Store exact index', async () => {
    do_not_optimize(await count(store.match(target)))
  })
})

group('triplestore cold recovery from immutable snapshot', () => {
  bench('open + checksum + parse + index 50k quads', async () => {
    const reopened = await open(fs, { path: '/db' })
    do_not_optimize(reopened.size)
    await reopened.close()
  }).gc('inner')
})

await run()
await store.close()
