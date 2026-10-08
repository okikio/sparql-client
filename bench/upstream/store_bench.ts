/**
 * Apache Jena findAndCountS__/ _P_/ __O/ SP_/ S_O/ _PO port.
 * Original Java/ASF notices and exact cheese corpus are retained under sources;
 * see provenance.json and README.md for the CC-BY-SA data attribution.
 * @module
 */

import { bench, do_not_optimize, group } from 'mitata'
import { Parser, Store as N3Store } from 'n3'
import { Dataset, fromQuad } from '@okikio/rdf'
import type { Quad } from '@okikio/rdf'
import { open } from '@okikio/triplestore'
import { expectQuads } from '../oracle.ts'
import { report } from '../report.ts'
import { inspectSources } from './provenance.ts'
import { MemoryFileSystem } from '../../packages/triplestore/_memory_test.ts'

/** RDF identity read from public fields independently of native key()/equals()/indexes. */
function identity(value: { readonly termType: string; readonly value: string }): string {
  if (value.termType === 'Literal') {
    const term = value as typeof value & {
      language: string
      datatype: typeof value
      direction?: string
    }
    return JSON.stringify([
      term.termType,
      term.value,
      term.language,
      term.direction ?? '',
      term.datatype.value,
    ])
  }
  return JSON.stringify([value.termType, value.value])
}

/** The upstream graph benchmark uses six nonempty SPO selector families. Graph is default here. */
const families = [
  ['S__', ['subject']],
  ['_P_', ['predicate']],
  ['__O', ['object']],
  ['SP_', ['subject', 'predicate']],
  ['S_O', ['subject', 'object']],
  ['_PO', ['predicate', 'object']],
] as const
const provenance = await inspectSources()
const text = await Deno.readTextFile(
  new URL('./sources/apache-jena/jena-benchmarks/testing/cheeses-0.1.ttl', import.meta.url),
)
const parsed = new Parser({ format: 'Turtle' }).parse(text)
// Use a plain collision-free tuple Set as the independent set oracle. Do not
// derive expected cardinality with the production Dataset or competing Store.
const unique = new Map<string, typeof parsed[number]>()
for (const value of parsed) {
  unique.set(
    JSON.stringify([
      identity(value.subject),
      identity(value.predicate),
      identity(value.object),
      identity(value.graph),
    ]),
    value,
  )
}
const expected = [...unique.values()]
if (!expected.length || expected.some((value) => value.graph.termType !== 'DefaultGraph')) {
  throw new Error('Jena graph fixture must be nonempty and contain only default graph triples')
}
const data = expected.map(fromQuad)
const native = new Dataset(data)
const competitor = new N3Store(expected)
const fs = new MemoryFileSystem()
let persistent = await open(fs, { path: '/jena' })
const failures: unknown[] = []
try {
  await persistent.addAll(data)
  await persistent.close()
  persistent = await open(fs, { path: '/jena' })
  expectQuads(native, expected, 'native complete corpus')
  const recovered = []
  for await (const value of persistent.match()) recovered.push(value)
  expectQuads(recovered, expected, 'persistent complete corpus')
  expectQuads(competitor, expected, 'N3 complete corpus')
  const workload: { family: string; selectors: number; consumedQuads: number }[] = []
  for (const [name, roles] of families) {
    const partitions = new Map<string, { selector: Partial<Quad>; expected: typeof expected }>()
    for (const row of expected) {
      const tuple = JSON.stringify(roles.map((role) => identity(row[role])))
      let partition = partitions.get(tuple)
      if (!partition) {
        const copy = fromQuad(row)
        partition = {
          selector: Object.fromEntries(roles.map((role) => [role, copy[role]])),
          expected: [],
        }
        partitions.set(tuple, partition)
      }
      partition.expected.push(row)
    }
    const selectors = [...partitions.values()]
    workload.push({ family: name, selectors: selectors.length, consumedQuads: expected.length })
    for (const { selector, expected: wanted } of selectors) {
      const { subject: s = null, predicate: p = null, object: o = null } = selector
      expectQuads(native.matchIter(selector), wanted, `native ${name}`)
      expectQuads(competitor.readQuads(s, p, o, null), wanted, `N3 ${name}`)
      const actual = []
      for await (const value of persistent.match(s, p, o)) actual.push(value)
      expectQuads(actual, wanted, `Store ${name}`)
    }
    /** One operation traverses every unique selector and consumes every matching quad, as Jena does. */
    const nativeCount = (): number => {
      let count = 0
      for (const { selector } of selectors) for (const _ of native.matchIter(selector)) count++
      return count
    }
    const competitorCount = (): number => {
      let count = 0
      for (const { selector } of selectors) {
        for (
          const _ of competitor.readQuads(
            selector.subject ?? null,
            selector.predicate ?? null,
            selector.object ?? null,
            null,
          )
        ) count++
      }
      return count
    }
    const persistentCount = async (): Promise<number> => {
      let count = 0
      for (const { selector } of selectors) {
        for await (
          const _ of persistent.match(
            selector.subject ?? null,
            selector.predicate ?? null,
            selector.object ?? null,
          )
        ) count++
      }
      return count
    }
    if (
      nativeCount() !== expected.length || competitorCount() !== expected.length ||
      await persistentCount() !== expected.length
    ) throw new Error(`Jena ${name} count oracle failed`)
    group(
      `Jena ${name}: ${expected.length} actual cheese triples, ${selectors.length} distinct selectors/op`,
      () => {
        bench('native Dataset iterator/count', () => do_not_optimize(nativeCount())).gc('inner')
        bench('N3 iterator/count baseline', () => do_not_optimize(competitorCount())).gc('inner')
        // Already recovered in-memory Store index; memory-filesystem writes and
        // physical I/O are outside timing. This includes async iteration overhead.
        bench(
          'Store async iterator/count (borrowed MemoryFileSystem, warm index)',
          async () => do_not_optimize(await persistentCount()),
        ).gc('inner')
      },
    )
  }
  console.error(
    JSON.stringify({
      upstream: 'apache/jena',
      rawTriples: parsed.length,
      uniqueTriples: expected.length,
      corpusBytes: new TextEncoder().encode(text).length,
      cases: families.length * 3,
      workload,
    }),
  )
  await report()
  if ((await inspectSources()).identity !== provenance.identity) {
    throw new Error('Upstream provenance changed during benchmark consumption')
  }
} catch (error) {
  failures.push(error)
} finally {
  try {
    await persistent.close()
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) throw new AggregateError(failures, 'Upstream Jena workload or cleanup failed')
