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
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
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
