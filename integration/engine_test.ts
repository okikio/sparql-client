import { describe, it } from 'node:test'
import { finish } from './releases.ts'
import { openEngine } from '../bench/upstream/engines.ts'
import { expect } from '@std/expect'
import { Store as N3Store } from 'n3'
import { Store as NativeStore } from 'oxigraph'
import * as oxigraph from '@okikio/oxigraph'
import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { literal, namedNode, quad } from '@okikio/rdf'
import * as comunica from '@okikio/comunica'

const subject = namedNode('https://example.com/alice')
const name = namedNode('https://schema.org/name')

describe('real SPARQL engine adapters', () => {
  it('adapts Oxigraph 0.5 query, graph, boolean, and update results', async () => {
    await finish(async (releases) => {
      // This exact fixture owns the Wasm Store, returned rows and getter-created
      // wrappers. The production adapter continues to borrow its engine.
      const engine = openEngine(
        'Oxigraph',
        '<https://example.com/alice> <https://schema.org/name> "Alice" .',
      )
      releases.push(() => engine.close())
      const client = engine.client

      const rows = await collect(
        await client.queryBindings(
          'SELECT ?name WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.get('name')?.equals(literal('Alice'))).toBe(true)
      expect(
        await client.queryBoolean(
          'ASK { <https://example.com/alice> <https://schema.org/name> "Alice" }',
        ),
      ).toBe(true)

      const values = await collect(
        await client.queryQuads(
          'CONSTRUCT { <https://example.com/alice> <https://schema.org/name> ?name } WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
        ),
      )
      expect(values).toHaveLength(1)
      expect(values[0]?.equals(quad(subject, name, literal('Alice')))).toBe(true)

      await client.update(
        'DELETE WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
      )
      expect(
        await client.queryBoolean(
          'ASK { <https://example.com/alice> <https://schema.org/name> ?name }',
        ),
      ).toBe(false)
    })
  })

  it('retires actual native result wrappers while detached RDF values and the borrowed Store remain usable', async (context) => {
    await finish(async (releases) => {
      const store = new NativeStore()
      releases.push(() => {
        const free: unknown = Reflect.get(store, 'free')
        if (typeof free !== 'function') throw new TypeError('Owned native Store lacks free().')
        Reflect.apply(free, store, [])
      })
      store.load('<urn:a> <urn:p> "Alice"@en .\n<urn:b> <urn:p> "Bob"@fr .', {
        format: 'application/n-triples',
      })
      const parents: Array<{ releases: number }> = []
      const query = store.query.bind(store)
      const observed = context.mock.method(
        store,
        'query',
        (...options: Parameters<NativeStore['query']>) => {
          const output = query(...options)
          if (Array.isArray(output)) {
            for (const row of output) {
              for (const parent of row instanceof Map ? row.values() : [row]) {
                const free: unknown = Reflect.get(parent, 'free')
                if (typeof free !== 'function') throw new TypeError('Native result lacks free().')
                const record = { releases: 0 }
                parents.push(record)
                // A spy on each actual allocated wrapper observes disposal without replacing
                // RDF semantic getters, conversion, native query results or pointer state.
                Object.defineProperty(parent, 'free', {
                  value() {
                    record.releases++
                    Reflect.apply(free, parent, [])
                  },
                })
              }
            }
          }
          return output
        },
      )
      releases.push(() => observed.mock.restore())
      const client = oxigraph.create(store, { results: 'owned' })
      const selected = await client.queryBindings('SELECT ?value WHERE { <urn:a> <urn:p> ?value }')
      releases.push(() => selected.close({ waitForCleanup: true }))
      const rows = await collect(selected)
      await selected.cleanup
      await selected.close()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.get('value')?.equals(literal('Alice', 'en'))).toBe(true)
      expect(parents.length).toBeGreaterThan(0)
      expect(parents.every((parent) => parent.releases === 1)).toBe(true)

      const constructed = await client.queryQuads(
        'CONSTRUCT { <urn:a> <urn:p> ?value } WHERE { <urn:a> <urn:p> ?value }',
      )
      releases.push(() => constructed.close({ waitForCleanup: true }))
      const values = await collect(constructed)
      await constructed.cleanup
      await constructed.close()
      expect(values).toHaveLength(1)
      expect(
        values[0]?.equals(quad(namedNode('urn:a'), namedNode('urn:p'), literal('Alice', 'en'))),
      ).toBe(true)
      expect(parents.every((parent) => parent.releases === 1)).toBe(true)

      let start = parents.length
      const unused = await client.queryBindings(
        'SELECT ?value WHERE { ?s <urn:p> ?value } ORDER BY ?value',
      )
      releases.push(() => unused.close({ waitForCleanup: true }))
      expect(parents.length - start).toBe(2)
      await unused.close({ waitForCleanup: true })
      expect(parents.slice(start).map((parent) => parent.releases)).toEqual([1, 1])

      start = parents.length
      const partial = await client.queryBindings(
        'SELECT ?value WHERE { ?s <urn:p> ?value } ORDER BY ?value',
      )
      releases.push(() => partial.close({ waitForCleanup: true }))
      for await (const row of partial) {
        expect(row.get('value')?.equals(literal('Alice', 'en'))).toBe(true)
        break
      }
      await partial.cleanup
      expect(parents.slice(start).map((parent) => parent.releases)).toEqual([1, 1])
      await client.update('DELETE WHERE { <urn:b> <urn:p> ?value }')
      expect(await client.queryBoolean('ASK { <urn:a> <urn:p> "Alice"@en }')).toBe(true)
      expect(await client.queryBoolean('ASK { <urn:b> <urn:p> ?value }')).toBe(false)
      // Detached values remain usable after subsequent operations and native retirement.
      expect(rows[0]?.get('value')?.value).toBe('Alice')
      expect(values[0]?.object.value).toBe('Alice')
    })
  })

  it('adapts a real Comunica RDF/JS query engine without taking source ownership', async () => {
    const source = new N3Store([quad(subject, name, literal('Alice'))])
    const engine = new QueryEngine()
    const client = comunica.create(engine, { context: () => ({ sources: [source] }) })

    const rows = await collect(
      await client.queryBindings(
        'SELECT ?name WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('name')?.equals(literal('Alice'))).toBe(true)
    expect(
      await client.queryBoolean(
        'ASK { <https://example.com/alice> <https://schema.org/name> "Alice" }',
      ),
    ).toBe(true)

    const values = await collect(
      await client.queryQuads(
        'CONSTRUCT { <https://example.com/alice> <https://schema.org/name> ?name } WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
      ),
    )
    expect(values).toHaveLength(1)
    expect(values[0]?.equals(quad(subject, name, literal('Alice')))).toBe(true)
    expect(source.size).toBe(1)
    expect(source.has(quad(subject, name, literal('Alice')))).toBe(true)
  })
})

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
