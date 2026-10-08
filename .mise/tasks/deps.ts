/** Verifies that project-owned core packages do not import third-party runtime implementations. @module */

import { fromFileUrl, toFileUrl } from '@std/path'
import { get } from './sources.ts'
import { ownedModule, repository } from '../../conformance/ownership.ts'
import { allowed, dependencyErrors, references } from '../../conformance/modules.ts'

/** Core package directories that must remain independent of third-party runtime implementations. */
const CORE = ['rdf', 'sparql', 'vocab', 'triplestore'] as const
/** Dependency-policy failures collected across package manifests and production source files. */
const errors: string[] = []

const sources = await get('.', 'production')
for (const name of CORE) {
  for (const file of sources.filter((path) => path.startsWith(`packages/${name}/`))) {
    const source = await Deno.readTextFile(file)
    for (const error of dependencyErrors(source, file)) errors.push(`${file}: ${error}`)
    for (const reference of references(source, file)) {
      if (
        reference.kind !== 'runtime' || !reference.specifier ||
        !(reference.specifier.startsWith('./') || reference.specifier.startsWith('../'))
      ) continue
      try {
        const target = new URL(reference.specifier, new URL(file, repository))
        const physical = toFileUrl(await Deno.realPath(fromFileUrl(target))).href
        if (!ownedModule(physical)) {
          errors.push(`${file}: relative import escapes owned core source: ${reference.specifier}`)
        }
      } catch (error) {
        errors.push(
          `${file}: cannot establish relative import ownership for '${reference.specifier}': ${
            String(error)
          }`,
        )
      }
    }
  }

  const manifest = JSON.parse(await Deno.readTextFile(`packages/${name}/package.json`)) as {
    /** Runtime dependencies declared by the npm package manifest. */
    readonly dependencies?: Readonly<Record<string, string>>
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (allowed(dependency)) continue
    errors.push(
      `packages/${name}/package.json: core runtime dependency '${dependency}' is not allowed`,
    )
  }
}

if (errors.length > 0) {
  throw new Error(
    `Core dependency firewall failed:\n${errors.map((value) => `- ${value}`).join('\n')}`,
  )
}
console.log(`Verified ${CORE.length} dependency-free core package graphs.`)
