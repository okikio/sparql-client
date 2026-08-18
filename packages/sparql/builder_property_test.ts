import { test } from 'node:test'
import { expect } from '@std/expect'
import * as fc from 'fast-check'
import { Parser } from 'sparqljs'
import { select, triple } from './mod.ts'

const name = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/)
const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)

test('query builder emits SPARQL accepted by an independent parser', () => {
  fc.assert(
    fc.property(
      name,
      name,
      segment,
      fc.integer({ min: 0, max: 10_000 }),
      (subject, object, predicate, limit) => {
        const query = select([subject, object])
          .where(triple(subject, `https://example.com/${predicate}`, object))
          .limit(limit)
          .build().value
        const parsed = Parser().parse(query)
        expect(parsed.type).toBe('query')
        expect(parsed.queryType).toBe('SELECT')
      },
    ),
    { seed: 20260817, numRuns: 500 },
  )
})
