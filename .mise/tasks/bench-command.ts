/** Collects one benchmark child under an operational deadline, retaining unsuccessful output. @module */
import { execFile } from 'node:child_process'

/** Raw output and reported exit status remain distinct from deadline/startup failures. */
export interface OutputType {
  readonly success: boolean
  readonly code: number | null
  readonly stdout: Uint8Array<ArrayBuffer>
  readonly stderr: Uint8Array<ArrayBuffer>
  readonly error?: Error
}

/**
 * A twenty-minute watchdog bounds a stalled producer; it is not a throughput requirement.
 * execFile owns the timeout, kills the exact child with SIGKILL, and waits for its pipes to close.
 * Each output stream is capped at 32MiB so malformed output cannot grow the collector without bound.
 */
export function collect(
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>>; readonly timeoutMs?: number } = {},
): Promise<OutputType> {
  const timeout = options.timeoutMs ?? 20 * 60_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2 ** 31 - 1) {
    throw new RangeError('Use a positive child deadline.')
  }
  return new Promise((resolve) => {
    execFile(command, [...args], {
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'buffer',
      ...(options.env ? { env: { ...Deno.env.toObject(), ...options.env } } : {}),
    }, (error, stdout, stderr) => {
      resolve({
        success: error === null,
        code: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stdout: new Uint8Array(stdout),
        stderr: new Uint8Array(stderr),
        ...(error ? { error } : {}),
      })
    })
  })
}

/** A directly owned raw file; writes may accept only a prefix of the supplied bytes. */
export interface FileType {
  /** Returns the accepted byte count. Zero or invalid progress is a capture failure. */
  write(bytes: Uint8Array): Promise<number>
  /** Releases this file independently of the other output file and the child. */
  close(): void | Promise<void>
}

/** Exact retained bytes and EOF admission for one child output stream. */
export interface StreamType {
  readonly path: string
  readonly quotaBytes: number
  readonly observedBytes: number
  readonly retainedBytes: number
  readonly complete: boolean
}

/** Capture failures do not replace the child's actual reported exit or signal. */
export interface FailureType {
  readonly stage:
    | 'open'
    | 'startup'
    | 'deadline'
    | 'stop'
    | 'status'
    | 'read'
    | 'write'
    | 'quota'
    | 'cancel'
    | 'release'
    | 'close'
  readonly stream?: 'stdout' | 'stderr'
  readonly reason: unknown
}

/** Raw spooled evidence remains available after capture, admission or child failure. */
export interface FileOutputType {
  readonly success: boolean
  readonly code: number | null
  readonly signal: string | null
  readonly stdout: StreamType
  readonly stderr: StreamType
  readonly failures: readonly FailureType[]
  readonly error?: Error
}

/** Benchmark-only acquisition/fault boundaries; the default uses native files and timers. */
export interface SpoolOptionsType {
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly quotaBytes?: number
  /** Opens an owned raw file before child acquisition. Both closes are attempted; a close failure rejects capture. */
  readonly open?: (path: string) => Promise<FileType>
  /** Arms an operational deadline and returns its release, permitting deterministic admission controls. */
  readonly watchdog?: (expire: () => void, timeoutMs: number) => () => void
}

/**
 * Spools one native benchmark child without aggregating either pipe in memory.
 *
 * The default 128MiB quota applies independently to stdout and stderr. Pinned
 * Mitata calibration arrays exceeded the old 32MiB memory collector; no samples
 * are dropped here. Quota overflow retains the admitted prefix and rejects the
 * report. Each read waits for every partial file write before reading again.
 *
 * After files and child acquisition, a twenty-minute operational deadline covers
 * acquired child output and file retirement. File-open/spawn acquisition is outside
 * this timer and inside the isolated runner's outer watchdog. This is
 * not a benchmark latency target. Failure kills only the exact acquired child;
 * actual status, both drains, reader release and both file closes are observed
 * independently. An inherited descendant pipe or uncooperative native disk call
 * still requires the outer isolated-runner watchdog. This does not own descendants.
 */
