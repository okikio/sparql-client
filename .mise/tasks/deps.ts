/** Verifies that project-owned core packages do not import third-party runtime implementations. @module */

/** Core package directories that must remain independent of third-party runtime implementations. */
const CORE = ['rdf', 'sparql', 'vocab', 'triplestore'] as const
/** Project package specifiers that core code can import directly. */
const ALLOWED = ['@okikio/rdf', '@okikio/sparql', '@okikio/vocab', '@okikio/triplestore'] as const

/** Dependency-policy failures collected across package manifests and production source files. */
const errors: string[] = []

for (const name of CORE) {
  for await (const file of files(`packages/${name}`)) {
    const source = await Deno.readTextFile(file)
    if (/\bimport\s*\(\s*['"`]/u.test(source)) {
      errors.push(`${file}: dynamic imports are not allowed in the core production graph`)
    }
    for (const specifier of imports(source)) {
      if (allowed(specifier)) continue
      errors.push(`${file}: core runtime import '${specifier}' is not allowed`)
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

/** Returns true when a specifier is relative or addresses one of the project-owned core packages. */
function allowed(specifier: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return true
  return ALLOWED.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

/** Yields production TypeScript files while excluding tests and benchmark definitions. */
async function* files(root: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) yield* files(path)
    else if (
      entry.isFile && entry.name.endsWith('.ts') && !/_(?:test|bench)\.ts$/u.test(entry.name)
    ) yield path
  }
}

/** Returns static module specifiers from formatted TypeScript import and re-export declarations. */
function imports(source: string): string[] {
  const output: string[] = []
  let statement = ''

  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!statement) {
      if (!line.startsWith('import ') && !line.startsWith('export ')) continue
      statement = line
    } else {
      statement += ` ${line}`
    }

    const sideEffect = statement.match(/^import\s+(['"])([^'"]+)\1/u)
    const from = statement.match(/\bfrom\s+(['"])([^'"]+)\1/u)
    if (sideEffect) {
      output.push(sideEffect[2]!)
      statement = ''
      continue
    }
    if (from) {
      output.push(from[2]!)
      statement = ''
      continue
    }

    // Formatted multiline import/export declarations continue while braces remain open.
    if (!/[{,]\s*$/u.test(line) && !line.startsWith('export {') && !line.startsWith('import {')) {
      statement = ''
    }
  }

  return output
}

export {}
