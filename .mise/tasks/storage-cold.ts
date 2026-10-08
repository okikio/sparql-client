/**
 * Measures fresh-process packed OPFS import and RDF recovery, without claiming cold OS caches.
 *
 * After consumer:storage installs the seven current archives, run
 * deno task bench:storage.
 * STORAGE_COLD_CONSUMER selects that installed consumer. STORAGE_COLD_REPORT selects a retained report base;
 * each invocation atomically acquires a unique child directory there. Without it, an owned temporary directory is used.
 * @module
 */
import { arch, cpus, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** A successful child must expose every timed phase and the exact independent correctness oracle. */
interface SampleType {
  readonly modules: Readonly<Record<string, string>>
  readonly mode: 'prepare' | 'sample'
  readonly runtime: string
  readonly versions: Readonly<Record<string, string>>
  readonly oracle: {
    readonly bytes: number
    readonly rangeBytes: number
    readonly quads: number
    readonly generation: number
    readonly borrowedFsUsable: boolean
  }
  readonly timings: Readonly<Record<string, number>>
}

/** Retain launch-to-exit wall separately; subtracting child phases would not isolate runtime startup reliably. */
interface RunType extends SampleType {
  readonly sample: number
  readonly launchToExitMs: number
}

const consumer = resolve(Deno.env.get('STORAGE_COLD_CONSUMER') ?? '.tmp/storage-consumer')
const count = Number(Deno.env.get('STORAGE_COLD_SAMPLES') ?? '12')
if (!Number.isSafeInteger(count) || count < 12) {
  throw new Error('Use at least 12 independent samples per runtime.')
}
const reportBase = Deno.env.get('STORAGE_COLD_REPORT')
if (reportBase !== undefined) await Deno.mkdir(resolve(reportBase), { recursive: true })
const output = await Deno.makeTempDir(
  reportBase === undefined ? { prefix: 'storage-cold-report-' } : {
    dir: resolve(reportBase),
    prefix: `${new Date().toISOString().replaceAll(':', '-')}-`,
  },
)
const script = join(consumer, 'cold.ts')
await Deno.copyFile('integration/storage/cold.ts', script)
const inputs = await identity()
await verifyArchives()
const data = await Deno.makeTempDir({ prefix: 'storage-cold-fixture-' })
const meta = {
  schemaVersion: 1,
  status: 'running',
  createdAt: new Date().toISOString(),
  consumer,
  sampleCountPerRuntime: count,
  units: 'milliseconds',
  host: { os: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model },
  method:
    'fresh serial process per sample; fixtures prepared once before timing; no samples trimmed or dropped',
  cache: 'fresh process/module state; filesystem/OS caches warm or unknown; no cache flush',
  phases:
    'launchToExitMs includes runtime startup and the entire child; child phases isolate explicit operations',
  percentile:
    'sorted samples; h=(n-1)*p; linear interpolation between floor(h) and ceil(h), including p95 and p99',
  inputs,
  fixture: {} as Readonly<Record<string, string>>,
  runs: [] as RunType[],
  summaries: [] as Array<{
    runtime: string
    phase: string
    sampleCount: number
    minMs: number
    medianMs: number
    p95InterpolatedMs: number
    p99InterpolatedMs: number
    maxMs: number
  }>,
  failure: undefined as string | undefined,
}
/** Error membership preserves failures whose rejection reason is undefined. */
const failures: unknown[] = []
try {
  await save()
  // Exactly one setup child commits persistent bytes, a compacted snapshot and a newer delta.
  // Its invocation and observations are excluded from the timed sample distribution.
  const prepared = await invoke('node', [script, 'prepare', data])
  await Deno.writeTextFile(join(output, 'prepare.json'), prepared.stdout)
  await Deno.writeTextFile(join(output, 'prepare.stderr'), prepared.stderr)
  const preparation = JSON.parse(prepared.stdout)
  validate(preparation, 'prepare', 'node')
  meta.fixture = await tree(data)
  for (
    const [runtime, command, args] of [
      ['node', 'node', [script, 'sample', data]],
      ['deno', Deno.execPath(), [
        'run',
        '--no-config',
        '--node-modules-dir=manual',
        '--allow-read',
        '--allow-write',
        '--allow-env',
        script,
        'sample',
        data,
      ]],
      ['bun', 'bun', ['run', script, 'sample', data]],
    ] as const
  ) {
    for (let sample = 0; sample < count; sample++) {
      const started = performance.now()
      const result = await invoke(command, args)
      const launchToExitMs = performance.now() - started
      await Deno.writeTextFile(join(output, `${runtime}-${sample}.json`), result.stdout)
      await Deno.writeTextFile(join(output, `${runtime}-${sample}.stderr`), result.stderr)
      const row: SampleType = JSON.parse(result.stdout)
      validate(row, 'sample', runtime)
      meta.runs.push({ ...row, sample, launchToExitMs })
      await save()
    }
  }
  if (JSON.stringify(inputs) !== JSON.stringify(await identity())) {
    throw new Error(
      'Installed packages, archives or benchmark definitions changed during measurement.',
    )
  }
  if (JSON.stringify(meta.fixture) !== JSON.stringify(await tree(data))) {
    throw new Error('Cold read/recovery consumers changed the persistent fixture.')
  }
  for (const runtime of ['node', 'deno', 'bun']) {
    const rows = meta.runs.filter((row) => row.runtime === runtime)
    for (const phase of ['launchToExitMs', ...Object.keys(rows[0]!.timings)]) {
      const samples = rows.map((row) =>
        phase === 'launchToExitMs' ? row.launchToExitMs : row.timings[phase]!
      )
        .sort((left, right) => left - right)
      meta.summaries.push({
        runtime,
        phase,
        sampleCount: samples.length,
        minMs: samples[0]!,
        medianMs: percentile(samples, 0.5),
        p95InterpolatedMs: percentile(samples, 0.95),
        p99InterpolatedMs: percentile(samples, 0.99),
        maxMs: samples.at(-1)!,
      })
    }
  }
  meta.status = 'pass'
} catch (error) {
  failures.push(error)
  meta.status = 'fail'
  meta.failure = error instanceof Error ? error.stack ?? error.message : String(error)
} finally {
  // Owned fixture removal always runs before the fallible final diagnostic write.
  try {
    await Deno.remove(data, { recursive: true })
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) {
    meta.status = 'fail'
    meta.failure = failures.map((error) =>
      error instanceof Error ? error.stack ?? error.message : String(error)
    ).join('\n')
  }
  try {
    await save()
  } catch (error) {
    failures.push(error)
    meta.status = 'fail'
    console.error('Cold storage final evidence write failed:', error)
  }
  console.log(`Cold packed storage ${meta.status}: ${output}`)
}
if (failures.length) {
  throw new AggregateError(failures, 'Cold storage workflow or evidence/cleanup failed.')
}

/** Validates every phase and exact byte/RDF/lifetime result before a child can contribute a sample. */
function validate(value: SampleType, mode: string, runtime: string): void {
  if (value.mode !== mode || value.runtime !== runtime) {
    throw new Error('Unexpected child mode or native runtime.')
  }
  const oracle = value.oracle
  if (
    oracle.bytes !== 65_537 || oracle.rangeBytes !== 7 || oracle.quads !== 65 ||
    oracle.generation !== 8 || oracle.borrowedFsUsable !== true
  ) throw new Error('Child did not establish the exact byte/RDF/borrowed-lifetime oracle.')
  const specifiers = [
    '@okikio/opfs',
    `@okikio/opfs/adapter/${runtime}`,
    '@okikio/rdf',
    '@okikio/rdf/nquads',
    '@okikio/triplestore',
    '@okikio/sparql',
    '@okikio/comunica',
    '@okikio/oxigraph',
    '@okikio/vocab',
  ]
  if (
    !value.modules ||
    JSON.stringify(Object.keys(value.modules).sort()) !== JSON.stringify(specifiers.sort())
  ) {
    throw new Error('Child omitted installed package resolution evidence.')
  }
  for (const path of Object.values(value.modules)) {
    if (typeof path !== 'string' || !path.startsWith(join(consumer, 'node_modules') + '/')) {
      throw new Error(`Child resolved outside installed consumer packages: ${path}`)
    }
  }
  const phases = [
    'opfsImportMs',
    'opfsInitMs',
    'opfsReadMs',
    'opfsCloseMs',
    'storeImportMs',
    'storeFsInitMs',
    'storeRecoveryMs',
    'storeVerifyMs',
    'storeCloseMs',
    'storeFsCloseMs',
    'childTotalMs',
  ]
  if (JSON.stringify(Object.keys(value.timings).sort()) !== JSON.stringify(phases.sort())) {
    throw new Error('Child omitted or changed the timing phases.')
  }
  for (const metric of Object.values(value.timings)) {
    if (!Number.isFinite(metric) || metric < 0) throw new Error('Invalid child timing.')
  }
}

/** A deadline prevents a broken cold-open/close implementation from hanging the report forever. */
async function invoke(
  command: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const child = new Deno.Command(command, {
    args: [...args],
    cwd: consumer,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch { /* Process exit can race the deadline. */ }
  }, 30_000)
  try {
    const result = await child.output()
    const stdout = new TextDecoder().decode(result.stdout),
      stderr = new TextDecoder().decode(result.stderr)
    if (!result.success) {
      await Deno.writeTextFile(join(output, 'failed-child.stdout'), stdout)
      await Deno.writeTextFile(join(output, 'failed-child.stderr'), stderr)
      throw new Error(`Cold storage child ${command} exited ${result.code}. ${stderr}`)
    }
    return { stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

/** The seven file-tarball dependencies and installed package bytes must remain identical throughout timing. */
async function identity(): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}
  const dependencies: Record<string, string> = JSON.parse(
    await Deno.readTextFile(join(consumer, 'package.json')),
  ).dependencies
  const names = [
    '@okikio/comunica',
    '@okikio/opfs',
    '@okikio/oxigraph',
    '@okikio/rdf',
    '@okikio/sparql',
    '@okikio/triplestore',
    '@okikio/vocab',
  ]
  if (JSON.stringify(Object.keys(dependencies).sort()) !== JSON.stringify(names.sort())) {
    throw new Error('Install the actual seven storage-consumer tarballs before cold measurements.')
  }
  for (const name of names) {
    const specifier = dependencies[name]!
    if (!specifier.startsWith('file:') || !specifier.endsWith('.tgz')) {
      throw new Error(`Expected an actual packed tarball for ${name}.`)
    }
    const archive = resolve(consumer, specifier.slice(5))
    result[archive] = await hash(archive)
    const installed = join(consumer, 'node_modules', name)
    if ((await Deno.lstat(installed)).isSymlink) {
      throw new Error(`Source symlink is not a packed artifact: ${name}.`)
    }
    Object.assign(result, await tree(installed))
  }
  for (
    const file of [
      join(consumer, 'package.json'),
      script,
      resolve('integration/storage/cold.ts'),
      resolve('.mise/tasks/storage-cold.ts'),
    ]
  ) result[file] = await hash(file)
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  )
}

/** Refuses a stale installation even when a newer archive reused the same version and filename. */
async function verifyArchives(): Promise<void> {
  const dependencies: Record<string, string> = JSON.parse(
    await Deno.readTextFile(join(consumer, 'package.json')),
  ).dependencies
  const root = await Deno.makeTempDir({ prefix: 'storage-cold-archives-' })
  let failed = false
  let primary: unknown
  try {
    for (const [name, specifier] of Object.entries(dependencies)) {
      const destination = join(root, name)
      await Deno.mkdir(destination, { recursive: true })
      const extracted = await new Deno.Command('tar', {
        args: ['-xzf', resolve(consumer, specifier.slice(5)), '-C', destination],
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!extracted.success) {
        throw new Error(
          `Could not inspect archive ${name}: ${new TextDecoder().decode(extracted.stderr)}`,
        )
      }
      const packaged = join(destination, 'package')
      for (const [file, digest] of Object.entries(await tree(packaged))) {
        const installed = join(consumer, 'node_modules', name, file.slice(packaged.length + 1))
        if (await hash(installed) !== digest) {
          throw new Error(
            `Installed artifact differs from current archive: ${installed}. Reinstall consumer:storage.`,
          )
        }
      }
    }
  } catch (error) {
    failed = true
    primary = error
    throw error
  } finally {
    await removeOwned(root, failed ? [primary] : [])
  }
}

/** Removes inspection scratch space while keeping a prior archive/identity failure as the first reason. */
async function removeOwned(root: string, primary: readonly unknown[]): Promise<void> {
  try {
    await Deno.remove(root, { recursive: true })
  } catch (error) {
    throw new AggregateError([...primary, error], 'Cold storage archive inspection cleanup failed.')
  }
}

/** Hashes all committed fixture/package files, excluding no data that could change the observed recovery. */
async function tree(root: string): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}
  for await (const entry of Deno.readDir(root)) {
    const file = join(root, entry.name)
    if (entry.isDirectory) Object.assign(result, await tree(file))
    else if (entry.isFile) result[file] = await hash(file)
    else throw new Error(`Unexpected non-file artifact: ${file}.`)
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  )
}

/** Computes immutable byte identity without importing a production processor into the parent runner. */
async function hash(file: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', await Deno.readFile(file))
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

/** Uses explicitly interpolated quantiles; all independent samples remain in the report. */
function percentile(samples: readonly number[], probability: number): number {
  const index = (samples.length - 1) * probability
  const low = Math.floor(index), high = Math.ceil(index)
  return samples[low]! + (index - low) * (samples[high]! - samples[low]!)
}

/** Records each completed sample and preserves a failure rather than silently shortening a distribution. */
async function save(): Promise<void> {
  await Deno.mkdir(dirname(join(output, 'report.json')), { recursive: true })
  await Deno.writeTextFile(join(output, 'report.json'), `${JSON.stringify(meta, null, 2)}\n`)
}
