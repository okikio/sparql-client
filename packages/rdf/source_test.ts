import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad } from './mod.ts'
import { iterate } from './source.ts'

const value = quad(namedNode('urn:s'), namedNode('urn:p'), literal('o'))

describe('@okikio/rdf source iteration', () => {
  it('adapts synchronous and asynchronous quad sources to one async contract', async () => {
    const sync = []
    for await (const item of iterate([value])) sync.push(item)

    async function* asyncSource() {
      yield value
    }
    const asyncValues = []
    for await (const item of iterate(asyncSource())) asyncValues.push(item)

    expect(sync).toHaveLength(1)
    expect(asyncValues).toHaveLength(1)
    expect(sync[0]?.equals(asyncValues[0])).toBe(true)
  })
})
