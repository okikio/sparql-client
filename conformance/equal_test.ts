import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, namedNode, quad } from '@okikio/rdf'
import { isomorphic } from './equal.ts'

describe('dataset isomorphism oracle', () => {
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
