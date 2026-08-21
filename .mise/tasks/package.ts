/** Audits workspace package metadata and creates the exact npm tarballs used by consumer tests. @module */

import * as workspace from './workspace.ts'

const ROOT = '.tmp/packages'
const packages = await workspace.get()
await Deno.remove(ROOT, { recursive: true }).catch(() => undefined)
await Deno.mkdir(ROOT, { recursive: true })

for (const member of packages) {
  const npm = await json(`${member}/package.json`)
  const jsr = await json(`${member}/deno.json`)
  if (npm.name !== jsr.name) throw new Error(`${member}: package and Deno names differ.`)
  if (npm.version !== jsr.version) throw new Error(`${member}: package and Deno versions differ.`)
  sameExports(member, npm.exports, jsr.exports)
  for (const target of Object.values(asExports(jsr.exports))) {
    const path = `${member}/${String(target).replace(/^\.\//u, '')}`
    const info = await Deno.stat(path).catch(() => undefined)
    if (!info?.isFile) throw new Error(`${member}: export target does not exist: ${path}`)
  }

  const filename = `${String(npm.name).replace(/^@/u, '').replace('/', '-')}-${npm.version}.tgz`
  await run(Deno.execPath(), ['pack', '--allow-dirty', '--output', `../../${ROOT}/${filename}`], member)
}

await run(Deno.execPath(), ['publish', '--dry-run', '--allow-dirty'])
console.log(`Packed ${packages.length} workspace packages into ${ROOT}.`)


function sameExports(member: string, left: unknown, right: unknown): void {
  if (JSON.stringify(asExports(left)) !== JSON.stringify(asExports(right))) {
    throw new Error(`${member}: package.json and deno.json exports differ.`)
  }
}

function asExports(value: unknown): Record<string, string> {
  if (typeof value === 'string') return { '.': value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('exports must be a string map.')
  }
  const result: Record<string, string> = {}
  for (const [key, target] of Object.entries(value)) {
    if (typeof target !== 'string') {
      throw new TypeError(`Export '${key}' must point directly to one source file.`)
    }
    result[key] = target
  }
  return result
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>
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
