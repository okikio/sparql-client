/** Decision benchmark for persistent-store lookup and recovery mechanisms. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { report } from '../../bench/report.ts'
import {
  Dataset,
  datasetKey,
  literal,
  namedNode,
  type Quad,
  quad,
  type SubjectTermType,
} from '@okikio/rdf'
import { MemoryFileSystem } from './_memory_test.ts'
import { open } from './mod.ts'

const SIZE = 50_000
const SUBJECTS = 5_000
const predicate = namedNode('https://example.com/p')
const quads = Array.from({ length: SIZE }, (_, index) =>
  quad(
    namedNode(`https://example.com/s/${index % SUBJECTS}`),
    predicate,
    literal(`value-${index}`),
  ))
const target = namedNode('https://example.com/s/1729')
const memory = new Dataset(quads)
const fs = new MemoryFileSystem()
const store = await open(fs, { path: '/db' })
try {
  await store.addAll(quads)
  const expected = scan(quads, target)
  if (await count(store.match(target)) !== expected) {
    throw new Error('Triplestore lookup oracle failed.')
  }
  const expectedTarget = datasetKey(quads.filter((value) => value.subject.equals(target)))
  if (
    datasetKey(memory.matchIter({ subject: target })) !== expectedTarget ||
    datasetKey(await collect(store.match(target))) !== expectedTarget
  ) throw new Error('Triplestore exact target identities differ.')

  /** Delta replay and compacted snapshot recovery have separate fixtures and complete dataset oracles. */
  const snapshotFs = new MemoryFileSystem()
  const snapshotStore = await open(snapshotFs, { path: '/db' })
  await snapshotStore.addAll(quads)
  await snapshotStore.compact()
  await snapshotStore.close()
  const expectedDataset = datasetKey(quads)
  for (const source of [fs, snapshotFs]) {
    const reopened = await open(source, { path: '/db' })
    try {
      if (
        reopened.size !== SIZE || datasetKey(await collect(reopened.match())) !== expectedDataset
      ) throw new Error('Triplestore recovery benchmark dataset oracle failed.')
    } finally {
      await reopened.close()
    }
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

  group(
    'triplestore warm-runtime memory-filesystem recovery: 50k equivalent committed quads',
    () => {
      bench('immutable delta replay + checksum + parse + index', async () => {
        const reopened = await open(fs, { path: '/db' })
        try {
          do_not_optimize(reopened.size)
        } finally {
          await reopened.close()
        }
      }).gc('inner')
      bench('compacted snapshot + checksum + parse + index', async () => {
        const reopened = await open(snapshotFs, { path: '/db' })
        try {
          do_not_optimize(reopened.size)
        } finally {
          await reopened.close()
        }
      }).gc('inner')
    },
  )

  await report()
} finally {
  await store.close()
}

/** Materializes a preflight result for complete semantic comparison outside timing. */
async function collect(values: AsyncIterable<Quad>): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of values) output.push(value)
  return output
}

/** Full-scan baseline over the same semantic quads. */
function scan(values: readonly Quad[], subject: SubjectTermType): number {
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
