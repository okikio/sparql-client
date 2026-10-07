/** Runs serial Mitata programs and preserves raw samples, failures, and reproduction metadata. @module */

import { arch, cpus, platform, release, totalmem } from 'node:os'
import { assertStable, identity } from './bench-identity.ts'
import { plan } from './benchmarks.ts'
import { validateMitata } from '../../bench/validate.ts'
import { collect } from './bench-command.ts'

/** Every invocation retains its own evidence, including unsuccessful benchmark programs. */
const OUT = `.tmp/reports/bench/${new Date().toISOString().replaceAll(':', '-')}`
await Deno.mkdir(OUT, { recursive: true })
const files = await find('packages', '_bench.ts')
if (files.length === 0) throw new Error('No package benchmark programs found.')
const workloads = plan(files, Deno.env.get('BENCH_LARGE') === '1')
/** Source and dependency identities distinguish samples collected before and after a repair. */
const inputs = await identity()
const meta = {
  version: 3,
  status: 'running' as 'running' | 'pass' | 'fail' | 'invalid',
  failure: undefined as string | undefined,
  inputsAfter: undefined as Readonly<Record<string, string>> | undefined,
  createdAt: new Date().toISOString(),
  runtime: Deno.version,
  host: {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    memoryBytes: totalmem(),
  },
  large: Deno.env.get('BENCH_LARGE') === '1',
  inputs,
  runs: [] as Array<{
    file: string
    name: string
    env: Readonly<Record<string, string>>
    args: readonly string[]
    report: string
    stderr: string
    elapsedMs: number
    exitCode: number | null
    status: 'pass' | 'fail'
  }>,
}
await save()
const failures: unknown[] = []
try {
  for (const { file, name, env } of workloads) {
    const report = `${OUT}/${name}.json`
    const stderr = `${OUT}/${name}.stderr`
    const args = [
      'run',
      '--v8-flags=--expose-gc',
      '--allow-env',
      '--allow-read=node_modules,packages',
      file,
    ]
    console.log(`Starting ${name}.`)
    const start = performance.now()
    const output = await collect(Deno.execPath(), args, {
      env: { BENCH_FORMAT: 'json', BENCH_PREFLIGHT_ONLY: '0', ...env },
    })
    await Deno.writeFile(report, output.stdout)
    await Deno.writeFile(stderr, output.stderr)
    let validationFailed = false
    let validationFailure: unknown
    try {
      if (!output.success) {
        throw new Error(
          `Benchmark failed (${output.code ?? 'no reported exit'}): ${file}. See ${stderr}.`,
          { cause: output.error },
        )
      }
      validateMitata(JSON.parse(new TextDecoder().decode(output.stdout)))
    } catch (error) {
      validationFailed = true
      validationFailure = error
    }
    meta.runs.push({
      file,
      name,
      env,
      args,
      report,
      stderr,
      elapsedMs: performance.now() - start,
      exitCode: output.code,
      status: output.success && !validationFailed ? 'pass' : 'fail',
    })
    await save(validationFailed ? [validationFailure] : [])
    if (validationFailed) throw validationFailure
    console.log(`Recorded ${name} in ${OUT}.`)
  }
  meta.inputsAfter = await identity()
  try {
    assertStable(inputs, meta.inputsAfter)
  } catch {
    meta.status = 'invalid'
    throw new Error(
      `Source or dependency inputs changed during measurement. Discard timings in ${OUT}.`,
    )
  }
  meta.status = 'pass'
  console.log(`Stored ${workloads.length} raw Mitata reports in ${OUT}.`)
} catch (error) {
  if (meta.status !== 'invalid') meta.status = 'fail'
  meta.failure = error instanceof Error ? error.stack ?? error.message : String(error)
  failures.push(error)
} finally {
  try {
    await save()
  } catch (error) {
    failures.push(error)
    if (meta.status !== 'invalid') meta.status = 'fail'
    console.error('Native benchmark final evidence write failed:', error)
  }
}
if (failures.length) throw new AggregateError(failures, 'Native benchmark or evidence failed.')

/** Writes progress after each program so a later failure cannot erase earlier evidence. */
async function save(primary: readonly unknown[] = []): Promise<void> {
  try {
    await Deno.writeTextFile(`${OUT}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`)
  } catch (error) {
    throw new AggregateError([...primary, error], 'Native benchmark evidence write failed.')
  }
}
/** Finds matching files recursively in deterministic path order. */
async function find(root: string, suffix: string): Promise<string[]> {
  const files: string[] = []
  await visit(root, suffix, files)
  return files.sort()
}
/** Visits source directories without introducing a filesystem dependency into the package graph. */
async function visit(root: string, suffix: string, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) await visit(path, suffix, files)
    else if (entry.isFile && entry.name.endsWith(suffix)) files.push(path)
  }
}
export {}
