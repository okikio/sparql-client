/** Native benchmark provenance excludes unrelated tests and the separately measured compiler lane. @module */
import { join } from 'node:path'

/** Hash runtime source, native workload definitions and their command/configuration authority. */
export async function identity(root = '.'): Promise<Readonly<Record<string, string>>> {
  const paths: string[] = [
    'deno.json',
    'deno.lock',
    'package.json',
    '.mise/tasks/bench-report.ts',
    '.mise/tasks/benchmarks.ts',
    '.mise/tasks/bench.ts',
    '.mise/tasks/bench-identity.ts',
    '.mise/tasks/bench-command.ts',
  ]
  for (const directory of ['packages', 'bench']) await visit(root, directory, paths)
  const result: Record<string, string> = {}
  for (const path of paths.sort()) {
    const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(join(root, path)))
    result[path] = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  return result
}

/** A changed measured dependency/configuration invalidates collected timings. */
export function assertStable(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): void {
  const keys = Object.keys(before).sort()
  const current = Object.keys(after).sort()
  if (
    keys.length !== current.length ||
    keys.some((key, index) => key !== current[index] || before[key] !== after[key])
  ) {
    throw new Error('Source or dependency inputs changed during measurement. Discard timings.')
  }
}

/** Hash timed fixtures too: store recovery borrows the development-only MemoryFileSystem module. */
async function visit(root: string, directory: string, paths: string[]): Promise<void> {
  for await (const entry of Deno.readDir(join(root, directory))) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory) await visit(root, path, paths)
    else if (entry.isFile && (entry.name === 'deno.json' || entry.name === 'package.json')) {
      paths.push(path)
    } else if (
      entry.isFile && entry.name.endsWith('.ts') &&
      (!entry.name.endsWith('_test.ts') || path === 'packages/triplestore/_memory_test.ts') &&
      path !== 'bench/vocab/types.ts' && path !== 'bench/vocab/diagnostics.ts'
    ) paths.push(path)
  }
}
