/**
 * Dataset/store scenarios adapted from the pinned RDF/JS, RDF4J and RDFLib
 * sources listed in bench/upstream/provenance.json. Their licenses are retained
 * with those sources. Recovery stages extend the same semantic assertions to
 * this repository's immutable-segment Store; they are not upstream tests.
 * @module
 */

import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { Dataset, defaultGraph, literal, namedNode, quad } from '@okikio/rdf'
import type { Quad } from '@okikio/rdf'
import { open } from '@okikio/triplestore'
import { expectQuads } from '../../bench/oracle.ts'
import { MemoryFileSystem } from '../../packages/triplestore/_memory_test.ts'

/** Plain independently authored RDF/JS-shaped expected values, without production factories. */
const named = (value: string): { termType: string; value: string } => ({
  termType: 'NamedNode',
  value,
})
const graph = { termType: 'DefaultGraph', value: '' }
const text = (value: string) => ({
  termType: 'Literal',
  value,
  language: '',
  direction: '',
  datatype: named('http://www.w3.org/2001/XMLSchema#string'),
})

/** All combinations deliberately share lexical fields so every index intersection matters. */
const expected = Array.from({ length: 16 }, (_, index) => ({
  subject: named(`urn:s${index & 1}`),
  predicate: named(`urn:p${(index >> 1) & 1}`),
  object: text(`o${(index >> 2) & 1}`),
  graph: index & 8 ? named('urn:g1') : graph,
}))
const values = expected.map((value) =>
  quad(
    namedNode(value.subject.value),
    namedNode(value.predicate.value),
    literal(value.object.value),
    value.graph.termType === 'DefaultGraph' ? defaultGraph() : namedNode(value.graph.value),
  )
)

/** Consumes all results; unordered RDF comparisons must preserve multiplicity. */
async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of source) output.push(value)
  return output
}

describe('upstream datastore contract adaptations', () => {
  for (let mask = 0; mask < 16; mask++) {
    it(`RDF/JS SPOG bound/wildcard intersection ${mask.toString(2).padStart(4, '0')}`, async () => {
      const fs = new MemoryFileSystem()
      let store = await open(fs, { path: '/upstream' })
      const memory = new Dataset(values)
      const pattern = [
        namedNode('urn:s0'),
        namedNode('urn:p0'),
        literal('o0'),
        defaultGraph(),
      ] as const
      // Position-specific binds preserve the fixed SPOG tuple without a cast
      // from a variable-length array of mixed RDF term roles.
      const s = mask & 1 ? pattern[0] : null
      const p = mask & 2 ? pattern[1] : null
      const o = mask & 4 ? pattern[2] : null
      const g = mask & 8 ? pattern[3] : null
      const wanted = expected.filter((value) =>
        (!(mask & 1) || value.subject.value === 'urn:s0') &&
        (!(mask & 2) || value.predicate.value === 'urn:p0') &&
        (!(mask & 4) || value.object.value === 'o0') &&
        (!(mask & 8) || value.graph.termType === 'DefaultGraph')
      )
      const failures: unknown[] = []
      try {
        await store.addAll(values)
        expectQuads(memory.match(s, p, o, g), wanted, 'Dataset intersection')
        expectQuads(await collect(store.match(s, p, o, g)), wanted, 'Store intersection')
        await store.close()
        store = await open(fs, { path: '/upstream' })
        expectQuads(await collect(store.match(s, p, o, g)), wanted, 'delta reopen')
        await store.compact()
        await store.close()
        store = await open(fs, { path: '/upstream' })
        expectQuads(await collect(store.match(s, p, o, g)), wanted, 'snapshot reopen')
      } catch (error) {
        failures.push(error)
      } finally {
        try {
          await store.close()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length) {
        throw new AggregateError(failures, 'Upstream Store scenario or cleanup failed')
      }
    })
  }

  it('RDF/JS duplicate additions and equal-object removals preserve unrelated graphs', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs)
    const failures: unknown[] = []
    try {
      await store.addAll(values)
      const generation = store.generation
      await store.add(quad(namedNode('urn:s0'), namedNode('urn:p0'), literal('o0')))
      expect(store.size).toBe(16)
      expect(store.generation).toBe(generation)
      await store.delete(quad(namedNode('urn:s0'), namedNode('urn:p0'), literal('o0')))
      await store.delete(quad(namedNode('urn:absent'), namedNode('urn:p0'), literal('o0')))
      expectQuads(await collect(store.match()), expected.slice(1), 'one exact deletion')
    } catch (error) {
      failures.push(error)
    } finally {
      try {
        await store.close()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, 'Upstream Store scenario or cleanup failed')
    }
  })

  it('RDFLib graph-context addition copies only supplied statements and appends same graph', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs)
    const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
    const g = namedNode('urn:graph')
    const source = [1, 2, 3].map((index) =>
      quad(namedNode(`urn:s${index}`), rdfType, namedNode('urn:c1'), g)
    )
    const failures: unknown[] = []
    try {
      await store.add(source[0]!)
      expect(store.size).toBe(1)
      expect(store.has(source[1]!)).toBe(false)
      await store.addAll([source[1]!])
      expectQuads(
        await collect(store.match(null, null, null, g)),
        [1, 2].map((index) => ({
          subject: named(`urn:s${index}`),
          predicate: named(rdfType.value),
          object: named('urn:c1'),
          graph: named('urn:graph'),
        })),
        'explicit graph append, not source graph copy',
      )
      expect(store.has(source[2]!)).toBe(false)
    } catch (error) {
      failures.push(error)
    } finally {
      try {
        await store.close()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, 'Upstream Store scenario or cleanup failed')
    }
  })

  it('RDF4J literal-only filtering keeps default and named contexts distinct', () => {
    const data = new Dataset([
      quad(
        namedNode('urn:uri1'),
        namedNode('http://www.w3.org/2000/01/rdf-schema#label'),
        literal('label'),
      ),
      quad(
        namedNode('urn:uri1'),
        namedNode('http://www.w3.org/2000/01/rdf-schema#label'),
        literal('label'),
        namedNode('urn:uri1'),
      ),
    ])
    expect(data.match(null, null, literal('label')).size).toBe(2)
    expect(data.match(null, null, literal('label'), defaultGraph()).size).toBe(1)
    expect(data.match(null, null, literal('different')).size).toBe(0)
    // RDF4J filter is a mutable live view. RDF/JS match is a separate dataset;
    // retain that deliberate API difference rather than copying false expectations.
    const selected = data.match(null, null, literal('label'))
    selected.clear()
    expect(data.size).toBe(2)
  })

  it('independent quad oracle rejects missing, duplicate, wrong graph and wrong literal', () => {
    const first = expected[0]!
    expect(() => expectQuads([first], [first], 'positive')).not.toThrow()
    for (
      const actual of [[], [first, first], [{ ...first, graph: named('urn:wrong') }], [{
        ...first,
        object: text('wrong'),
      }]]
    ) {
      expect(() => expectQuads(actual, [first], 'negative control')).toThrow()
    }
  })
})
