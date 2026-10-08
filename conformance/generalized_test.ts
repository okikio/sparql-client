import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from '@okikio/rdf/nquads'
import { isomorphicGeneralized, readGeneralized } from './generalized.ts'

describe('generalized JSON-LD RDF oracle', () => {
  it('reads generalized predicates while retaining strict standard N-Quads parsing', async () => {
    const input = '_:s _:p "value" .\n'
    const values = await readGeneralized(input)
    expect(values[0]!.predicate.termType).toBe('BlankNode')
    let failed = false
    try {
      for await (const _statement of parse(input)) { /* Exhaust the actual standard parser. */ }
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })

  it('retains a consistent blank-node bijection across every generalized position', async () => {
    const left = await readGeneralized('_:s _:s _:o .\n')
    const equal = await readGeneralized('_:a _:a _:b .\n')
    const different = await readGeneralized('_:a _:b _:b .\n')
    expect(isomorphicGeneralized(left, equal)).toBe(true)
    expect(isomorphicGeneralized(left, different)).toBe(false)
    expect(
      isomorphicGeneralized(
        await readGeneralized('_:s _:p "_:x" .\n'),
        await readGeneralized('_:a _:b "_:y" .\n'),
      ),
    ).toBe(false)
  })
})
