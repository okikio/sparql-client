/** Exercises the current OPFS checkout as a borrowed triplestore filesystem. @module */

import { dirname, fromFileUrl, join, resolve, toFileUrl } from '@std/path'

/** Repository root, independent of the directory from which mise is invoked. */
const root = resolve(dirname(fromFileUrl(import.meta.url)), '../..')
/** Explicit source selection permits CI to place the sibling checkout elsewhere. */
const source = resolve(Deno.env.get('OPFS_SOURCE') ?? join(root, '../opfs'))
/** OPFS owns its runtime dependencies; the integration does not copy production implementations. */
const storage = JSON.parse(await Deno.readTextFile(join(source, 'deno.json'))) as {
  imports: Record<string, string>
}
/** The RDF repository still owns its package aliases and compiler contract. */
const project = JSON.parse(await Deno.readTextFile(join(root, 'deno.json'))) as {
  imports: Record<string, string>
  compilerOptions: Record<string, unknown>
}
/** Task-local imports let both checked-out source graphs resolve without publication. */
const imports: Record<string, string> = { ...storage.imports, ...project.imports }
for await (const entry of Deno.readDir(join(root, 'packages'))) {
  if (!entry.isDirectory) continue
  const path = join(root, 'packages', entry.name)
  const member = JSON.parse(await Deno.readTextFile(join(path, 'deno.json'))) as {
    name: string
    exports: Record<string, string>
  }
  for (const [key, target] of Object.entries(member.exports)) {
    imports[key === '.' ? member.name : `${member.name}/${key.slice(2)}`] =
      toFileUrl(join(path, target)).href
  }
}
/** Generated configuration is disposable output; this task remains its authoritative source. */
const output = join(root, '.tmp/storage')
await Deno.mkdir(output, { recursive: true })
await Deno.writeTextFile(
  join(output, 'deno.json'),
  JSON.stringify({ imports, compilerOptions: project.compilerOptions, nodeModulesDir: 'auto' }),
)
/** Sanitizers observe real files/KV handles and fail leaks rather than relying on close calls. */
const child = new Deno.Command(Deno.execPath(), {
  cwd: root,
  args: [
    'test',
    '--config',
    join(output, 'deno.json'),
    '--unstable-kv',
    '--allow-read',
    '--allow-write',
    '--allow-env=OPFS_SOURCE',
    '--sanitize-ops',
    '--sanitize-resources',
    '--trace-leaks',
    'integration/storage/mod_test.ts',
  ],
  env: { OPFS_SOURCE: source },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()
const status = await child.status
if (!status.success) {
  throw new Error(`OPFS triplestore integration failed with exit code ${status.code}.`)
}
