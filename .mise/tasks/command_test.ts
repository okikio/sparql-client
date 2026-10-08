import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { collect } from './command.ts'

/** Every real child writes accepted suffixes; native writes are not assumed to consume a whole chunk. */
const WRITE = `async function write(file, bytes) {
  let offset = 0; while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
}`

describe('packed task bounded diagnostic capture', () => {
  it('retains raw binary diagnostics and actual successful or unsuccessful exits', async () => {
    for (const code of [0, 7]) {
      const result = await collect(Deno.execPath(), [
        'eval',
        `${WRITE}
await write(Deno.stdout, new Uint8Array([0,255,128]));
await write(Deno.stderr, new Uint8Array([254,1])); Deno.exit(${code});`,
      ])
      expect(result.code).toBe(code)
      expect(result.signal).toBeNull()
      expect(result.success).toBe(code === 0)
      expect([...result.streams.stdout.bytes]).toEqual([0, 255, 128])
      expect([...result.streams.stderr.bytes]).toEqual([254, 1])
      expect(result.streams.stdout.complete).toBe(true)
      expect(result.streams.stderr.complete).toBe(true)
      expect(result.failures).toEqual([])
    }
  })

  it('does not invent process status after actual startup failure', async () => {
    const result = await collect(`missing-packed-command-${crypto.randomUUID()}`, [])
    expect(result.success).toBe(false)
    expect(result.code).toBeNull()
    expect(result.signal).toBeNull()
    expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'startup' }))
    expect(result.streams.stdout.bytes.length).toBe(0)
    expect(result.streams.stderr.bytes.length).toBe(0)
  })

  it('admits exact independent quotas and rejects each first extra byte without discarding its prefix', async () => {
    const exact = await collect(Deno.execPath(), [
      'eval',
      `${WRITE}
await write(Deno.stdout, new Uint8Array(4096).fill(19));
await write(Deno.stderr, new Uint8Array(4096).fill(37));`,
    ], { quotaBytes: 4096 })
    expect(exact.success).toBe(true)
    expect([...exact.streams.stdout.bytes]).toEqual(new Array(4096).fill(19))
    expect([...exact.streams.stderr.bytes]).toEqual(new Array(4096).fill(37))
    for (const stream of ['stdout', 'stderr'] as const) {
      const result = await collect(Deno.execPath(), [
        'eval',
        `${WRITE}
await write(Deno.${stream}, new Uint8Array(4097).fill(23));`,
      ], { quotaBytes: 4096 })
      expect(result.success).toBe(false)
      expect(result.code).not.toBeNull()
      expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'quota', stream }))
      expect(result.streams[stream].bytes.length).toBe(4096)
      expect(result.streams[stream].observedBytes).toBeGreaterThan(4096)
      expect(result.streams[stream].complete).toBe(false)
      expect([...result.streams[stream].bytes]).toEqual(new Array(4096).fill(23))
    }
  })

  it('expires only after actual pipe admission and observes child termination without an elapsed threshold', async () => {
    let expire: (() => void) | undefined
    let disarmed = false
    const result = await collect(Deno.execPath(), [
      'eval',
      `${WRITE}
await write(Deno.stdout, new Uint8Array([41]));
await new Promise(() => setInterval(() => {}, 1000));`,
    ], {
      watchdog(callback) {
        expire = callback
        return () => {
          disarmed = true
        }
      },
      observe(stream) {
        if (stream === 'stdout') expire!()
      },
    })
    expect(result.success).toBe(false)
    expect(result.code).not.toBeNull()
    expect(result.signal).toBe('SIGKILL')
    expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'deadline' }))
    expect([...result.streams.stdout.bytes]).toEqual([41])
    expect(disarmed).toBe(true)
  })

  it('preserves undefined/null capture failures and independent watchdog retirement failure', async () => {
    for (const reason of [undefined, null]) {
      const retirement = new Error('watchdog retirement')
      const result = await collect(Deno.execPath(), [
        'eval',
        `${WRITE}
await write(Deno.stdout, new Uint8Array([43]));
await new Promise(() => setInterval(() => {}, 1000));`,
      ], {
        watchdog() {
          return () => {
            throw retirement
          }
        },
        observe() {
          throw reason
        },
      })
      expect(result.success).toBe(false)
      expect(result.signal).toBe('SIGKILL')
      expect(result.failures).toContainEqual({ stage: 'read', stream: 'stdout', reason })
      expect(result.failures).toContainEqual({ stage: 'deadline', reason: retirement })
      expect([...result.streams.stdout.bytes]).toEqual([43])
    }
  })

  it('retires a real acquired child after watchdog setup failure and rejects invalid admission before spawn', async () => {
    const admission = new Error('watchdog setup')
    const result = await collect(Deno.execPath(), [
      'eval',
      'await new Promise(() => setInterval(() => {}, 1000))',
    ], {
      watchdog() {
        throw admission
      },
    })
    expect(result.success).toBe(false)
    expect(result.signal).toBe('SIGKILL')
    expect(result.code).not.toBeNull()
    expect(result.failures).toContainEqual({ stage: 'deadline', reason: admission })
    for (const timeoutMs of [0, NaN, Infinity, 1.5, 2 ** 31]) {
      await expect(collect('unused', [], { timeoutMs })).rejects.toBeInstanceOf(RangeError)
    }
    for (const quotaBytes of [0, NaN, Infinity, 1.5, 32 * 1024 * 1024 + 1]) {
      await expect(collect('unused', [], { quotaBytes })).rejects.toBeInstanceOf(RangeError)
    }
  })
})
