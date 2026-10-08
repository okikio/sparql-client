/** Bounds private task diagnostics while keeping process exit and capture outcomes separate. @module */

/** A capture failure does not replace the actual child exit or signal. */
export interface FailureType {
  /** Acquisition, output, retirement or operational watchdog authority. */
  readonly stage:
    | 'startup'
    | 'status'
    | 'read'
    | 'quota'
    | 'deadline'
    | 'stop'
    | 'cancel'
    | 'release'
  /** The failed stream when this is a pipe-specific observation. */
  readonly stream?: 'stdout' | 'stderr'
  /** Original rejection, including undefined or null. */
  readonly reason: unknown
}

/** Each independently admitted pipe records a finite prefix and whether EOF was reached. */
export interface StreamType {
  /** Maximum diagnostic bytes, independently applied to this stream. */
  readonly quotaBytes: number
  /** Bytes observed, including a chunk that exceeded admission. */
  readonly observedBytes: number
  /** Exact raw admitted bytes; never UTF-8 replacement data. */
  readonly bytes: Uint8Array<ArrayBuffer>
  /** True only when EOF was observed without capture cancellation. */
  readonly complete: boolean
}

/** Text is decoded once from bounded raw bytes; unsuccessful output remains inspectable. */
export interface OutputType {
  /** Actual observed exit, or null if startup/status observation failed. */
  readonly code: number | null
  /** Actual observed termination signal; capture failure is separate. */
  readonly signal: string | null
  /** True only for a successful exit, both EOFs and no capture failures. */
  readonly success: boolean
  /** Bounded human-readable stdout. Raw evidence remains in streams.stdout.bytes. */
  readonly stdout: string
  /** Bounded human-readable stderr. Raw evidence remains in streams.stderr.bytes. */
  readonly stderr: string
  /** Independent output admission and EOF observations. */
  readonly streams: { readonly stdout: StreamType; readonly stderr: StreamType }
  /** Ordered observations preserve every independent capture/cleanup failure. */
  readonly failures: readonly FailureType[]
}

/** Private task admission and deterministic watchdog controls; defaults use native process/timer authority. */
export interface OptionsType {
  /** Existing physically installed consumer directory; no shell interpolation occurs. */
  readonly cwd?: string
  /** Operational command deadline after acquisition; not a throughput requirement. */
  readonly timeoutMs?: number
  /** Maintainer diagnostic cap per stream; defaults to 32 MiB and can be lowered for controls. */
  readonly quotaBytes?: number
  /** Arms the watchdog and returns its retirement; used by deterministic child controls. */
  readonly watchdog?: (expire: () => void, timeoutMs: number) => () => void
  /** Observes actual pipe admission for watchdog controls; an observer failure rejects capture. */
  readonly observe?: (stream: 'stdout' | 'stderr', bytes: Uint8Array) => void
}

/**
 * Collects one direct task child without unbounded diagnostic strings.
 *
 * The 32 MiB quota is independent for stdout and stderr. Overflow retains the
 * admitted prefix, cancels both readers and kills only this exact child. Actual
 * status, drains, cancel and lock release are observed independently. A stalled
 * native cancellation or inherited descendant pipe still requires the runner's
 * outer watchdog; this collector does not own a Docker daemon or descendants.
 */
export async function collect(
  command: string,
  args: readonly string[],
  options: OptionsType = {},
): Promise<OutputType> {
  const timeout = options.timeoutMs ?? 180_000
  const quota = options.quotaBytes ?? 32 * 1024 * 1024
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2 ** 31 - 1) {
    throw new RangeError('Use a positive operational deadline within the native timer range.')
  }
  if (!Number.isSafeInteger(quota) || quota < 1 || quota > 32 * 1024 * 1024) {
    throw new RangeError('Use a positive diagnostic byte quota no larger than 32 MiB.')
  }
  const failures: FailureType[] = []
  const stopped = new AbortController()
  let child: Deno.ChildProcess | undefined
  const reported: { status: Deno.CommandStatus | undefined } = { status: undefined }
  let statusSettled = false
  let disarm: (() => void) | undefined
  const make = () => ({
    buffer: undefined as Uint8Array<ArrayBuffer> | undefined,
    retained: 0,
    observed: 0,
    complete: false,
  })
  const stdout = make(), stderr = make()
  const fail = (stage: FailureType['stage'], reason: unknown, stream?: 'stdout' | 'stderr') => {
    failures.push({ stage, reason, ...(stream === undefined ? {} : { stream }) })
  }
  const stop = () => {
    if (stopped.signal.aborted) return
    stopped.abort()
    if (child && !statusSettled) {
      try {
        child.kill('SIGKILL')
      } catch (error) {
        fail('stop', error)
      }
    }
  }
  try {
    try {
      child = new Deno.Command(command, {
        args: [...args],
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        stdin: 'null',
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()
    } catch (error) {
      fail('startup', error)
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
        const watchdog = options.watchdog ?? ((expire: () => void, timeoutMs: number) => {
          const timer = setTimeout(expire, timeoutMs)
          return () => clearTimeout(timer)
        })
        disarm = watchdog(() => {
          fail('deadline', new Error('Private task command deadline expired.'))
          stop()
        }, timeout)
      } catch (error) {
        fail('deadline', error)
        stop()
      }
      await Promise.all([
        drain(child.stdout, stdout, 'stdout'),
        drain(child.stderr, stderr, 'stderr'),
        actual,
      ])
    }
  } finally {
    try {
      disarm?.()
    } catch (error) {
      fail('deadline', error)
    }
  }
  const finish = (value: typeof stdout): StreamType => {
    const bytes = value.buffer?.slice(0, value.retained) ?? new Uint8Array(0)
    value.buffer = undefined
    return { quotaBytes: quota, observedBytes: value.observed, bytes, complete: value.complete }
  }
  const streams = { stdout: finish(stdout), stderr: finish(stderr) }
  return {
    code: reported.status?.code ?? null,
    signal: reported.status?.signal ?? null,
    success: reported.status?.success === true && streams.stdout.complete &&
      streams.stderr.complete && failures.length === 0,
    stdout: new TextDecoder().decode(streams.stdout.bytes),
    stderr: new TextDecoder().decode(streams.stderr.bytes),
    streams,
    failures,
  }

  /** One pending read owns each pipe; every cancel/release failure remains a capture observation. */
  async function drain(
    source: ReadableStream<Uint8Array>,
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
      stopped.signal.addEventListener('abort', cancel, { once: true })
      if (stopped.signal.aborted) cancel()
      while (!stopped.signal.aborted) {
        const part = await reader.read()
        if (part.done) {
          retained.complete = !stopped.signal.aborted
          break
        }
        retained.observed += part.value.byteLength
        const admitted = part.value.subarray(0, quota - retained.retained)
        if (admitted.byteLength) {
          retained.buffer ??= new Uint8Array(quota)
          retained.buffer.set(admitted, retained.retained)
          retained.retained += admitted.byteLength
          options.observe?.(stream, admitted)
        }
        if (admitted.byteLength !== part.value.byteLength) {
          fail('quota', new RangeError('Private task diagnostic quota exceeded.'), stream)
          stop()
        }
      }
    } catch (error) {
      fail('read', error, stream)
      stop()
    } finally {
      stopped.signal.removeEventListener('abort', cancel)
      if (stopped.signal.aborted) cancel()
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
