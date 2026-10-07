/** Behavior exercised from the actual packed artifacts in clean Deno, Node, and Bun projects. @module */
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as rdf from '@okikio/rdf'
import type { Quad } from '@okikio/rdf'
import * as nquads from '@okikio/rdf/nquads'
import * as turtle from '@okikio/rdf/turtle'
import { parse as parseRdfa } from '@okikio/rdf/rdfa'
import * as canon from '@okikio/rdf/canon'
import * as jsonld from '@okikio/rdf/jsonld'
import * as sparql from '@okikio/sparql'
import * as http from '@okikio/sparql/http'
import * as graphStore from '@okikio/sparql/graph-store'
import { compile } from '@okikio/vocab/compile'
import { ProductSchema } from '@okikio/vocab/schema'

// Workspace aliases cannot stand in for the archives this fixture is intended to exercise.
const installed = `${realpathSync(new URL('./node_modules/', import.meta.url))}${sep}`
const resolutions = Object.fromEntries([
  '@okikio/rdf',
  '@okikio/rdf/nquads',
  '@okikio/rdf/turtle',
  '@okikio/rdf/rdfa',
  '@okikio/rdf/canon',
  '@okikio/rdf/jsonld',
  '@okikio/sparql',
  '@okikio/sparql/http',
  '@okikio/sparql/graph-store',
  '@okikio/vocab/compile',
  '@okikio/vocab/schema',
].map((specifier) => {
  const path = realpathSync(fileURLToPath(import.meta.resolve(specifier)))
  assert.ok(
    path.startsWith(installed),
    `${specifier} resolves outside installed artifacts: ${path}`,
  )
  return [specifier, path]
}))
console.log(`Installed behavior module paths: ${JSON.stringify(resolutions)}`)

const value = rdf.quad(
  rdf.namedNode('urn:s'),
  rdf.namedNode('urn:p'),
  rdf.literal('quote " 雪', 'ja'),
)
const dataset = rdf.dataset([value, value])
assert.equal(dataset.size, 1)
assert.deepEqual([...dataset.match(value.subject)], [value])
const roundTrip = []
for await (const item of nquads.parse([nquads.write(dataset)])) roundTrip.push(item)
assert.ok(rdf.equals(roundTrip[0]!, value))
assert.equal(roundTrip.length, 1)
assert.equal(await canon.canonicalize(dataset), nquads.write(dataset))
const parsed = []
for await (const item of turtle.parse('@prefix ex: <urn:> . ex:s ex:p "雪" .')) parsed.push(item)
assert.equal(parsed[0]?.object.value, '雪')
// The packed public RDFa option must also govern its embedded native XML pass.
const svgText = 'A'.repeat(16 * 1024 * 1024 + 64)
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/terms/" xml:base="urn:document"><metadata><rdf:RDF><rdf:Description rdf:about="urn:subject"><dc:title>${svgText}</dc:title></rdf:Description></rdf:RDF></metadata></svg>`
/** Materializes this bounded fixture so rejection and exact packed output are both checked. */
async function readSvg(maxBytes?: number): Promise<Quad[]> {
  const values: Quad[] = []
  for await (
    const item of parseRdfa(svg, {
      contentType: 'image/svg+xml',
      ...(maxBytes === undefined ? {} : { maxBytes }),
    })
  ) values.push(item)
  return values
}
await assert.rejects(readSvg(), RangeError)
const svgValues = await readSvg(new TextEncoder().encode(svg).byteLength)
assert.equal(svgValues.length, 1)
assert.equal(svgValues[0]?.subject.value, 'urn:subject')
assert.equal(svgValues[0]?.predicate.value, 'http://purl.org/dc/terms/title')
assert.equal(svgValues[0]?.object.value, svgText)
const expanded = await jsonld.expand({
  '@context': { label: 'urn:p' },
  '@id': 'urn:s',
  label: '雪',
})
// JSON-LD output is JSON data; record prototypes are not part of its semantic contract.
assert.deepEqual(JSON.parse(JSON.stringify(expanded)), [{
  '@id': 'urn:s',
  'urn:p': [{ '@value': '雪' }],
}])
const query = sparql.select(['?value']).where(
  sparql.triple(value.subject, value.predicate, '?value'),
)
assert.ok(query.build().value.includes('<urn:p>'))
const schemaResult = await ProductSchema['~standard'].validate({
  '@type': 'Product',
  name: 'Widget',
})
assert.ok(!schemaResult.issues)
const compiled = await compile([{
  id: 'fixture',
  quads: [
    rdf.quad(
      rdf.namedNode('urn:Class'),
      rdf.namedNode(rdf.RDF.type),
      rdf.namedNode('http://www.w3.org/2000/01/rdf-schema#Class'),
    ),
  ],
}], { vocabulary: 'fixture', namespace: 'urn:', prefix: 'fixture' })
assert.deepEqual(compiled.manifest.symbols, [{ iri: 'urn:Class', kind: 'class', name: 'Class' }])

const requests: Array<{ method: string; url: URL; query: string | null }> = []
/** Decode requests independently so an artifact with a broken transfer encoding cannot pass. */
async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let body = ''
  for await (const chunk of request) body += String(chunk)
  const queryText = request.method === 'GET'
    ? url.searchParams.get('query')
    : String(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')
    ? new URLSearchParams(body).get('query')
    : body
  requests.push({ method: request.method ?? '', url, query: queryText })
  if (url.pathname === '/graph') {
    response.writeHead(200, { 'content-type': 'application/n-triples' })
    response.end('<urn:s> <urn:p> "雪" .\n')
  } else {
    response.writeHead(200, { 'content-type': 'application/sparql-results+json' })
    response.end(
      JSON.stringify({
        head: { vars: ['value'] },
        results: { bindings: [{ value: { type: 'literal', value: '雪', 'xml:lang': 'ja' } }] },
      }),
    )
  }
}
const server = createServer((request, response) => {
  void respond(request, response).catch((error: unknown) => {
    response.writeHead(500)
    response.end(error instanceof Error ? error.message : String(error))
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}`
  for (const queryMethod of ['get', 'post-form', 'post-direct'] as const) {
    const rows = []
    for await (const row of await http.create({ endpoint, queryMethod }).queryBindings(query)) {
      rows.push(row)
    }
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.get('value')?.value, '雪')
    assert.equal(requests.at(-1)?.query, query.build().value)
    assert.equal(requests.at(-1)?.method, queryMethod === 'get' ? 'GET' : 'POST')
  }
  const graph = await graphStore.create({ endpoint: `${endpoint}/graph` }).get({ graph: 'urn:g' })
  assert.equal(graph[0]?.graph.value, 'urn:g')
  assert.equal(graph.length, 1)
  assert.ok(
    graph[0]?.equals(
      rdf.quad(value.subject, value.predicate, rdf.literal('雪'), rdf.namedNode('urn:g')),
    ),
  )
  assert.equal(requests.at(-1)?.url.searchParams.get('graph'), 'urn:g')
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )
}
console.log('Packed RDF, SPARQL, vocabulary, JSON-LD, canonicalization, and HTTP behavior passed.')
