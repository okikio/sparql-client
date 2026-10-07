/** Runs every package-owned Mitata benchmark in an isolated Deno process. @module */

import { plan } from './benchmarks.ts'
import { collect } from './bench-command.ts'

const ROOT = 'packages'
const SUFFIX = '_bench.ts'
const preflight = Deno.args.includes('--check')
if (Deno.args.some((value) => value !== '--check')) {
  throw new TypeError('Unknown benchmark argument.')
}

const files = await find(ROOT)
if (files.length === 0) throw new Error(`No ${SUFFIX} benchmark files found under ${ROOT}.`)

for (const { file, name, env } of plan(files, Deno.env.get('BENCH_LARGE') === '1')) {
  console.log(`\n# ${name}`)
  const output = await collect(Deno.execPath(), [
    'run',
    '--v8-flags=--expose-gc',
    '--allow-env',
    '--allow-read=node_modules,packages',
    file,
  ], { env: { ...env, BENCH_PREFLIGHT_ONLY: preflight ? '1' : '0' } })
  // A file write can accept only a prefix; retain every diagnostic byte.
  for (
    const [stream, bytes] of [[Deno.stdout, output.stdout], [Deno.stderr, output.stderr]] as const
  ) {
    for (let offset = 0; offset < bytes.length;) {
      offset += await stream.write(bytes.subarray(offset))
    }
  }
  if (!output.success) {
    throw new Error(`Benchmark failed (${output.code ?? 'no reported exit'}): ${file}`, {
      cause: output.error,
    })
  }
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
