/** Installs packed workspace artifacts into a clean project and imports every public entry point in Node, Deno, and Bun. @module */

const PACK = '.tmp/packages'
const ROOT = '.tmp/consumer'
if (!(await exists(PACK))) await run(Deno.execPath(), ['task', 'package'])
await Deno.remove(ROOT, { recursive: true }).catch(() => undefined)
await Deno.mkdir(ROOT, { recursive: true })

const tarballs: string[] = []
for await (const entry of Deno.readDir(PACK)) {
  if (entry.isFile && entry.name.endsWith('.tgz')) tarballs.push(`../packages/${entry.name}`)
}
tarballs.sort()
if (tarballs.length === 0) {
  throw new Error('No package tarballs found. Run deno task package first.')
}

await Deno.writeTextFile(`${ROOT}/package.json`, '{"private":true,"type":"module"}\n')
await run('npm', [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--no-package-lock',
  ...tarballs,
], ROOT)
await Deno.writeTextFile(`${ROOT}/smoke.ts`, await smoke())

await run('node', ['smoke.ts'], ROOT)
await run(Deno.execPath(), ['run', '--node-modules-dir=manual', 'smoke.ts'], ROOT)
await run('bun', ['run', 'smoke.ts'], ROOT)
console.log('Clean consumer imports passed in Node, Deno, and Bun.')

async function smoke(): Promise<string> {
  const members = (await workspace()).sort()
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
  return `const specs = ${JSON.stringify(specs, null, 2)}\nconst required = ${
    JSON.stringify(required, null, 2)
  }\nfor (const spec of specs) {\n  const mod = await import(spec)\n  if (Object.keys(mod).length === 0) throw new Error(\`Public entry point exported nothing: \${spec}\`)\n}\nfor (const [spec, names] of Object.entries(required)) {\n  const mod = await import(spec)\n  for (const name of names) if (!(name in mod)) throw new Error(\`Missing \${spec} export: \${name}\`)\n}\nconsole.log(\`Imported \${specs.length} public entry points.\`)\n`
}

async function workspace(): Promise<string[]> {
  const root = JSON.parse(await Deno.readTextFile('deno.json')) as { workspace: string[] }
  return root.workspace.map((value) => value.replace(/^\.\//u, ''))
}

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false)
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
