import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { chunks, throwIfAborted } from './text.ts'

/** Collects parser source chunks as decoded strings for source-contract tests. */
async function collect(source: Parameters<typeof chunks>[0], signal?: AbortSignal): Promise<string[]> {
  const decoder = new TextDecoder()
  const values: string[] = []
  for await (const value of chunks(source, signal)) values.push(typeof value === 'string' ? value : decoder.decode(value))
  return values
}

describe('@okikio/rdf text sources', () => {
  it('windows direct strings and bytes instead of exposing one unbounded parser window', async () => {
    const text = 'x'.repeat(40 * 1024)
    const strings = await collect(text)
    const bytes = await collect(new TextEncoder().encode(text))
    expect(strings.length > 1).toBe(true)
    expect(bytes.length > 1).toBe(true)
    expect(strings.join('')).toBe(text)
    expect(bytes.join('')).toBe(text)
  })

  it('cancels a pending Web Stream read when the signal aborts', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const controller = new AbortController()
    const iterator = chunks(stream, controller.signal)
    const pending = iterator.next()
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    expect(cancelled).toBe(true)
  })

  it('throws the caller abort reason before accepting more work', () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    try {
      throwIfAborted(controller.signal)
      throw new Error('Expected abort failure.')
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toBe('cancelled')
    }
  })
})
