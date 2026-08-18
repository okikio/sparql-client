import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { Store as N3Store } from 'n3'
import { Store as OxigraphStore } from 'oxigraph'
import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { literal, namedNode, quad } from '@okikio/rdf'
import * as oxigraph from '@okikio/oxigraph'
import * as comunica from '@okikio/comunica'

const subject = namedNode('https://example.com/alice')
const name = namedNode('https://schema.org/name')

describe('real SPARQL engine adapters', () => {
  it('adapts Oxigraph 0.5 query, graph, boolean, and update results', async () => {
    const store = new OxigraphStore()
    store.load('<https://example.com/alice> <https://schema.org/name> "Alice" .', {
      format: 'application/n-triples',
    })
    const client = oxigraph.create(store)

    const rows = await collect(
      await client.queryBindings(
        'SELECT ?name WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
      ),
    )
    expect(rows[0]?.get('name')?.value).toBe('Alice')
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
    expect(values[0]?.object.value).toBe('Alice')

    await client.update(
      'DELETE WHERE { <https://example.com/alice> <https://schema.org/name> ?name }',
    )
    expect(
      await client.queryBoolean(
        'ASK { <https://example.com/alice> <https://schema.org/name> ?name }',
      ),
    ).toBe(false)
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
    expect(rows[0]?.get('name')?.value).toBe('Alice')
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
    expect(values[0]?.object.value).toBe('Alice')
    expect(source.size).toBe(1)
  })
})

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
