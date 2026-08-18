import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { dirname, fromFileUrl, join } from '@std/path'
import { GenericContainer, Network, Wait } from 'testcontainers'
import { ToxiProxyContainer } from '@testcontainers/toxiproxy'
import { namedNode, quad } from '@okikio/rdf'
import * as http from '@okikio/sparql/http'
import { QueryError } from '@okikio/sparql/http'
import * as graphStore from '@okikio/sparql/graph-store'

const here = dirname(fromFileUrl(import.meta.url))
const value = quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o'))

describe('SPARQL protocol services', () => {
  it('round-trips query, update, and Graph Store operations against Oxigraph HTTP', async () => {
    const server = await new GenericContainer('ghcr.io/oxigraph/oxigraph:0.5.9')
      .withCommand(['serve', '--location', '/data', '--bind', '0.0.0.0:7878'])
      .withExposedPorts(7878)
      .withWaitStrategy(Wait.forHttp('/', 7878))
      .start()
    try {
      const base = `http://${server.getHost()}:${server.getMappedPort(7878)}`
      await exercise(`${base}/query`, `${base}/update`, `${base}/store`)
    } finally {
      await server.stop()
    }
  })

  it('round-trips query, update, and Graph Store operations against Apache Jena Fuseki', async () => {
    const image = await GenericContainer.fromDockerfile(join(here, 'docker/fuseki')).build()
    const server = await image
      .withExposedPorts(3030)
      .withWaitStrategy(Wait.forHttp('/$/ping', 3030))
      .withStartupTimeout(120_000)
      .start()
    try {
      const base = `http://${server.getHost()}:${server.getMappedPort(3030)}/ds`
      await exercise(`${base}/query`, `${base}/update`, `${base}/data`)
    } finally {
      await server.stop()
    }
  })

  it('executes query and update operations against an ephemeral RDF4J repository', async () => {
    const server = await new GenericContainer('eclipse/rdf4j-workbench:5.3.2-tomcat')
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forHttp('/rdf4j-server/protocol', 8080))
      .withStartupTimeout(180_000)
      .start()
    try {
      const root = `http://${server.getHost()}:${server.getMappedPort(8080)}/rdf4j-server`
      const repository = 'sparql-client-test'
      const response = await fetch(`${root}/repositories/${repository}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/turtle' },
        body: memoryConfig(repository),
      })
      if (!response.ok) {
        throw new Error(
          `RDF4J repository creation failed with HTTP ${response.status}: ${await response.text()}`,
        )
      }

      const client = http.create({ endpoint: `${root}/repositories/${repository}` })
      await client.update('INSERT DATA { <urn:s> <urn:p> <urn:o> }')
      expect(await client.queryBoolean('ASK { <urn:s> <urn:p> <urn:o> }')).toBe(true)
      const rows = await collect(
        await client.queryBindings('SELECT ?o WHERE { <urn:s> <urn:p> ?o }'),
      )
      expect(rows[0]?.get('o')?.value).toBe('urn:o')
    } finally {
      await server.stop()
    }
  })

  it('normalizes a real proxied network outage without leaking service ownership', async () => {
    const network = await new Network().start()
    const server = await new GenericContainer('ghcr.io/oxigraph/oxigraph:0.5.9')
      .withCommand(['serve', '--location', '/data', '--bind', '0.0.0.0:7878'])
      .withNetwork(network)
      .withNetworkAliases('oxigraph')
      .withExposedPorts(7878)
      .withWaitStrategy(Wait.forHttp('/', 7878))
      .start()
    try {
      const proxyContainer = await new ToxiProxyContainer('ghcr.io/shopify/toxiproxy:2.12.0')
        .withNetwork(network)
        .start()
      try {
        const proxy = await proxyContainer.createProxy({
          name: 'sparql',
          upstream: 'oxigraph:7878',
        })
        const client = http.create({ endpoint: `http://${proxy.host}:${proxy.port}/query` })
        expect(await client.queryBoolean('ASK {}')).toBe(true)
        await proxy.setEnabled(false)
        let failure: unknown
        try {
          await client.queryBoolean('ASK {}', { timeoutMs: 2_000 })
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(QueryError)
        const kind = (failure as QueryError).kind
        expect(kind === 'network' || kind === 'timeout').toBe(true)
      } finally {
        await proxyContainer.stop()
      }
    } finally {
      await server.stop()
      await network.stop()
    }
  })
})

async function exercise(
  queryEndpoint: string,
  updateEndpoint: string,
  graphEndpoint: string,
): Promise<void> {
  const client = http.create({ endpoint: queryEndpoint, updateEndpoint })
  await client.update('INSERT DATA { <urn:s> <urn:p> <urn:o> }')
  expect(await client.queryBoolean('ASK { <urn:s> <urn:p> <urn:o> }')).toBe(true)
  const rows = await collect(await client.queryBindings('SELECT ?o WHERE { <urn:s> <urn:p> ?o }'))
  expect(rows[0]?.get('o')?.value).toBe('urn:o')

  const graph = graphStore.create({ endpoint: graphEndpoint })
  await graph.put({ graph: 'urn:g' }, [value])
  const stored = await graph.get({ graph: 'urn:g' })
  expect(stored).toHaveLength(1)
  expect(stored[0]?.graph.value).toBe('urn:g')
  await graph.delete({ graph: 'urn:g' })
}

function memoryConfig(id: string): string {
  return `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix config: <tag:rdf4j.org,2023:config/> .\n[] a config:Repository ; config:rep.id "${id}" ; rdfs:label "SPARQL client integration" ; config:rep.impl [ config:rep.type "openrdf:SailRepository" ; config:sail.impl [ config:sail.type "openrdf:MemoryStore" ; config:mem.persist false ] ] .\n`
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
