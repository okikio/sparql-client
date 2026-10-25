/** Proves light public entry points stay isolated from optional processors and engine packages. @module */

import { fromFileUrl, toFileUrl } from '@std/path'
import { coreRoots, ownedModule, processorRoots, repository } from '../../conformance/ownership.ts'
import { bundleGraph } from '../../conformance/bundle.ts'

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
const results: Array<{ name: string; bytes: number; modules: string[]; packages: string[] }> = []
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
  const graph = await new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', '--frozen-lockfile', '--node-modules-dir=none', input],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!graph.success) {
    throw new Error(`Module graph failed for ${name}: ${new TextDecoder().decode(graph.stderr)}`)
  }
  await Deno.writeFile(`${ROOT}/${name}.graph.json`, graph.stdout)
  const approved = [...coreRoots, new URL(input, repository).href]
  const proof = bundleGraph(
    JSON.parse(new TextDecoder().decode(graph.stdout)),
    approved,
    processorRoots,
  )
  for (const module of proof.modules) {
    const physical = toFileUrl(await Deno.realPath(fromFileUrl(module))).href
    if (!ownedModule(physical, approved)) {
      throw new Error(`${name}: resolved source escapes the owned core graph: ${module}`)
    }
    if (ownedModule(physical, processorRoots)) {
      throw new Error(`${name}: resolved concrete processor enters the light root graph: ${module}`)
    }
  }
  results.push({ name, bytes: (await Deno.stat(output)).size, ...proof })
}
await Deno.mkdir('.tmp/reports', { recursive: true })
await Deno.writeTextFile(
  '.tmp/reports/distribution.json',
  `${JSON.stringify({ version: 1, results }, null, 2)}\n`,
)
console.log(`Verified ${results.length} isolated browser bundles.`)
export {}
