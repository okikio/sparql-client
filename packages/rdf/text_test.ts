import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { chunks, throwIfAborted } from './text.ts'
import { parse as parseNQuads } from './nquads/mod.ts'
import { parse as parseTurtle } from './turtle/mod.ts'
import { parse as parseTrig } from './trig/mod.ts'
import { parse as parseXml } from './xml/mod.ts'
import { parse as parseRdfa } from './rdfa/mod.ts'
import { parse as parseMicrodata } from './microdata/mod.ts'

/** Collects parser source chunks as decoded strings for source-contract tests. */
async function collect(
  source: Parameters<typeof chunks>[0],
  signal?: AbortSignal,
): Promise<string[]> {
  const decoder = new TextDecoder()
  const values: string[] = []
  for await (const value of chunks(source, signal)) {
    values.push(typeof value === 'string' ? value : decoder.decode(value))
  }
  return values
}

describe('@okikio/rdf text sources', () => {
  it('interrupts pending iterable input and returns the iterator once across native parsers', async () => {
    for (
      const parse of [parseNQuads, parseTurtle, parseTrig, parseXml, parseRdfa, parseMicrodata]
    ) {
      const controller = new AbortController()
      let returned = 0
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const source: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              entered()
              return new Promise<IteratorResult<string>>(() => {})
            },
            return() {
              returned++
              return Promise.resolve({ done: true as const, value: undefined })
            },
          }
        },
      }
      const iterator = parse(source, { signal: controller.signal })
      const pending = iterator.next()
      await started
      controller.abort(new Error('stop pending text input'))
      await expect(pending).rejects.toThrow('stop pending text input')
      expect(returned).toBe(1)
    }
  })

  it('does not acquire pre-aborted text input and returns early consumers once', async () => {
    let acquired = 0, returned = 0
    const source = {
      [Symbol.iterator]() {
        acquired++
        return {
          next: () => ({ done: false as const, value: 'text' }),
          return() {
            returned++
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    await expect(chunks(source, AbortSignal.abort(new Error('stop before acquire'))).next()).rejects
      .toThrow('stop before acquire')
    expect(acquired).toBe(0)
    for await (const _ of chunks(source)) break
    expect(returned).toBe(1)
  })

  it('retains both text source and iterator cleanup failures', async () => {
    const primary = new Error('text read failed'), cleanup = new Error('text cleanup failed')
    const source = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<string> {
            throw primary
          },
          return(): IteratorResult<string> {
            throw cleanup
          },
        }
      },
    }
    await expect(chunks(source).next()).rejects.toMatchObject({
      cause: primary,
      errors: [primary, cleanup],
    })
  })

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
