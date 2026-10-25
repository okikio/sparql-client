import { test } from 'node:test'
import { expect } from '@std/expect'
import * as fc from 'fast-check'
import { Parser } from '@traqula/parser-sparql-1-2'
import { select, triple } from './mod.ts'

const name = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/)
const names = fc.uniqueArray(name, { minLength: 2, maxLength: 2 })
const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)

test('query builder emits SPARQL accepted by an independent parser', () => {
  fc.assert(
    fc.property(
      names,
      segment,
      fc.integer({ min: 0, max: 10_000 }),
      ([subject, object], predicate, limit) => {
        const query = select([subject!, object!])
          .where(triple(`?${subject!}`, `https://example.com/${predicate}`, `?${object!}`))
          .limit(limit)
          .build().value
        const parsed = new Parser().parse(query)
        expect(parsed.type).toBe('query')
        expect(parsed.subType).toBe('select')
        expect(parsed).toMatchObject({
          variables: [{ value: subject }, { value: object }],
          where: {
            patterns: [{
              triples: [{
                subject: { subType: 'variable', value: subject },
                predicate: { subType: 'namedNode', value: `https://example.com/${predicate}` },
                object: { subType: 'variable', value: object },
              }],
            }],
          },
          solutionModifiers: { limitOffset: { limit } },
        })
        if (parsed.type !== 'query' || parsed.subType !== 'select') {
          throw new TypeError('Expected SELECT query.')
        }
        expect(parsed.variables).toHaveLength(2)
        expect(parsed.where?.patterns).toHaveLength(1)
        const pattern = parsed.where?.patterns[0]
        if (!pattern || !('triples' in pattern)) {
          throw new TypeError('Expected basic graph pattern.')
        }
        expect(pattern.triples).toHaveLength(1)
      },
    ),
    { seed: 20260817, numRuns: 500 },
  )
})
