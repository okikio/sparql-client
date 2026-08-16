import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal } from '@okikio/rdf'
import { mapBindings, type BindingType } from './binding.ts'

/** Yields two immutable-by-contract binding rows. */
async function* rows(): AsyncGenerator<BindingType> {
  yield new Map([['name', literal('A')]])
  yield new Map([['name', literal('B')]])
}

describe('@okikio/sparql binding mapping', () => {
  it('maps an async binding stream without coercing the source RDF terms', async () => {
    const values: string[] = []
    for await (const value of mapBindings(rows(), (row) => row.get('name')?.value ?? '')) values.push(value)
    expect(values).toEqual(['A', 'B'])
  })
})
