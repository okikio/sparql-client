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
          const expected = new Dataset(values.filter((value) => value.subject.equals(target)))
          expect([...dataset.match(target)]).toEqual([...expected])
        },
      ),
    )
  })
})
