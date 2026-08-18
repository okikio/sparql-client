/** Proves light public entry points stay isolated from optional processors and engine packages. @module */

const ROOT = '.tmp/distribution'
await Deno.remove(ROOT, { recursive: true }).catch((error: unknown) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error
})
await Deno.mkdir(ROOT, { recursive: true })

const entries = [
  [
    'rdf',
    "import { namedNode } from '../../packages/rdf/mod.ts'; console.log(namedNode('https://example.com').value)",
  ],
  [
    'sparql',
    "import { select } from '../../packages/sparql/mod.ts'; console.log(select('*').build().value.length)",
  ],
] as const
const forbidden = [
  'jsonld',
  'rdf-canonize',
  'rdfxml-streaming-parser',
  'rdfa-streaming-parser',
  'microdata-rdf-streaming-parser',
  '@comunica/',
  'oxigraph',
  'testcontainers',
]
const results: Array<{ name: string; bytes: number }> = []
for (const [name, source] of entries) {
  const input = `${ROOT}/${name}.ts`
  const output = `${ROOT}/${name}.js`
  await Deno.writeTextFile(input, `${source}\n`)
  const command = new Deno.Command(Deno.execPath(), {
    args: ['bundle', '--platform=browser', '--minify', '-o', output, input],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const status = await command.spawn().status
  if (!status.success) throw new Error(`Browser bundle failed for ${name}.`)
  const text = await Deno.readTextFile(output)
  for (const token of forbidden) {
    if (text.includes(token)) {
      throw new Error(`${name} bundle unexpectedly contains optional dependency token '${token}'.`)
    }
  }
  results.push({ name, bytes: (await Deno.stat(output)).size })
}
await Deno.mkdir('.tmp/reports', { recursive: true })
await Deno.writeTextFile(
  '.tmp/reports/distribution.json',
  `${JSON.stringify({ version: 1, results }, null, 2)}\n`,
)
console.log(`Verified ${results.length} isolated browser bundles.`)
export {}
