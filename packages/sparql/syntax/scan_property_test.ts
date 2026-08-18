import { test } from 'node:test'
import { expect } from '@std/expect'
import * as fc from 'fast-check'
import { inspect } from './mod.ts'

const word = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/)

test('syntax inspection is invariant to arbitrary source chunking', async () => {
  await fc.assert(
    fc.asyncProperty(
      word,
      word,
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 20 }),
      async (left, right, widths) => {
        const source =
          `SELECT ?${left} ?${right} WHERE { ?${left} <https://example.com/p> ?${right} . FILTER(?${left} != ?${right}) }`
        const direct = await inspect(source, { trivia: true })
        const chunks: string[] = []
        let offset = 0
        let index = 0
        while (offset < source.length) {
          const width = widths[index++ % widths.length]!
          chunks.push(source.slice(offset, offset + width))
          offset += width
        }
        const chunked = await inspect(chunks, { trivia: true })
        expect(chunked.tokens).toEqual(direct.tokens)
        expect(chunked.diagnostics).toEqual(direct.diagnostics)
        expect(chunked.features).toEqual(direct.features)
      },
    ),
    { seed: 20260817, numRuns: 300 },
  )
})

test('every emitted token range reconstructs its exact raw source spelling', async () => {
  await fc.assert(
    fc.asyncProperty(word, word, async (left, right) => {
      const source = `ASK WHERE { ?${left} <https://example.com/p> "${right}"@en . } # end\n`
      const document = await inspect(source, { trivia: true })
      for (const token of document.tokens) {
        expect(source.slice(token.range.start, token.range.end)).toBe(token.raw)
        expect(token.range.end).toBeGreaterThanOrEqual(token.range.start)
        expect(token.range.line).toBeGreaterThanOrEqual(1)
        expect(token.range.column).toBeGreaterThanOrEqual(1)
      }
    }),
    { seed: 20260817, numRuns: 300 },
  )
})
