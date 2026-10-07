/** Audits workspace package metadata and creates the exact npm tarballs used by consumer tests. @module */

import { exportMap as asExports, sameExports } from '../../conformance/exports.ts'
import { optional } from './files.ts'
import * as workspace from './workspace.ts'
import * as artifacts from './artifacts.ts'

const ROOT = '.tmp/packages'
const packages = await workspace.get()
const inputs = await artifacts.identity()
const versions = new Map<string, string>()
for (const member of packages) {
  const metadata = await json(`${member}/package.json`)
  versions.set(String(metadata.name), String(metadata.version))
}
await optional(() => Deno.remove(ROOT, { recursive: true }))
await Deno.mkdir(ROOT, { recursive: true })

for (const member of packages) {
  const npm = await json(`${member}/package.json`)
  const jsr = await json(`${member}/deno.json`)
  if (npm.name !== jsr.name) throw new Error(`${member}: package and Deno names differ.`)
  if (npm.version !== jsr.version) throw new Error(`${member}: package and Deno versions differ.`)
  if (!sameExports(npm.exports, jsr.exports)) {
    throw new Error(`${member}: package.json and deno.json exports differ.`)
  }
  for (const target of Object.values(asExports(jsr.exports))) {
    const path = `${member}/${String(target).replace(/^\.\//u, '')}`
    const info = await Deno.stat(path)
    if (!info.isFile) throw new Error(`${member}: export target is not a file: ${path}`)
  }

  const filename = `${String(npm.name).replace(/^@/u, '').replace('/', '-')}-${npm.version}.tgz`
  // Preserve emitted JavaScript exports: the source npm manifest otherwise
  // overwrites them as a second package.json archive entry.
  await run(Deno.execPath(), [
    'pack',
    '--allow-dirty',
    '--ignore=package.json',
    '--output',
    `../../${ROOT}/${filename}`,
  ], member)
  const staging = `${ROOT}/${filename}.stage`
  await Deno.mkdir(staging)
  await run('tar', ['-xzf', `${ROOT}/${filename}`, '-C', staging])
  const generated = await json(`${staging}/package/package.json`)
  await Deno.writeTextFile(
    `${staging}/package/package.json`,
    `${
      JSON.stringify(
        {
          ...npm,
          ...generated,
          ...(npm.dependencies ? { dependencies: dependencies(npm.dependencies) } : {}),
        },
        null,
        2,
      )
    }\n`,
  )
  // Keep host extended attributes out of the archive's PAX headers too.
  await run('tar', ['-czf', `${ROOT}/${filename}`, '--no-xattrs', '-C', staging, 'package'])
  await Deno.remove(staging, { recursive: true })
}

await run(Deno.execPath(), ['publish', '--dry-run', '--allow-dirty'])
await artifacts.save(inputs)
console.log(`Packed ${packages.length} workspace packages into ${ROOT}.`)

/** Resolves development workspace references to actual versions in npm archives. */
function dependencies(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('dependencies must be a version map.')
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, range]: [string, unknown]) => {
      if (typeof range !== 'string') {
        throw new TypeError(`Dependency ${name} has no version string.`)
      }
      if (!range.startsWith('workspace:')) return [name, range]
      const version = versions.get(name)
      if (!version) throw new Error(`Workspace dependency ${name} is absent from the package set.`)
      return [name, version]
    }),
  )
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>
}

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    ...(cwd ? { cwd } : {}),
    // BSD tar otherwise writes macOS extended attributes as AppleDouble members.
    // This child-only setting is harmless on tar implementations that ignore it.
    ...(command === 'tar' ? { env: { COPYFILE_DISABLE: '1' } } : {}),
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
