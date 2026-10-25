import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { name, offers } from '@okikio/vocab/schema'
import { cypher, node } from '../mod.ts'
import { query } from '../../../conformance/query.ts'

describe('@okikio/sparql cypher pattern helper', () => {
  it('preserves forward and reverse edge direction', () => {
    const person = node('person')
    const friend = node('friend')
    const expected = query('SELECT * WHERE { ?person <https://schema.org/name> ?friend }')
    expect(query(`SELECT * WHERE { ${cypher`${person}-[${name}]->${friend}`.value} }`))
      .toEqual(expected)
    expect(query(`SELECT * WHERE { ${cypher`${friend}<-[${name}]-${person}`.value} }`))
      .toEqual(expected)
  })

  it('accepts generated vocabulary predicates without flattening them to strings', () => {
    const product = node('product')
    const maker = node('maker')
    expect(query(`SELECT * WHERE { ${cypher`${product}-[${offers}]->${maker}`.value} }`))
      .toEqual(query('SELECT * WHERE { ?product <https://schema.org/offers> ?maker }'))
  })
})
