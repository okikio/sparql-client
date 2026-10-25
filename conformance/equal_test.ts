import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad } from '@okikio/rdf'
import { isomorphic } from './equal.ts'

describe('dataset isomorphism oracle', () => {
  it('compares graph sets even when a parser emits duplicate statements', () => {
    const left = quad(blankNode('a'), namedNode('urn:p'), literal('value'))
    const right = quad(blankNode('b'), namedNode('urn:p'), literal('value'))
    expect(isomorphic([left, left], [right])).toBe(true)
    expect(isomorphic([left], [right, right])).toBe(true)
  })

  it('does not confuse punctuation inside literals with term separators', () => {
    const subject = namedNode('urn:s'), predicate = namedNode('urn:p')
    const left = quad(subject, predicate, literal('a|b', namedNode('urn:type')))
    const right = quad(subject, predicate, literal('a', namedNode('|b||urn:type')))
    expect(isomorphic([left], [right])).toBe(false)
  })
  it('rejects same-size datasets with a different predicate, language, datatype, or graph', () => {
    const subject = namedNode('urn:s')
    const predicate = namedNode('urn:p')
    const value = literal('value', 'en')
    const baseline = quad(subject, predicate, value, namedNode('urn:g'))
    const alternatives = [
      quad(subject, namedNode('urn:other'), value, namedNode('urn:g')),
      quad(subject, predicate, literal('value', 'fr'), namedNode('urn:g')),
      quad(subject, predicate, literal('value', namedNode('urn:datatype')), namedNode('urn:g')),
      quad(subject, predicate, value, namedNode('urn:other-graph')),
      quad(subject, predicate, value),
    ]
    for (const alternative of alternatives) {
      expect(isomorphic([baseline], [alternative])).toBe(false)
    }
    expect(isomorphic([baseline], [baseline])).toBe(true)
  })

  it('matches more than nine blank nodes without depending on their labels', () => {
    const predicate = namedNode('urn:next')
    const left = Array.from(
      { length: 12 },
      (_, index) =>
        quad(blankNode(`left-${index}`), predicate, blankNode(`left-${(index + 1) % 12}`)),
    )
    const right = Array.from(
      { length: 12 },
      (_, index) =>
        quad(
          blankNode(`right-${(index + 7) % 12}`),
          predicate,
          blankNode(`right-${(index + 8) % 12}`),
        ),
    )
    expect(isomorphic(left, right)).toBe(true)
  })

  it('rejects equal-size blank-node graphs with different topology', () => {
    const predicate = namedNode('urn:next')
    const left = [
      quad(blankNode('a'), predicate, blankNode('b')),
      quad(blankNode('b'), predicate, blankNode('a')),
    ]
    const right = [
      quad(blankNode('x'), predicate, blankNode('x')),
      quad(blankNode('y'), predicate, blankNode('y')),
    ]
    expect(isomorphic(left, right)).toBe(false)
  })
})
