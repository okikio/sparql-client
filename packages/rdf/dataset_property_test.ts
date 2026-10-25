import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import fc from 'fast-check'
import { Dataset, literal, namedNode, quad } from './mod.ts'

describe('Dataset properties', () => {
  it('indexed match agrees with a direct scan oracle', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 4 })), {
          maxLength: 80,
        }),
        fc.integer({ min: 0, max: 8 }),
        (rows, subject) => {
          const values = rows.map(([s, o]) =>
            quad(namedNode(`urn:s:${s}`), namedNode('urn:p'), literal(String(o)))
          )
          const dataset = new Dataset(values)
          const target = namedNode(`urn:s:${subject}`)
          // Independent set oracle: neither indexing nor Dataset deduplication builds expectations.
          const expected = [
            ...new Set(
              rows.filter(([s]) => s === subject).map(([, o]) =>
                JSON.stringify([
                  ['NamedNode', `urn:s:${subject}`],
                  ['NamedNode', 'urn:p'],
                  ['Literal', String(o), '', 'http://www.w3.org/2001/XMLSchema#string'],
                  ['DefaultGraph', ''],
                ])
              ),
            ),
          ]
          const actual = [...dataset.match(target)]
          const projected = actual.map((value) =>
            JSON.stringify([
              [value.subject.termType, value.subject.value],
              [value.predicate.termType, value.predicate.value],
              value.object.termType === 'Literal'
                ? [
                  value.object.termType,
                  value.object.value,
                  value.object.language,
                  value.object.datatype.value,
                ]
                : [value.object.termType, value.object.value],
              [value.graph.termType, value.graph.value],
            ])
          )
          expect(projected.sort()).toEqual(expected.sort())
        },
      ),
    )
  })
})
