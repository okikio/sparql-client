/** Executes clean packed-package behavior with bounded, owned Linux container lifetimes. @module */

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
      `Packed Linux consumer ${command} ${args.join(' ')} ${outcome}.${
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

const directory = await Deno.realPath('.tmp/consumer')
await Deno.stat(`${directory}/behavior.ts`)
/** One runtime failure must not hide the other independently executable consumer cases. */
const failures: unknown[] = []
for (
  const [image, command] of [
    ['node:22.18.0-bookworm-slim', ['node', 'behavior.ts']],
    ['node:24.21.0-slim', ['node', 'behavior.ts']],
    ['oven/bun:1.3.14', ['bun', 'behavior.ts']],
    ['denoland/deno:debian-2.9.7', [
      'run',
      '--no-config',
      '--allow-read=node_modules',
      '--allow-net=127.0.0.1',
      '--node-modules-dir=manual',
      'behavior.ts',
    ]],
  ] as const
) {
  const name = `rdf-linux-consumer-${crypto.randomUUID()}`
  let failed = false
  let created = false
  let failure: unknown
  try {
    await run([
      'create',
      '--name',
      name,
      '-v',
      `${directory}:/work:ro`,
      '-w',
      '/work',
      image,
      ...command,
    ], 30_000)
    created = true
    await run(['start', name], 30_000)
    const exit = (await run(['wait', name], 180_000)).stdout.trim()
    if (exit !== '0') throw new Error(`Packed Linux consumer in ${image} exited ${exit}.`)
  } catch (cause) {
    failed = true
    failure = new Error(`Packed Linux consumer in ${image}, owned container ${name}, failed.`, {
      cause,
    })
  }
  // A wait deadline can occur after useful consumer output. Capture logs even
  // after that failure, before removing the container, under a separate limit.
  if (created) {
    try {
      await run(['logs', name], 15_000, true)
    } catch (cause) {
      const diagnostics = new Error(`Could not read logs of owned Linux consumer ${name}.`, {
        cause,
      })
      failure = failed
        ? new AggregateError(
          [failure, diagnostics],
          `Consumer and log retrieval failed for ${name}.`,
          {
            cause: failure,
          },
        )
        : diagnostics
      failed = true
    }
  }
  // Killing a Docker CLI does not remove a daemon-side container. Only this
  // exact owned name may be removed, under an independent cleanup deadline.
  try {
    const cleanup = await invoke('docker', ['rm', '--force', '--volumes', name], 30_000)
    if (!cleanup.success && !cleanup.stderr.includes(`No such container: ${name}`)) {
      throw new InvocationError('docker', ['rm', '--force', '--volumes', name], cleanup)
    }
  } catch (cause) {
    const cleanup = new Error(`Could not confirm cleanup of owned Linux consumer ${name}.`, {
      cause,
    })
    failures.push(
      failed
        ? new AggregateError([failure, cleanup], `Consumer and cleanup failed for ${name}.`, {
          cause: failure,
        })
        : cleanup,
    )
    continue
  }
  if (failed) failures.push(failure)
}
if (failures.length) {
  throw new AggregateError(failures, `${failures.length} packed Linux consumer cases failed.`, {
    cause: failures[0],
  })
}
console.log('Packed Linux behavior passed in Node 22.18, Node 24, Bun 1.3.14, and Deno 2.9.')

/** Retains exact CLI output and turns a deadline into a failure rather than an unsupported-runtime skip. */
async function run(
  args: readonly string[],
  timeoutMs: number,
  display = false,
): Promise<OutputType> {
  const output = await invoke('docker', args, timeoutMs)
  if (display && output.stdout) console.log(output.stdout.trimEnd())
  if (output.stderr) console.error(output.stderr.trimEnd())
  if (!output.success) throw new InvocationError('docker', args, output)
  return output
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
    cwd: directory,
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
