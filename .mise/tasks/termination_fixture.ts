/** Independent native status oracles for private task capture controls. @module */
import { spawn } from 'node:child_process'
import { expect } from '@std/expect'
import { finish } from '../../integration/releases.ts'

const WAIT = 'await new Promise(() => setInterval(() => {}, 1000))'

/**
 * Observe the native runtime's forced exit and both pipe EOFs independently of our collector.
 * A requested signal is not a reported signal: Windows may report a numeric exit and null signal.
 * https://docs.deno.com/api/deno/subprocess/#Deno.CommandStatus
 */
export async function terminate(): Promise<Deno.CommandStatus> {
  return await finish(async (release) => {
    const child = new Deno.Command(Deno.execPath(), {
      args: ['eval', WAIT],
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    const owned: { completion?: Promise<Deno.CommandOutput> } = {}
    release.push(async () => {
      await owned.completion
    })
    release.push(() => child[Symbol.asyncDispose]())
    const completion = owned.completion = child.output()
    // Observe a rejection immediately; the owning await and release still retain its original cause.
    void completion.catch(() => {})
    expect(child.pid).toBeGreaterThan(0)
    child.kill('SIGKILL')
    const actual = await completion
    expect(actual.success).toBe(false)
    expect(actual.code).not.toBe(0)
    expect(actual.stdout.byteLength).toBe(0)
    expect(actual.stderr.byteLength).toBe(0)
    return { code: actual.code, signal: actual.signal, success: actual.success }
  })
}

/** Node's close event owns process exit plus pipe retirement; its status is a separate API contract. */
export async function nodeTerminate(): Promise<{ code: number | null; signal: string | null }> {
  return await finish(async (release) => {
    const child = spawn(Deno.execPath(), ['eval', WAIT], { stdio: ['ignore', 'pipe', 'pipe'] })
    const errors: unknown[] = []
    const completion = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on('error', (error) => errors.push(error))
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    release.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await completion
    })
    release.unshift(() => {
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Native oracle child failed.')
    })
    child.stdout.resume()
    child.stderr.resume()
    expect(child.pid).toBeGreaterThan(0)
    expect(child.kill('SIGKILL')).toBe(true)
    const actual = await completion
    expect(actual.code === null && actual.signal === null).toBe(false)
    expect(actual.code).not.toBe(0)
    expect(child.stdout.readableEnded).toBe(true)
    expect(child.stderr.readableEnded).toBe(true)
    return actual
  })
}
