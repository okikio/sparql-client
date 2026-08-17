/** Decision benchmark for compact Turtle syntax versus explicit N-Quads representation. @module */

import { bench, do_not_optimize, group, run } from 'mitata'
import { datasetKey } from '../dataset.ts'
import { parse as parseNQuads } from '../nquads/mod.ts'
import { parse as parseTurtle } from './mod.ts'

const COUNT = 10_000
const turtle = [
  'PREFIX : <https://example.com/>',
  ...Array.from({ length: COUNT }, (_, index) => `:s${index} :p "value-${index}" .`),
].join('\n')
const nquads = Array.from(
  { length: COUNT },
  (_, index) => `<https://example.com/s/${index}> <https://example.com/p> "value-${index}" .`,
).join('\n')

const turtleExpected = await read(parseTurtle(turtle))
const nquadsExpected = await read(parseNQuads(nquads))
if (turtleExpected.length !== COUNT || datasetKey(turtleExpected) !== datasetKey(nquadsExpected)) {
  throw new Error('Turtle benchmark semantic oracle does not match equivalent N-Quads data.')
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

await run()
