import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { env } from 'node:process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Resolve only current public manifest exports, never guessed private subpaths. */
const alias = ['rdf', 'sparql', 'triplestore'].flatMap((name) => {
  const root = new URL(`../../packages/${name}/`, import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    name: string
    exports: Record<string, string>
  }
  return Object.entries(manifest.exports).map(([path, target]) => ({
    find: path === '.' ? manifest.name : `${manifest.name}/${path.slice(2)}`,
    replacement: fileURLToPath(new URL(target, root)),
  }))
}).sort((a, b) => b.find.length - a.find.length)

/** Cross-repository source selection never changes production dependencies. */
const opfsSource = env.OPFS_SOURCE === undefined ? undefined : resolve(env.OPFS_SOURCE)

/** Independent wire fixture records the actual request encoding visible to a server. */
async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/__sparql/stall') {
    response.writeHead(200, { 'content-type': 'application/sparql-results+json' })
    response.write(' ')
    // Closing the browser fetch is the sole owner of this intentionally pending response.
    return
  }
  if (url.pathname === '/__sparql/capability') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ storage: opfsSource !== undefined }))
    return
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > 64 * 1024) throw new Error('Browser fixture request exceeds 64 KiB.')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  const contentType = String(request.headers['content-type'] ?? '')
  const query = request.method === 'GET'
    ? url.searchParams.get('query')
    : contentType.startsWith('application/x-www-form-urlencoded')
    ? new URLSearchParams(body).get('query')
    : body
  if (url.pathname === '/__sparql/wire') {
    response.writeHead(200, { 'content-type': 'application/sparql-results+json' })
    response.end(JSON.stringify({
      head: { vars: ['wire'] },
      results: {
        bindings: [{
          wire: {
            type: 'literal',
            value: JSON.stringify({
              method: request.method,
              contentType,
              query,
              authorization: request.headers.authorization,
            }),
          },
        }],
      },
    }))
    return
  }
  if (query?.startsWith('ASK')) {
    response.writeHead(200, { 'content-type': 'application/sparql-results+json' })
    response.end('{"boolean":true}')
  } else if (query?.startsWith('CONSTRUCT')) {
    response.writeHead(200, { 'content-type': 'application/n-quads' })
    response.end('<urn:s> <urn:p> "bonjour"@fr <urn:g> .\n')
  } else {
    response.writeHead(200, { 'content-type': 'application/sparql-results+json' })
    response.end(
      '{"head":{"vars":["o"]},"results":{"bindings":[{"o":{"type":"literal","value":"bonjour","xml:lang":"fr"}}]}}',
    )
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias },
  optimizeDeps: { noDiscovery: true },
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('../..', import.meta.url)),
        ...(opfsSource === undefined ? [] : [opfsSource]),
      ],
    },
  },
  plugins: [{
    name: 'browser-protocol-fixture',
    transformIndexHtml() {
      return opfsSource === undefined ? [] : [{
        tag: 'script',
        attrs: { type: 'importmap' },
        children: JSON.stringify({ imports: { '@okikio/opfs': `/@fs/${opfsSource}/mod.ts` } }),
        injectTo: 'head-prepend' as const,
      }]
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__sparql/')) return next()
        void respond(request, response).catch((error: unknown) => {
          response.writeHead(500)
          response.end(error instanceof Error ? error.message : String(error))
        })
      })
    },
  }],
})
