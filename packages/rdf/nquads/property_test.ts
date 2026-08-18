import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import fc from 'fast-check'
import { defaultGraph, literal, namedNode, quad } from '../mod.ts'
import { parse, write } from './mod.ts'

async function read(source: string | AsyncIterable<Uint8Array>) {
  const values = []
  for await (const value of parse(source)) values.push(value)
  return values
}

function chunks(text: string, sizes: readonly number[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const bytes = new TextEncoder().encode(text)
      let offset = 0
      for (const size of sizes) {
        if (offset >= bytes.length) break
        const end = Math.min(bytes.length, offset + Math.max(1, size))
        yield bytes.slice(offset, end)
        offset = end
      }
      if (offset < bytes.length) yield bytes.slice(offset)
    },
  }
}

describe('N-Quads properties', () => {
  it('round-trips arbitrary safe lexical values', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.string(), { maxLength: 40 }), async (values) => {
      const quads = values.map((value, index) =>
        quad(
          namedNode(`urn:s:${index}`),
          namedNode('urn:p'),
          literal(value),
          index % 2 ? namedNode('urn:g') : defaultGraph(),
        )
      )
      expect(await read(write(quads))).toEqual(quads)
    }))
  })

  it('is invariant to arbitrary byte chunking', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
        fc.array(fc.integer({ min: 1, max: 31 }), { minLength: 1, maxLength: 30 }),
        async (values, sizes) => {
          const source = write(
            values.map((value, index) =>
              quad(namedNode(`urn:s:${index}`), namedNode('urn:p'), literal(value))
            ),
          )
          expect(await read(chunks(source, sizes))).toEqual(await read(source))
        },
      ),
    )
  })
})
