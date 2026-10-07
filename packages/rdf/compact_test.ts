/** Scanner invariants across refill, UTF-8, limits and cancellation. */
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { events as turtleEvents, parse as turtle } from './turtle/mod.ts'
import { events as trigEvents, parse as trig } from './trig/mod.ts'
import type { CompactEventType } from './compact.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('Turtle/TriG buffered scanning', () => {
  it('retains decoded fields and exact ranges across every UTF-8 byte edge', async () => {
    for (
      const [parse, events, graph] of [[turtle, turtleEvents, false], [
        trig,
        trigEvents,
        true,
      ]] as const
    ) {
      const body = '<urn:s> <urn:p> "é😀\\n\\u03BB"@en ; <urn:number> 1.e3 .'
      const text = `# comment\r\n${graph ? `<urn:g> { ${body} }` : body}`
      const direct = await collect(events(text))
      const encoded = new TextEncoder().encode(text)
      const bytes = [...encoded].map((value) => Uint8Array.of(value))
      expect(await collect(events(bytes))).toEqual(direct)
      for (let offset = 0; offset <= text.length; offset++) {
        expect(await collect(events([text.slice(0, offset), '', text.slice(offset)]))).toEqual(
          direct,
        )
      }
      const values = await collect(parse(bytes))
      expect(values).toHaveLength(2)
      expect(values[0]?.object.value).toBe('é😀\nλ')
      expect(values[0]?.graph.value).toBe(graph ? 'urn:g' : '')
      expect(direct.find((event) => event.kind === 'quad')?.range.start).toBe(graph ? 21 : 11)
    }
  })

  it('keeps token length guards and source ranges across repeated buffer compaction', async () => {
    const padding = '#'.concat('x'.repeat(65540), '\n')
    const text = `${padding}<urn:s> <urn:p> "${'v'.repeat(65540)}" .`
    const values = await collect(turtleEvents(text, { maxTokenLength: 65542 }))
    const value = values.find((event) => event.kind === 'quad')
    expect(value?.range.start).toBe(padding.length)
    expect(value?.range.line).toBe(2)
    expect(value?.range.column).toBe(1)
    expect(value?.range.end).toBe(text.length)
    await expect(collect(turtle(text, { maxTokenLength: 65541 }))).rejects.toThrow(SyntaxError)
    await expect(collect(turtle('<urn:s> <urn:p> [ <urn:p> [ <urn:p> <urn:o> ] ] .', {
      maxDepth: 1,
    }))).rejects.toThrow(SyntaxError)
    await expect(collect(trig('<urn:g> { <urn:s> <urn:p> "unterminated }'))).rejects.toThrow()
  })

  it('rejects escaped token growth before admitting the next producer chunk', async () => {
    for (
      const token of [
        '"' + '\\u0061'.repeat(20),
        '"' + '\\n'.repeat(40),
        '<urn:' + '\\u0061'.repeat(20),
        ':' + '%41'.repeat(20),
        ':' + '\\~'.repeat(40),
        'ex:' + '%41'.repeat(20),
        'ex:' + '\\~'.repeat(40),
      ]
    ) {
      let tailReads = 0
      let returns = 0
      const source: Iterable<string> = {
        *[Symbol.iterator]() {
          try {
            yield '@prefix : <urn:> . @prefix ex: <urn:> . :s :p ' + token
            tailReads++
            yield ' .'
          } finally {
            returns++
          }
        },
      }
      await expect(collect(turtle(source, { maxTokenLength: 32 }))).rejects.toThrow(SyntaxError)
      expect(tailReads).toBe(0)
      expect(returns).toBe(1)
    }
  })

  it('validates finite integer caps before acquiring input and preserves depth zero', async () => {
    for (const parse of [turtle, trig]) {
      for (const field of ['maxTokenLength', 'maxDepth', 'maxStatementEvents'] as const) {
        for (const cap of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
          let acquired = 0
          const source: Iterable<string> = {
            *[Symbol.iterator]() {
              acquired++
              yield '<urn:s> <urn:p> <urn:o> .'
            },
          }
          await expect(collect(parse(source, { [field]: cap }))).rejects.toThrow(TypeError)
          expect(acquired).toBe(0)
        }
      }
      expect(await collect(parse('', { maxDepth: 0 }))).toHaveLength(0)
      await expect(collect(parse('<urn:s> <urn:p> [ <urn:q> <urn:o> ] .', { maxDepth: 0 }))).rejects
        .toThrow(SyntaxError)
      for (const field of ['maxTokenLength', 'maxStatementEvents'] as const) {
        expect(await collect(parse('', { [field]: 0 }))).toHaveLength(0)
      }
    }
  })

  it('does not release partial invalid statements while recovering after a chunk edge', async () => {
    const source = '<urn:s> <urn:p> [ <urn:q> <urn:r> ; BROKEN ] .\n<urn:good> <urn:p> <urn:o> .'
    const bytes = [...new TextEncoder().encode(source)].map((value) => Uint8Array.of(value))
    const result: CompactEventType[] = await collect(turtleEvents(bytes, { tolerant: true }))
    expect(result.filter((event) => event.kind === 'quad')).toHaveLength(1)
    expect(result.find((event) => event.kind === 'quad')?.quad.subject.value).toBe('urn:good')
    expect(result.filter((event) => event.kind === 'diagnostic')).toHaveLength(1)
    const unknown = await collect(
      turtleEvents(['! .', '<urn:good> <urn:p> <urn:o> .'], { tolerant: true }),
    )
    expect(unknown.filter((event) => event.kind === 'quad')).toHaveLength(1)
    expect(unknown.filter((event) => event.kind === 'diagnostic')).toHaveLength(1)
    const limited = await collect(turtleEvents('<urn:s> <urn:p> <urn:a>, <urn:b> .', {
      tolerant: true,
      maxStatementEvents: 1,
    }))
    expect(limited.filter((event) => event.kind === 'quad')).toHaveLength(0)
    expect(limited.some((event) => event.kind === 'diagnostic')).toBe(true)
  })

  it(
    'cancels a stalled refill and releases early-return sources once',
    { timeout: 5_000 },
    async () => {
      for (const parse of [turtle, trig]) {
        const controller = new AbortController()
        let entered!: () => void
        const gate = new Promise<void>((resolve) => entered = resolve)
        let returned = 0
        const source: AsyncIterable<string> = {
          [Symbol.asyncIterator]() {
            let first = true
            return {
              next() {
                if (first) {
                  first = false
                  return Promise.resolve({ done: false as const, value: '<urn:s> <urn:p> "' })
                }
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
        const pending = collect(parse(source, { signal: controller.signal }))
        await gate
        const reason = new Error('stop pending scanner refill')
        controller.abort(reason)
        await expect(pending).rejects.toBe(reason)
        expect(returned).toBe(1)
        let releases = 0
        const complete: Iterable<string> = {
          *[Symbol.iterator]() {
            try {
              yield '<urn:s> <urn:p> <urn:o> .'
              yield '<urn:tail> <urn:p> <urn:o> .'
            } finally {
              releases++
            }
          },
        }
        for await (const _value of parse(complete)) break
        expect(releases).toBe(1)
      }
    },
  )
})
