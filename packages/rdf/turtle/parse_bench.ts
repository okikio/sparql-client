/** Decision benchmark for compact Turtle syntax versus explicit N-Quads representation. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { report } from '../../../bench/report.ts'
import { expectQuads } from '../../../bench/oracle.ts'
import { literal, namedNode, quad } from '../factory.ts'
import { parse as parseNQuads } from '../nquads/mod.ts'
import { parse as parseTurtle } from './mod.ts'

const COUNT = 10_000
const turtle = [
  'PREFIX : <https://example.com/>',
  ...Array.from({ length: COUNT }, (_, index) => `:s${index} :p "value-${index}" .`),
].join('\n')
const nquads = Array.from(
  { length: COUNT },
  (_, index) => `<https://example.com/s${index}> <https://example.com/p> "value-${index}" .`,
).join('\n')

await preflight()

/** Fixture identities are independent of both parser implementations and discarded before timing. */
async function preflight(): Promise<void> {
  const expected = Array.from({ length: COUNT }, (_, index) =>
    quad(
      namedNode(`https://example.com/s${index}`),
      namedNode('https://example.com/p'),
      literal(`value-${index}`),
    ))
  expectQuads(await read(parseTurtle(turtle)), expected, 'Turtle compact')
  expectQuads(await read(parseNQuads(nquads)), expected, 'N-Quads explicit')
}

/** Fully consumes a parser result for a semantic count/digest oracle. */
async function read<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of source) result.push(value)
  return result
}

group('RDF text parse representation cost: 10k equivalent quads', () => {
  bench('N-Quads explicit baseline', async () => {
    const values = await read(parseNQuads(nquads))
    do_not_optimize(values.length)
  }).gc('inner')

  bench('Turtle compact parser', async () => {
    const values = await read(parseTurtle(turtle))
    do_not_optimize(values.length)
  }).gc('inner')
})

await report()
