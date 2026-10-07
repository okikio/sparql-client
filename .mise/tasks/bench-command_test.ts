import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { collect } from './bench-command.ts'

describe('benchmark child lifetime', () => {
  it('retains complete output after the actual child exits', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'console.log("fixture stdout"); console.error("fixture stderr")',
    ])
    expect(result.success).toBe(true)
    expect(result.code).toBe(0)
    expect(new TextDecoder().decode(result.stdout).trim()).toBe('fixture stdout')
    expect(new TextDecoder().decode(result.stderr).trim()).toBe('fixture stderr')
  })
  it('preserves raw diagnostic bytes without UTF-8 replacement', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'await Deno.stdout.write(new Uint8Array([0,255,128])); await Deno.stderr.write(new Uint8Array([254,1]))',
    ])
    expect(result.success).toBe(true)
    expect([...result.stdout]).toEqual([0, 255, 128])
    expect([...result.stderr]).toEqual([254, 1])
  })
  it('retains an unsuccessful reported exit and its diagnostics', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'console.error("child rejected workload"); Deno.exit(7)',
    ])
    expect(result.success).toBe(false)
    expect(result.code).toBe(7)
    expect(result.error).toBeInstanceOf(Error)
    expect(new TextDecoder().decode(result.stderr)).toContain('child rejected workload')
  })
  it('reports a startup failure without inventing an exit status', async () => {
    const result = await collect(`missing-benchmark-${crypto.randomUUID()}`, [])
    expect(result.success).toBe(false)
    expect(result.code).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
  it('terminates a child that never finishes, without treating elapsed time as performance', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'await new Promise(() => setInterval(() => {}, 1000))',
    ], { timeoutMs: 250 })
    expect(result.success).toBe(false)
    expect(result.code).toBeNull()
    expect(result.error).toMatchObject({ killed: true, signal: 'SIGKILL' })
  })
})