export async function spool(
  command: string,
  args: readonly string[],
  paths: { readonly stdout: string; readonly stderr: string },
  options: SpoolOptionsType = {},
): Promise<FileOutputType> {
  const timeout = options.timeoutMs ?? 20 * 60_000
  const quota = options.quotaBytes ?? 128 * 1024 * 1024
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2 ** 31 - 1) {
    throw new RangeError('Use a positive child deadline within the native timer range.')
  }
  if (!Number.isSafeInteger(quota) || quota < 1) {
    throw new RangeError('Use a positive retained byte quota.')
  }
  if (paths.stdout === paths.stderr) {
    throw new TypeError('Child output streams require independent raw files.')
  }
  const failures: FailureType[] = []
  const stdout = {
    path: paths.stdout,
    quotaBytes: quota,
    observedBytes: 0,
    retainedBytes: 0,
    complete: false,
  }
  const stderr = {
    path: paths.stderr,
    quotaBytes: quota,
    observedBytes: 0,
    retainedBytes: 0,
    complete: false,
  }
  const owned: Array<{ file: FileType; stream: 'stdout' | 'stderr' }> = []
  const controller = new AbortController()
  let child: Deno.ChildProcess | undefined
  const reported: { status: Deno.CommandStatus | undefined } = { status: undefined }
  let statusSettled = false
  let stopped = false
  let disarm: (() => void) | undefined
  const open = options.open ?? ((path: string) => Deno.open(path, { createNew: true, write: true }))
  const watchdog = options.watchdog ?? ((expire: () => void, timeoutMs: number) => {
    const timer = setTimeout(expire, timeoutMs)
    return () => clearTimeout(timer)
  })
  const fail = (stage: FailureType['stage'], reason: unknown, stream?: 'stdout' | 'stderr') => {
    failures.push({ stage, reason, ...(stream === undefined ? {} : { stream }) })
  }
  const stop = () => {
    if (!stopped) {
      stopped = true
      if (child && !statusSettled) {
        try {
          child.kill('SIGKILL')
        } catch (error) {
          fail('stop', error)
        }
      }
      controller.abort()
    }
  }
  try {
    try {
      owned.push({ file: await open(stdout.path), stream: 'stdout' })
      owned.push({ file: await open(stderr.path), stream: 'stderr' })
    } catch (error) {
      fail('open', error)
    }
    if (failures.length === 0) {
      try {
        child = new Deno.Command(command, {
          args: [...args],
          stdin: 'null',
          stdout: 'piped',
          stderr: 'piped',
          ...(options.env ? { env: { ...options.env } } : {}),
        }).spawn()
      } catch (error) {
        fail('startup', error)
      }
    }
    if (child) {
      const actual = child.status.then((value) => {
        reported.status = value
      }, (error: unknown) => {
        fail('status', error)
        stop()
      }).finally(() => {
        statusSettled = true
      })
      try {
        disarm = watchdog(() => {
          fail('deadline', new Error('Native benchmark operational deadline expired.'))
          stop()
        }, timeout)
      } catch (error) {
        fail('deadline', error)
        stop()
      }
      // Both drains start even after a deadline-arm fault, so cancellation and
      // release are owned for each acquired pipe rather than left to collection.
      const settled = await Promise.allSettled([
        drain(child.stdout, owned[0]!.file, stdout, 'stdout'),
        drain(child.stderr, owned[1]!.file, stderr, 'stderr'),
        actual,
      ])
      for (const result of settled) {
        if (result.status === 'rejected') {
          fail('read', result.reason)
          stop()
        }
      }
    }
  } finally {
    for (const { file, stream } of owned.reverse()) {
      try {
        await file.close()
      } catch (error) {
        fail('close', error, stream)
        stop()
      }
    }
    try {
      disarm?.()
    } catch (error) {
      fail('deadline', error)
    }
  }
  const success = reported.status?.success === true && stdout.complete && stderr.complete &&
    failures.length === 0
  return {
    success,
    code: reported.status?.code ?? null,
    signal: reported.status?.signal ?? null,
    stdout,
    stderr,
    failures,
    ...(failures.length
      ? {
        error: new AggregateError(
          failures.map((value) => value.reason),
          'Native benchmark capture failed.',
        ),
      }
      : {}),
  }

  /** One pending pipe read and write at a time; independent cleanup failures remain observable. */
  async function drain(
    source: ReadableStream<Uint8Array>,
    file: FileType,
    retained: typeof stdout,
    stream: 'stdout' | 'stderr',
  ): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let cancellation: Promise<void> | undefined
    const cancel = () => {
      if (!reader || cancellation) return
      try {
        cancellation = reader.cancel().catch((error: unknown) => fail('cancel', error, stream))
      } catch (error) {
        fail('cancel', error, stream)
        cancellation = Promise.resolve()
      }
    }
    try {
      reader = source.getReader()
      controller.signal.addEventListener('abort', cancel, { once: true })
      if (controller.signal.aborted) cancel()
      while (!controller.signal.aborted) {
        let part: ReadableStreamReadResult<Uint8Array>
        try {
          part = await reader.read()
        } catch (error) {
          fail('read', error, stream)
          stop()
          break
        }
        if (part.done) {
          retained.complete = !controller.signal.aborted
          break
        }
        retained.observedBytes += part.value.byteLength
        const admitted = part.value.subarray(0, quota - retained.retainedBytes)
        try {
          let offset = 0
          while (offset < admitted.byteLength) {
            const written = await file.write(admitted.subarray(offset))
            if (
              !Number.isSafeInteger(written) || written < 1 ||
              written > admitted.byteLength - offset
            ) {
              throw new RangeError('Raw output write made invalid progress.')
            }
            retained.retainedBytes += written
            offset += written
          }
        } catch (error) {
          fail('write', error, stream)
          stop()
          break
        }
        if (admitted.byteLength !== part.value.byteLength) {
          fail('quota', new RangeError('Native benchmark retained output quota exceeded.'), stream)
          stop()
          break
        }
      }
    } catch (error) {
      fail('read', error, stream)
      stop()
    } finally {
      controller.signal.removeEventListener('abort', cancel)
      if (controller.signal.aborted) cancel()
      await cancellation
      try {
        reader?.releaseLock()
      } catch (error) {
        fail('release', error, stream)
        stop()
      }
    }
  }
}

