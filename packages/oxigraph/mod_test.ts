import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { select, triple, update } from '@okikio/sparql'
import { create } from './mod.ts'

describe('@okikio/oxigraph', () => {
  it('does not pretend a synchronous Store supports timeout cancellation', async () => {
    const client = create({ query: () => true, update: () => undefined })
    let kind = ''
    try {
      await client.queryBoolean('ASK {}', { timeoutMs: 1 })
    } catch (error) {
      kind = error instanceof Error ? error.name : ''
    }
    expect(kind).toBe('TypeError')
  })

  it('accepts structured query and update documents without taking store ownership', async () => {
    let queryText = ''
    let updateText = ''
    const client = create({
      query(query: string) {
        queryText = query
        return true
      },
      update(value: string) {
        updateText = value
      },
    })
    const query = select('*').where(triple('?s', '?p', '?o'))
    expect(await client.queryBoolean(query)).toBe(true)
    await client.update(update().deleteWhere(triple('?s', '?p', '?o')))
    expect(queryText).toBe(query.build().value)
    expect(updateText).toBe('DELETE WHERE { ?s ?p ?o . }')
  })
})
