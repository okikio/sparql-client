import { describe, it } from 'node:test'
import { finish } from './releases.ts'
import { expect } from '@std/expect'
import { dirname, fromFileUrl, join } from '@std/path'
import { GenericContainer, Network, Wait } from 'testcontainers'
import { ToxiProxyContainer } from '@testcontainers/toxiproxy'
import { key, namedNode, quad } from '@okikio/rdf'
import * as http from '@okikio/sparql/http'
import { QueryError } from '@okikio/sparql/http'
import * as graphStore from '@okikio/sparql/graph-store'

const here = dirname(fromFileUrl(import.meta.url))
const value = quad(namedNode('urn:test:s'), namedNode('urn:test:p'), namedNode('urn:test:o'))

describe('SPARQL protocol services', () => {
  it('round-trips query, update, and Graph Store operations against Oxigraph HTTP', async () => {
    const server = await new GenericContainer('ghcr.io/oxigraph/oxigraph:0.5.9')
      .withCommand(['serve', '--location', '/data', '--bind', '0.0.0.0:7878'])
      .withExposedPorts(7878)
      .withWaitStrategy(Wait.forHttp('/', 7878))
      .start()
    await finish(async (releases) => {
      releases.push(async () => {
        await server.stop()
      })
      const base = `http://${server.getHost()}:${server.getMappedPort(7878)}`
      await exercise(`${base}/query`, `${base}/update`, `${base}/store`)
    })
  })

  it('round-trips query, update, and Graph Store operations against Apache Jena Fuseki', async () => {
    const image = await GenericContainer.fromDockerfile(join(here, 'docker/fuseki')).build()
    const server = await image
      .withExposedPorts(3030)
      .withWaitStrategy(Wait.forHttp('/$/ping', 3030))
      .withStartupTimeout(120_000)
      .start()
    await finish(async (releases) => {
      releases.push(async () => {
        await server.stop()
      })
      const base = `http://${server.getHost()}:${server.getMappedPort(3030)}/ds`
      await exercise(`${base}/query`, `${base}/update`, `${base}/data`)
    })
  })

  it('executes query and update operations against an ephemeral RDF4J repository', async () => {
    const server = await new GenericContainer('eclipse/rdf4j-workbench:5.3.2-tomcat')
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forHttp('/rdf4j-server/protocol', 8080))
      .withStartupTimeout(180_000)
      .start()
    await finish(async (releases) => {
      releases.push(async () => {
        await server.stop()
      })
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

      await exerciseQuery(
        `${root}/repositories/${repository}`,
        `${root}/repositories/${repository}/statements`,
      )
    })
  })

  it('normalizes a real proxied network outage without leaking service ownership', async () => {
    await finish(async (releases) => {
      const network = await new Network().start()
      releases.push(async () => {
        await network.stop()
      })
      const server = await new GenericContainer('ghcr.io/oxigraph/oxigraph:0.5.9')
        .withCommand(['serve', '--location', '/data', '--bind', '0.0.0.0:7878'])
        .withNetwork(network)
        .withNetworkAliases('oxigraph')
        .withExposedPorts(7878)
        .withWaitStrategy(Wait.forHttp('/', 7878))
        .start()
      releases.push(async () => {
        await server.stop()
      })
      const proxyContainer = await new ToxiProxyContainer('ghcr.io/shopify/toxiproxy:2.12.0')
        .withNetwork(network)
        .start()
      releases.push(async () => {
        await proxyContainer.stop()
      })
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
    })
  })
})

it('queries and updates the official Blazegraph executable service', async () => {
  const image = await GenericContainer.fromDockerfile(join(here, 'docker/blazegraph')).build()
  const server = await image.withExposedPorts(9999)
    .withWaitStrategy(Wait.forHttp('/blazegraph/', 9999))
    .withStartupTimeout(120_000).start()
  await finish(async (releases) => {
    releases.push(async () => {
      await server.stop()
    })
    const endpoint = `http://${server.getHost()}:${server.getMappedPort(9999)}/blazegraph/sparql`
    await exerciseQuery(endpoint, endpoint)
  })
})

it('queries a real immutable QLever index through all query transfer encodings', async () => {
  const image = await GenericContainer.fromDockerfile(join(here, 'docker/qlever')).build()
  const server = await image.withExposedPorts(7001)
    .withWaitStrategy(
      Wait.forLogMessage('The server is ready, listening for requests on port 7001'),
    )
    .withStartupTimeout(120_000).start()
  await finish(async (releases) => {
    releases.push(async () => {
      await server.stop()
    })
    const endpoint = `http://${server.getHost()}:${server.getMappedPort(7001)}/`
    const client = http.create({ endpoint })
    for (const queryMethod of ['get', 'post-form', 'post-direct'] as const) {
      expect(
        await client.queryBoolean('ASK { <urn:test:s> <urn:test:p> <urn:test:o> }', {
          queryMethod,
        }),
      ).toBe(true)
      const rows = await collect(
        await client.queryBindings('SELECT ?o WHERE { <urn:test:s> <urn:test:p> ?o }', {
          queryMethod,
        }),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.get('o')?.value).toBe('urn:test:o')
      const quads = await collect(
        await client.queryQuads(
          'CONSTRUCT { <urn:test:s> <urn:test:p> ?o } WHERE { <urn:test:s> <urn:test:p> ?o }',
          { queryMethod },
        ),
      )
      expect(quads).toHaveLength(1)
      expect(quads[0]?.equals(value)).toBe(true)
    }
  })
})

