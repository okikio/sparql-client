/** Installs packed workspace artifacts into a clean project and imports every public entry point in Node, Deno, and Bun. @module */

import * as workspace from './workspace.ts'
import { optional } from './files.ts'
import * as artifacts from './artifacts.ts'

const PACK = '.tmp/packages'
const ROOT = '.tmp/consumer'
if (!(await exists(PACK))) await run(Deno.execPath(), ['task', 'package'])
const tarballs = (await artifacts.get()).map((path) => `../../${path}`)
await optional(() => Deno.remove(ROOT, { recursive: true }))
await Deno.mkdir(ROOT, { recursive: true })

await Deno.writeTextFile(`${ROOT}/package.json`, '{"private":true,"type":"module"}\n')
await run('npm', [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--no-package-lock',
  '@types/node@24.10.1',
  ...tarballs,
], ROOT)
await artifacts.installed(ROOT)
await Deno.writeTextFile(`${ROOT}/smoke.ts`, await smoke())
await Deno.copyFile('integration/consumer.ts', `${ROOT}/behavior.ts`)
await run(
  Deno.execPath(),
  ['check', '--no-config', '--node-modules-dir=manual', 'behavior.ts'],
  ROOT,
)

await run('node', ['smoke.ts'], ROOT)
await run('node', ['behavior.ts'], ROOT)
await run(Deno.execPath(), [
  'run',
  '--no-config',
  '--allow-read=node_modules',
  '--node-modules-dir=manual',
  'smoke.ts',
], ROOT)
await run(Deno.execPath(), [
  'run',
  '--no-config',
  '--allow-read=node_modules',
  '--allow-net=127.0.0.1',
  '--node-modules-dir=manual',
  'behavior.ts',
], ROOT)
await run('bun', ['run', 'smoke.ts'], ROOT)
await run('bun', ['run', 'behavior.ts'], ROOT)
console.log('Clean consumer imports passed in Node, Deno, and Bun.')

async function smoke(): Promise<string> {
  const members = (await workspace.get()).sort()
  const specs: string[] = []
  for (const member of members) {
    const npm = JSON.parse(await Deno.readTextFile(`${member}/package.json`)) as {
      name: string
      exports: Record<string, string> | string
    }
    const keys = typeof npm.exports === 'string' ? ['.'] : Object.keys(npm.exports)
    for (const key of keys.sort()) {
      specs.push(key === '.' ? npm.name : `${npm.name}/${key.replace(/^\.\//u, '')}`)
    }
  }
  const required: Record<string, readonly string[]> = {
    '@okikio/rdf': ['dataset', 'namedNode', 'quad'],
    '@okikio/sparql': ['select', 'update'],
    '@okikio/vocab': ['compile'],
    '@okikio/triplestore': ['Store'],
    '@okikio/rdf/jsonld': ['parse', 'expand'],
    '@okikio/rdf/canon': ['canonicalize'],
    '@okikio/rdf/xml': ['parse'],
    '@okikio/rdf/rdfa': ['parse'],
    '@okikio/rdf/microdata': ['parse'],
    '@okikio/oxigraph': ['create'],
    '@okikio/comunica': ['create'],
  }
  return `import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import * as paths from 'node:path'
import { fileURLToPath } from 'node:url'
const installed = realpathSync(fileURLToPath(new URL('./node_modules/', import.meta.url)))
/** Check path components after realpath resolves aliases and links; Windows paths may differ in case or separators. */
function inside(root: string, entry: string, path: Pick<typeof paths, 'relative' | 'sep' | 'isAbsolute'> = paths): boolean {
  const value = path.relative(root, entry)
  return value !== '' && value !== '..' && !value.startsWith('..' + path.sep) && !path.isAbsolute(value)
}
// Platform-independent controls distinguish installed descendants from siblings, parent paths and other drives/shares.
for (const [path, root, entry, expected] of [
  [paths.win32, 'D:/a/consumer/node_modules', paths.win32.join('d:/a/consumer/node_modules', '@okikio/rdf/mod.js'), true],
  [paths.win32, 'D:/a/consumer/node_modules', 'D:/a/consumer/node_modules-old/rdf/mod.js', false],
  [paths.win32, 'D:/a/consumer/node_modules', 'D:/a/consumer/source/mod.js', false],
  [paths.win32, 'D:/a/consumer/node_modules', 'E:/a/consumer/node_modules/rdf/mod.js', false],
  [paths.win32, '//server/share/node_modules', '//other/share/node_modules/rdf/mod.js', false],
  [paths.posix, '/a/node_modules', '/a/node_modules/rdf/mod.js', true],
  [paths.posix, '/a/node_modules', '/a/node_modules-old/rdf/mod.js', false],
  [paths.posix, '/a/node_modules', '/a/source/mod.js', false],
  [paths.posix, '/a/node_modules', '/a/node_modules', false],
] as const) assert.equal(inside(root, entry, path), expected)
const specs = ${JSON.stringify(specs, null, 2)}
const required = ${JSON.stringify(required, null, 2)}
for (const spec of specs) {
  const path = realpathSync(fileURLToPath(import.meta.resolve(spec)))
  if (!inside(installed, path)) throw new Error(\`Public entry resolves outside installed artifacts: \${spec}: \${path} (root: \${installed})\`)
  const mod = await import(spec)
  if (Object.keys(mod).length === 0 && spec !== '@okikio/vocab/standard') throw new Error(\`Public entry point exported nothing: \${spec}\`)
}
for (const [spec, names] of Object.entries(required)) {
  const mod = await import(spec)
  for (const name of names) if (!(name in mod)) throw new Error(\`Missing \${spec} export: \${name}\`)
}
console.log(\`Imported \${specs.length} installed public entry points.\`)
`
}

async function exists(path: string): Promise<boolean> {
  return (await optional(() => Deno.stat(path))) !== undefined
}

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    ...(cwd ? { cwd } : {}),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  if (!status.success) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${status.code}.`)
  }
}

export {}
