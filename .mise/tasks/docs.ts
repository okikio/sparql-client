/** Runs Deno's built-in documentation diagnostics across every production package source file. @module */

/** Production TypeScript files passed to `deno doc`; private declarations are included in the generated documentation model. */
const sources: string[] = []
for await (const file of files('packages')) sources.push(file)
sources.sort()

const child = new Deno.Command(Deno.execPath(), {
  args: ['doc', '--private', '--lint', ...sources],
  stdin: 'null',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()
const status = await child.status
if (!status.success) throw new Error(`Documentation lint failed with exit code ${status.code}.`)
console.log(`Documentation lint passed for ${sources.length} production source files.`)

/** Yields production TypeScript files and excludes tests, property suites, and benchmark definitions. */
async function* files(root: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) yield* files(path)
    else if (
      entry.isFile && entry.name.endsWith('.ts') &&
      !/_(?:test|property_test|bench)\.ts$/u.test(entry.name)
    ) yield path
  }
}

export {}
