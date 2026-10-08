/** Installs both repositories' artifacts and tests storage composition in host and Linux runtimes. @module */
import { resolve } from '@std/path'
import { optional } from './files.ts'
import * as artifacts from './artifacts.ts'

/** Captured command diagnostics remain available for unsuccessful exits and deadlines. */
interface OutputType {
  /** Null means the command had not reported its exit status before the deadline. */
  readonly code: number | null
  /** True only after a reported successful command exit. */
  readonly success: boolean
  /** Captured stdout, including partial output when a command times out. */
  readonly stdout: string
  /** Captured stderr, including partial output when a command times out. */
  readonly stderr: string
}

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
      cause === undefined ? undefined : { cause },
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

/** Independent Linux failures remain visible without preventing the remaining runtime checks. */
const failures: unknown[] = []

/** Every Linux process writes only its own temporary directory and has no network access. */
for (
  const [image, args] of [
    ['node:22.18.0-bookworm-slim', ['node', 'behavior.ts']],
    ['node:24.21.0-slim', ['node', 'behavior.ts']],
    ['oven/bun:1.3.14', ['bun', 'run', 'behavior.ts']],
    ['denoland/deno:debian-2.9.7', [
      'run',
      '--no-config',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--node-modules-dir=manual',
      'behavior.ts',
    ]],
  ] as const
) {
  const name = `rdf-storage-${crypto.randomUUID()}`
  console.log(`Starting packed storage consumer in ${image}.`)
  let failed = false
  let failure: unknown
  try {
    await run(
      'docker',
      [
        'create',
        '--name',
        name,
        '--network',
        'none',
        '-v',
        `${ROOT}:/work:ro`,
        '-w',
        '/work',
        image,
        ...args,
      ],
      false,
      30_000,
    )
    await run('docker', ['start', name], true, 30_000)
    const exit = (await run('docker', ['wait', name], true)).trim()
    await run('docker', ['logs', name], false, 15_000)
    if (exit !== '0') throw new Error(`Packed storage consumer in ${image} exited ${exit}.`)
  } catch (cause) {
    failed = true
    failure = new Error(`Packed storage consumer in ${image}, owned container ${name}, failed.`, {
      cause,
    })
  }
  // A daemon startup stall can leave a created container after its CLI is killed.
  // Cleanup has its own deadline; an unresolved removal remains a failure with
  // the exact owned identity, rather than delaying every remaining runtime.
  try {
    const cleanup = await invoke('docker', ['rm', '--force', name], 30_000)
    if (!cleanup.success && !cleanup.stderr.includes(`No such container: ${name}`)) {
      throw new InvocationError('docker', ['rm', '--force', name], cleanup)
    }
  } catch (cause) {
    const cleanup = new Error(
      `Could not confirm cleanup of owned storage consumer ${name} in ${image}.`,
      { cause },
    )
    failures.push(
      failed
        ? new AggregateError(
          [failure, cleanup],
          `Storage consumer and cleanup failed for ${name}.`,
          {
            cause: failure,
          },
        )
        : cleanup,
    )
    continue
  }
  if (failed) failures.push(failure)
}
if (failures.length > 0) {
  throw new AggregateError(failures, `${failures.length} Linux storage consumer cases failed.`, {
    cause: failures[0],
  })
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

/**
 * Captures one command under a hard deadline, including daemon operations.
 *
 * Output readers are independent of process status: killing a CLI does not
 * require waiting for an inherited output pipe to close. A deadline rejects
 * with the partial diagnostics and cancels those readers. Killing Docker's CLI
 * does not establish that the daemon removed a container; callers must perform
 * their separately bounded cleanup and retain that owned identity on failure.
 */
async function invoke(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<OutputType> {
  const child = new Deno.Command(command, {
    args: [...args],
    cwd: ROOT,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  const stdoutReader = child.stdout.getReader(), stderrReader = child.stderr.getReader()
  let stdout = '', stderr = ''
  let status: Deno.CommandStatus | undefined
  const exited = child.status.then((value) => {
    status = value
    return value
  })
  const complete = Promise.all([
    exited,
    read(stdoutReader, (text) => {
      stdout += text
    }),
    read(stderrReader, (text) => {
      stderr += text
    }),
  ]).then(([value]): OutputType => ({ code: value.code, success: value.success, stdout, stderr }))
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // The child may have exited just before the deadline. Its output may
        // still be pending, so process status alone does not settle this call.
      }
      const output = { code: status?.code ?? null, success: false, stdout, stderr }
      reject(new InvocationError(command, args, output, timeoutMs))
      void stdoutReader.cancel().catch(() => undefined)
      void stderrReader.cancel().catch(() => undefined)
    }, timeoutMs)
  })
  try {
    return await Promise.race([complete, deadline])
  } catch (cause) {
    if (cause instanceof InvocationError) throw cause
    try {
      child.kill('SIGKILL')
    } catch {
      // A completed process cannot be killed, but pipe failures remain visible.
    }
    void stdoutReader.cancel().catch(() => undefined)
    void stderrReader.cancel().catch(() => undefined)
    throw new InvocationError(
      command,
      args,
      { code: status?.code ?? null, success: false, stdout, stderr },
      undefined,
      cause,
    )
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

/** Drains one output pipe and releases its reader on completion, cancellation or failure. */
async function read(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  append: (text: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) break
      append(decoder.decode(value.value, { stream: true }))
    }
    append(decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

export {}
