import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { getQueryText, getUpdateText, select, triple, update } from './mod.ts'

describe('@okikio/sparql client document inputs', () => {
  it('resolves strings, documents, and builders without conflating query and update syntax', () => {
    const query = select('*').where(triple('?s', '?p', '?o'))
    const change = update().deleteWhere(triple('?s', '?p', '?o'))

    expect(getQueryText('ASK {}')).toBe('ASK {}')
    expect(getQueryText(query)).toBe(query.build().value)
    expect(getUpdateText(change)).toBe(change.build().value)
  })
})
