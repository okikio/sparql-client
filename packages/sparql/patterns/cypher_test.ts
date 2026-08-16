import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { name, offers } from '@okikio/vocab/schema'
import { cypher, node } from '../mod.ts'

describe('@okikio/sparql cypher pattern helper', () => {
  it('preserves forward and reverse edge direction', () => {
    const person = node('person')
    const friend = node('friend')
    expect(cypher`${person}-[${name}]->${friend}`.value.includes(
      '?person <https://schema.org/name> ?friend .',
    )).toBe(true)
    expect(cypher`${friend}<-[${name}]-${person}`.value.includes(
      '?person <https://schema.org/name> ?friend .',
    )).toBe(true)
  })

  it('accepts generated vocabulary predicates without flattening them to strings', () => {
    const product = node('product')
    const maker = node('maker')
    expect(cypher`${product}-[${offers}]->${maker}`.value.includes(
      '?product <https://schema.org/offers> ?maker .',
    )).toBe(true)
  })
})
