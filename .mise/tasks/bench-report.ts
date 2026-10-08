/** Runs serial Mitata programs and preserves raw samples, failures, and reproduction metadata. @module */

import { arch, cpus, platform, release, totalmem } from 'node:os'
import { assertStable, identity } from './bench-identity.ts'
import { plan } from './benchmarks.ts'
import { validateMitata } from '../../bench/validate.ts'
import { read, spool } from './bench-command.ts'
import type { StreamType } from './bench-command.ts'
import { get } from './sources.ts'

/** Every invocation retains its own evidence, including unsuccessful benchmark programs. */
const parent = '.tmp/reports/bench'
await Deno.mkdir(parent, { recursive: true })
const OUT = await Deno.makeTempDir({
  dir: parent,
  prefix: `${new Date().toISOString().replaceAll(':', '-')}-`,
})
const files = (await get('.', 'benchmark')).filter((path) =>
  path.startsWith('packages/') && path.endsWith('_bench.ts')
)
if (files.length === 0) throw new Error('No package benchmark programs found.')
const workloads = plan(files, Deno.env.get('BENCH_LARGE') === '1')
/** Source and dependency identities distinguish samples collected before and after a repair. */
const inputs = await identity()
const meta = {
  version: 4,
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
  collection: {
    mode: 'file-spool',
    quotaBytesPerStream: 128 * 1024 * 1024,
    timeoutMs: 20 * 60_000,
    elapsedScope:
      'elapsedMs is total runner lifecycle; captureElapsedMs covers acquisition/capture/close, validationElapsedMs covers later admission. Mitata operation samples remain nanoseconds inside the child.',
    validation:
      'Complete admitted raw file parsed outside Mitata callbacks; no measured or calibration samples omitted.',
  },
  inputs,
  runs: [] as Array<{
    file: string
    name: string
    env: Readonly<Record<string, string>>
    args: readonly string[]
    report: string
    stderr: string
    elapsedMs: number
    captureElapsedMs: number
    validationElapsedMs: number
    exitCode: number | null
    signal: string | null
    capture: {
      stdout: StreamType
      stderr: StreamType
      failures: readonly { stage: string; stream?: string; reason: string }[]
    }
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
    const output = await spool(Deno.execPath(), args, { stdout: report, stderr }, {
      env: { BENCH_FORMAT: 'json', BENCH_PREFLIGHT_ONLY: '0', ...env },
      quotaBytes: meta.collection.quotaBytesPerStream,
      timeoutMs: meta.collection.timeoutMs,
    })
    const captureElapsedMs = performance.now() - start
    const validationStart = performance.now()
    let validationFailed = false
    let validationFailure: unknown
    try {
      if (!output.success) {
        throw new Error(
          `Benchmark failed (${output.code ?? 'no reported exit'}): ${file}. See ${stderr}.`,
          { cause: output.error },
        )
      }
      const raw = await read(report, output.stdout.quotaBytes)
      if (raw.byteLength !== output.stdout.retainedBytes) {
        throw new Error('Raw benchmark size changed after complete capture.')
      }
      validateMitata(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
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
      captureElapsedMs,
      validationElapsedMs: performance.now() - validationStart,
      exitCode: output.code,
      signal: output.signal,
      capture: {
        stdout: output.stdout,
        stderr: output.stderr,
        failures: output.failures.map(({ stage, stream, reason }) => ({
          stage,
          ...(stream === undefined ? {} : { stream }),
          reason: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
        })),
      },
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
export {}
