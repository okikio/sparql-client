import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { dataset, datasetEquals, datasetKey, literal, namedNode, quad } from './mod.ts'

const p = namedNode('urn:p')
const g = namedNode('urn:g')
const a = quad(namedNode('urn:a'), p, literal('one'))
const b = quad(namedNode('urn:b'), p, literal('two'), g)
const c = quad(namedNode('urn:a'), namedNode('urn:q'), literal('three'), g)

describe('@okikio/rdf Dataset', () => {
  it('matches by semantic RDF term equality instead of object identity', () => {
    const graph = dataset([a])
    expect([...graph.matchIter({ subject: namedNode('urn:a') })]).toHaveLength(1)
  })

  it('deduplicates equal quads and preserves insertion order', () => {
    const graph = dataset([a, quad(namedNode('urn:a'), p, literal('one')), b])
    expect(graph.size).toBe(2)
    expect([...graph].map((value) => value.subject.value)).toEqual(['urn:a', 'urn:b'])
  })

  it('matches intersections across subject, predicate, object, and graph indexes', () => {
    const graph = dataset([a, b, c])
    expect([...graph.matchIter({ subject: namedNode('urn:a') })]).toHaveLength(2)
    expect([...graph.matchIter({ predicate: p, graph: g })]).toHaveLength(1)
    expect([...graph.matchIter({ object: literal('three'), graph: g })]).toHaveLength(1)
    expect([...graph.matchIter({ subject: namedNode('urn:missing') })]).toHaveLength(0)
  })

  it('updates compact index buckets after deletes and deleteMatches', () => {
    const graph = dataset([a, b, c])
    graph.delete(a)
    expect(graph.estimate({ predicate: p })).toBe(1)
    graph.deleteMatches(null, null, null, g)
    expect(graph.size).toBe(0)
    expect(graph.estimate({ graph: g })).toBe(0)
  })

  it('imports asynchronous sources and honors cancellation', async () => {
    async function* values() {
      yield a
      yield b
    }
    const graph = dataset()
    await graph.import(values())
    expect(graph.size).toBe(2)

    const controller = new AbortController()
    controller.abort(new Error('stop-import'))
    await expect(dataset().import(values(), { signal: controller.signal })).rejects.toThrow(
      'stop-import',
    )
  })

  it('compares datasets semantically and builds insertion-order-independent keys', () => {
    expect(datasetEquals([a, b], [b, a])).toBe(true)
    expect(datasetEquals([a], [a, b])).toBe(false)
    expect(datasetKey([a, b])).toBe(datasetKey([b, a]))
  })

  it('clears all data and exact-term estimates', () => {
    const graph = dataset([a, b])
    graph.clear()
    expect(graph.size).toBe(0)
    expect(graph.estimate()).toBe(0)
  })
})
