/** Decision benchmark for N-Quads whole-source versus chunked streaming overhead. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { report } from '../../../bench/report.ts'
import { expectQuads } from '../../../bench/oracle.ts'
import { literal, namedNode, quad } from '../factory.ts'
import { parse } from './mod.ts'

const COUNT = 10_000
const text = Array.from(
  { length: COUNT },
  (_, index) =>
    `<https://example.com/s/${index}> <https://example.com/p> "value-${index}" <https://example.com/g/${
      index % 8
    }> .`,
).join('\n')
const chunks = split(text, 4096)
await preflight()

/** Expected RDF terms come from fixture meaning rather than either parser invocation. */
async function preflight(): Promise<void> {
  const expected = Array.from({ length: COUNT }, (_, index) =>
    quad(
      namedNode(`https://example.com/s/${index}`),
      namedNode('https://example.com/p'),
      literal(`value-${index}`),
      namedNode(`https://example.com/g/${index % 8}`),
    ))
  expectQuads(await read(text), expected, 'N-Quads whole')
  expectQuads(await read(chunks), expected, 'N-Quads chunked')
}

/** Splits one deterministic fixture without adding work to the timed callback. */
function split(value: string, size: number): string[] {
  const result: string[] = []
  for (let offset = 0; offset < value.length; offset += size) {
    result.push(value.slice(offset, offset + size))
  }
  return result
}

/** Fully consumes one parser result so parser work cannot be optimized away. */
async function read(source: string | Iterable<string>) {
  const result = []
  for await (const value of parse(source)) result.push(value)
  return result
}

group('N-Quads parse: 10k quads', () => {
  bench('whole string', async () => {
    const values = await read(text)
    do_not_optimize(values.length)
  }).gc('inner')

  bench('4 KiB chunks', async () => {
    const values = await read(chunks)
    do_not_optimize(values.length)
  }).gc('inner')
})

await report()