/**
 * Reads exactly one admitted raw file for JSON validation outside measured callbacks.
 * A fixed destination bounded by its actual size avoids unbounded readFile growth;
 * an extra byte or early EOF rejects a file changed during reading.
 */
export async function read(path: string, quotaBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) {
    throw new RangeError('Use a positive retained byte quota.')
  }
  const file = await Deno.open(path, { read: true })
  const errors: unknown[] = []
  let result: Uint8Array<ArrayBuffer> | undefined
  try {
    const info = await file.stat()
    if (
      !info.isFile || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > quotaBytes
    ) {
      throw new RangeError('Raw benchmark file exceeds admitted size or is not regular.')
    }
    result = new Uint8Array(info.size)
    let offset = 0
    while (offset < result.byteLength) {
      const count = await file.read(result.subarray(offset))
      if (count === null) throw new Error('Raw benchmark file ended before its admitted size.')
      if (!Number.isSafeInteger(count) || count < 1 || count > result.byteLength - offset) {
        throw new RangeError('Raw benchmark file read made invalid progress.')
      }
      offset += count
    }
    if (await file.read(new Uint8Array(1)) !== null) {
      throw new Error('Raw benchmark file grew during validation.')
    }
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      file.close()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Raw benchmark file validation or close failed.')
  }
  return result!
}
