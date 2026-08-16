/** Decision benchmark for structured SPARQL construction overhead. @module */

import { bench, do_not_optimize, group, run } from 'mitata'
import { select } from './builder.ts'
import { triple } from './patterns/triples.ts'
import { namedNode } from '@okikio/rdf'

const ROWS = 1_000
const name = namedNode('https://schema.org/name')
const patterns = Array.from(
  { length: ROWS },
  (_, index) => triple(`product${index}`, name, `?name${index}`),
)
const directPatterns = patterns.map((pattern) => pattern.value)

const structured = (): string => select('*').where(...patterns).build().value
const direct = (): string => `SELECT *\nWHERE {\n${directPatterns.map((value) => `  ${value}`).join('\n')}\n}`

if (structured() !== direct()) throw new Error('SPARQL builder benchmark oracle failed.')

group('sparql structured construction: 1k triple patterns', () => {
  bench('direct string assembly baseline', () => {
    do_not_optimize(direct())
  })

  bench('immutable QueryBuilder', () => {
    do_not_optimize(structured())
  })
})

await run()
