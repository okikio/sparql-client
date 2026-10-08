/** Installs both repositories' artifacts and tests storage composition in host and Linux runtimes. @module */
import { resolve } from '@std/path'
import { optional } from './files.ts'
import * as artifacts from './artifacts.ts'
import * as container from './container.ts'
import { collect } from './command.ts'
import type { OutputType } from './command.ts'

/** A command failure retains structured output and its reported or unresolved exit status. */
class InvocationError extends Error {
  /** Exit status, or null when the deadline arrived before the process reported one. */
  readonly code: number | null
  /** Captured command stdout. */
  readonly stdout: string
  /** Captured command stderr. */
  readonly stderr: string

  constructor(
    command: string,
    args: readonly string[],
    output: OutputType,
    timeoutMs?: number,
    cause?: unknown,
  ) {
    const outcome = timeoutMs === undefined
      ? `failed (reported exit status ${output.code ?? 'pending'})`
      : `exceeded ${timeoutMs / 1000} seconds (exit status ${output.code ?? 'pending'})`
    super(
      `Storage artifact consumer ${command} ${args.join(' ')} ${outcome}.${
        output.stderr ? `\n${output.stderr}` : ''
      }`,
      { cause: { output, reason: cause } },
    )
    this.name = 'InvocationError'
    this.code = output.code
    this.stdout = output.stdout
    this.stderr = output.stderr
  }
}

const ROOT = resolve('.tmp/storage-consumer')
const artifact = resolve(
  Deno.env.get('OPFS_TARBALL') ?? '../opfs/.release/npm/okikio-opfs-0.0.0-quality.tgz',
)
await Deno.stat(artifact)
const packages: string[] = [artifact, ...(await artifacts.get()).map((file) => resolve(file))]
if (packages.length !== 7) {
  throw new Error('Build the six RDF/SPARQL packages before the storage consumer.')
}
await optional(() => Deno.remove(ROOT, { recursive: true }))
await Deno.mkdir(ROOT, { recursive: true })
await Deno.writeTextFile(`${ROOT}/package.json`, '{"private":true,"type":"module"}\n')
await run('npm', [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--no-package-lock',
  ...packages,
])
await artifacts.installed(ROOT)
await Deno.copyFile('integration/storage/consumer.ts', `${ROOT}/behavior.ts`)
await run('node', ['behavior.ts'])
await run(Deno.execPath(), [
  'run',
  '--no-config',
  '--allow-read',
  '--allow-write',
  '--allow-env',
  '--node-modules-dir=manual',
  'behavior.ts',
])
await run('bun', ['run', 'behavior.ts'])

const payload = await container.prepare(ROOT, packages, '.tmp/packages/artifacts.json', [
  new URL('./storage-consumer.ts', import.meta.url),
])
/** Independent runtime cases preserve their actual consumer and copy-admission failures. */
const failures: unknown[] = []
try {
  for (
    const [image, args] of [
      ['node:22.18.0-bookworm-slim', ['node', '../worker.mjs']],
      ['node:24.21.0-slim', ['node', '../worker.mjs']],
      ['oven/bun:1.3.14', ['bun', 'run', '../worker.mjs']],
      ['denoland/deno:debian-2.9.7', [
        'deno',
        'run',
        '--no-config',
        '--allow-read=/work,/tmp,/proc/self/status',
        '--allow-write=/tmp',
        '--allow-env',
        '--node-modules-dir=manual',
        '../worker.mjs',
      ]],
    ] as const
  ) {
    console.log(`Starting copied packed storage consumer in ${image}.`)
    try {
      await container.run(payload, image, args, invoke)
    } catch (error) {
      failures.push(error)
    }
  }
} finally {
  try {
    await payload.verify()
  } catch (error) {
    failures.push(error)
  }
  try {
    await payload.close()
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) {
  throw new AggregateError(failures, 'Copied packed storage validation or owned cleanup failed.')
}

/** Rejects unsuccessful consumers while retaining their output and bounded execution lifetime. */
async function run(
  command: string,
  args: readonly string[],
  capture = false,
  timeoutMs = 180_000,
): Promise<string> {
  const output = await invoke(command, args, timeoutMs)
  if (!capture && output.stdout) console.log(output.stdout.trimEnd())
  if (output.stderr) console.error(output.stderr.trimEnd())
  if (!output.success) throw new InvocationError(command, args, output)
  return capture ? output.stdout : ''
}

/** Shared finite byte capture keeps actual status distinct from deadline/output failures. */
async function invoke(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<OutputType> {
  return await collect(command, args, { cwd: ROOT, timeoutMs })
}

export {}
