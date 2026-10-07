/** Decision benchmark for structured SPARQL construction overhead. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { report } from '../../bench/report.ts'
import { select } from './builder.ts'
import { triple } from './patterns/triples.ts'
import { namedNode } from '@okikio/rdf'
import { Parser } from '@traqula/parser-sparql-1-2'

const ROWS = 1_000
const name = namedNode('https://schema.org/name')
const patterns = Array.from(
  { length: ROWS },
  (_, index) => triple(`?product${index}`, name, `?name${index}`),
)
// The baseline is hand-written independently of the builder's serialized PatternValue.
const directPatterns = Array.from(
  { length: ROWS },
  (_, index) => `?product${index} <https://schema.org/name> ?name${index} .`,
)

const structured = (): string => select('*').where(...patterns).build().value
const direct = (): string =>
  `SELECT *\nWHERE {\n${directPatterns.map((value) => `  ${value}`).join('\n')}\n}`

/** Complete independent triple identities retain multiplicity and ignore conjunction order. */
const expected = Array.from({ length: ROWS }, (_, index) =>
  JSON.stringify([
    ['variable', `product${index}`],
    ['namedNode', 'https://schema.org/name'],
    ['variable', `name${index}`],
  ])).sort()
const parser = new Parser()

/** Parse public output independently; formatting is irrelevant, but query roles and every term matter. */
function expectQuery(text: string): void {
  const query = parser.parse(text)
  if (
    query.type !== 'query' || query.subType !== 'select' || query.context.length !== 0 ||
    query.variables.length !== 1 || query.variables[0]?.type !== 'wildcard' ||
    query.distinct || query.reduced || query.datasets.clauses.length !== 0 ||
    Object.keys(query.solutionModifiers).length !== 0 || query.where?.subType !== 'group' ||
    query.where.patterns.length !== 1
  ) throw new Error('SPARQL builder benchmark query-shape oracle failed.')
  const pattern = query.where.patterns[0]!
  if (pattern.subType !== 'bgp' || pattern.triples.length !== ROWS) {
    throw new Error('SPARQL builder benchmark complete-pattern oracle failed.')
  }
  const actual = pattern.triples.map((row) => {
    if (row.type !== 'triple' || (row.annotations?.length ?? 0) !== 0) {
      throw new Error('SPARQL builder benchmark triple-role oracle failed.')
    }
    return JSON.stringify([row.subject, row.predicate, row.object].map((term) => {
      if (term.type !== 'term' || (term.subType !== 'variable' && term.subType !== 'namedNode')) {
        throw new Error('SPARQL builder benchmark term-role oracle failed.')
      }
      return [term.subType, term.value]
    }))
  }).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('SPARQL builder benchmark complete-term oracle failed.')
  }
}

expectQuery(structured())
expectQuery(direct())
expectQuery(`# Harmless formatting differs.\n${direct().replaceAll('\n', '  ')}`)
// These controls exercise the actual semantic oracle before timing, with valid syntax but wrong roles/terms.
for (
  const wrong of [
    direct().replace('SELECT *', 'ASK'),
    direct().replace('SELECT *', 'SELECT ?name0'),
    direct().replace('?product0 ', '?wrongSubject '),
    direct().replace('https://schema.org/name', 'https://schema.org/wrong'),
    direct().replace('?name0 .', '?wrongObject .'),
    direct().replace('?name0 .', '<urn:wrongTermType> .'),
  ]
) {
  // A grammar rejection cannot stand in for discriminating a valid but semantically wrong query.
  parser.parse(wrong)
  let rejected = false
  try {
    expectQuery(wrong)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('SPARQL builder benchmark semantic negative control was accepted.')
}

// This diagnostic mode executes all real preflights/controls without registering or timing benchmarks.
if (Deno.env.get('BENCH_BUILDER_PREFLIGHT_ONLY') !== '1') {
  group('sparql structured construction: 1k triple patterns', () => {
    bench('direct string assembly baseline', () => {
      do_not_optimize(direct())
    })

    bench('immutable QueryBuilder', () => {
      do_not_optimize(structured())
    })
  })

  await report()
} else {
  console.log(
    'Builder semantic preflight passed: 1000 independent triples, 3 valid queries, 6 valid-syntax negative controls; no timings collected.',
  )
}
