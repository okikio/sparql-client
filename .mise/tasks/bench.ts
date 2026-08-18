/** Runs every package-owned Mitata benchmark in an isolated Deno process. @module */

const ROOT = 'packages'
const SUFFIX = '_bench.ts'

const files = await find(ROOT)
if (files.length === 0) throw new Error(`No ${SUFFIX} benchmark files found under ${ROOT}.`)

for (const file of files) {
  console.log(`\n# ${file}`)
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-env=BENCH_FORMAT,BENCH_LARGE', file],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  if (!status.success) throw new Error(`Benchmark failed (${status.code}): ${file}`)
}

/** Finds package benchmark programs recursively in deterministic path order. */
async function find(root: string): Promise<string[]> {
  const files: string[] = []
  await visit(root, files)
  return files.sort()
}

/** Walks one package directory without adding a filesystem helper dependency to the workspace. */
async function visit(root: string, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) {
      await visit(path, files)
    } else if (entry.isFile && entry.name.endsWith(SUFFIX)) {
      files.push(path)
    }
  }
}

export {}