it('queries and updates an isolated official Virtuoso service', async () => {
  const server = await new GenericContainer(
    'openlink/virtuoso-opensource-7:7.2.17-r25.1-g2850f18-alpine',
  )
    .withEnvironment({ DBA_PASSWORD: 'sparql-test-only', DAV_PASSWORD: 'sparql-test-only' })
    .withCopyFilesToContainer([{
      source: join(here, 'docker/virtuoso/01-test.sql'),
      target: '/initdb.d/01-test.sql',
    }])
    .withExposedPorts(8890).withWaitStrategy(Wait.forHttp('/sparql', 8890))
    .withStartupTimeout(120_000).start()
  await finish(async (releases) => {
    releases.push(async () => {
      await server.stop()
    })
    const endpoint = `http://${server.getHost()}:${server.getMappedPort(8890)}/sparql`
    await exerciseQuery(endpoint, endpoint, 'urn:test:virtuoso')
  })
})

async function exercise(
  queryEndpoint: string,
  updateEndpoint: string,
  graphEndpoint: string,
): Promise<void> {
  await exerciseQuery(queryEndpoint, updateEndpoint)
  const graph = graphStore.create({ endpoint: graphEndpoint })
  const extra = quad(namedNode('urn:test:s'), namedNode('urn:test:p'), namedNode('urn:test:extra'))
  for (const selector of [{ graph: 'urn:test:g' }, { default: true }] as const) {
    try {
      await graph.put(selector, [value])
    } catch (error) {
      if (error instanceof QueryError) {
        throw new Error(
          `Graph PUT ${JSON.stringify(selector)} failed: ${JSON.stringify(error.details)}`,
          { cause: error },
        )
      }
      throw error
    }
    await graph.post(selector, [extra])
    const stored = await graph.get(selector)
    const target = typeof selector.graph === 'string' ? namedNode(selector.graph) : undefined
    expect(stored.map(key).sort()).toEqual(
      [
        quad(value.subject, value.predicate, value.object, target),
        quad(extra.subject, extra.predicate, extra.object, target),
      ].map(key).sort(),
    )
    await graph.delete(selector)
    const client = http.create({ endpoint: queryEndpoint })
    expect(
      await client.queryBoolean(
        'graph' in selector ? 'ASK { GRAPH <urn:test:g> { ?s ?p ?o } }' : 'ASK { ?s ?p ?o }',
      ),
    ).toBe(false)
  }
}

/** Checks all standard transfer encodings against real engine query semantics. */
async function exerciseQuery(
  queryEndpoint: string,
  updateEndpoint: string,
  graph?: string,
): Promise<void> {
  const scope = (pattern: string): string => graph ? `GRAPH <${graph}> { ${pattern} }` : pattern
  const client = http.create({ endpoint: queryEndpoint, updateEndpoint })
  for (const updateMethod of ['post-form', 'post-direct'] as const) {
    await client.update(`DELETE WHERE { ${scope('<urn:test:s> ?p ?o')} }`, { updateMethod }).catch(
      (error: unknown) => {
        if (error instanceof QueryError) {
          throw new Error(`Update ${updateMethod} failed: ${JSON.stringify(error.details)}`, {
            cause: error,
          })
        }
        throw error
      },
    )
    await client.update(`INSERT DATA { ${scope('<urn:test:s> <urn:test:p> <urn:test:o>')} }`, {
      updateMethod,
    })
    await client.update(
      `INSERT DATA { ${
        scope(
          '<urn:test:literal> <urn:test:name> "雪"@ja ; <urn:test:price> "12.50"^^<http://www.w3.org/2001/XMLSchema#decimal> .',
        )
      } }`,
      { updateMethod },
    )
    for (const queryMethod of ['get', 'post-form', 'post-direct'] as const) {
      expect(
        await client.queryBoolean(`ASK { ${scope('<urn:test:s> <urn:test:p> <urn:test:o>')} }`, {
          queryMethod,
        }),
      ).toBe(true)
      expect(
        await client.queryBoolean(`ASK { ${scope('<urn:test:missing> ?p ?o')} }`, { queryMethod }),
      ).toBe(false)
      const rows = await collect(
        await client.queryBindings(`SELECT ?o WHERE { ${scope('<urn:test:s> <urn:test:p> ?o')} }`, {
          queryMethod,
        }),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.get('o')?.value).toBe('urn:test:o')
      const quads = await collect(
        await client.queryQuads(
          `CONSTRUCT { <urn:test:s> <urn:test:p> ?o } WHERE { ${
            scope('<urn:test:s> <urn:test:p> ?o')
          } }`,
          { queryMethod },
        ),
      )
      expect(quads).toHaveLength(1)
      expect(quads[0]?.equals(value)).toBe(true)
      const literals = await collect(
        await client.queryBindings(
          `SELECT ?name ?price WHERE { ${
            scope('<urn:test:literal> <urn:test:name> ?name ; <urn:test:price> ?price .')
          } }`,
          { queryMethod },
        ),
      )
      expect(literals).toHaveLength(1)
      const name = literals[0]?.get('name'), price = literals[0]?.get('price')
      expect(name?.termType).toBe('Literal')
      expect(price?.termType).toBe('Literal')
      if (name?.termType === 'Literal') {
        expect(name.value).toBe('雪')
        expect(name.language).toBe('ja')
      }
      if (price?.termType === 'Literal') {
        expect(price.datatype.value).toBe('http://www.w3.org/2001/XMLSchema#decimal')
        expect(Number(price.value)).toBe(12.5)
      }
    }
  }
}

function memoryConfig(id: string): string {
  return `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix config: <tag:rdf4j.org,2023:config/> .\n[] a config:Repository ; config:rep.id "${id}" ; rdfs:label "SPARQL client integration" ; config:rep.impl [ config:rep.type "openrdf:SailRepository" ; config:sail.impl [ config:sail.type "openrdf:MemoryStore" ; config:mem.persist false ] ] .\n`
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
