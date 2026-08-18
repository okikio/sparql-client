import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import { create } from './mod.ts'

const source = quad(
  namedNode('urn:s'),
  namedNode('urn:p'),
  namedNode('urn:o'),
  namedNode('urn:source'),
)

describe('@okikio/sparql/graph-store', () => {
  it('emits the exact default selector used by Graph Store HTTP Protocol', async () => {
    let url = ''
    const client = create({
      endpoint: 'https://example.com/data',
      fetch: async (input) => {
        url = String(input)
        return new Response(null, { status: 204 })
      },
    })
    await client.delete({ default: true })
    expect(url).toBe('https://example.com/data?default')
  })

  it('percent-encodes named graph selectors without losing endpoint query parameters', async () => {
    let url = ''
    const client = create({
      endpoint: 'https://example.com/data?tenant=a',
      fetch: async (input) => {
        url = String(input)
        return new Response(null, { status: 204 })
      },
    })
    await client.delete({ graph: 'https://example.com/graph?a=1&b=2' })
    const target = new URL(url)
    expect(target.searchParams.get('tenant')).toBe('a')
    expect(target.searchParams.get('graph')).toBe('https://example.com/graph?a=1&b=2')
  })

  it('writes graph payloads as RDF graphs and reattaches the selected graph on reads', async () => {
    const bodies: string[] = []
    const client = create({
      endpoint: 'https://example.com/data',
      fetch: async (_input, init) => {
        if (init?.body) bodies.push(String(init.body))
        if (init?.method === 'GET') {
          return new Response('<urn:s> <urn:p> <urn:o> .\n', {
            headers: { 'content-type': 'application/n-triples' },
          })
        }
        return new Response(null, { status: 204 })
      },
    })

    await client.put({ graph: 'urn:target' }, [source])
    expect(bodies[0]).toBe('<urn:s> <urn:p> <urn:o> .\n')
    const values = await client.get({ graph: 'urn:target' })
    expect(values).toHaveLength(1)
    expect(values[0]?.graph.value).toBe('urn:target')
  })
})
