import { test } from 'node:test'
import { expect } from '@std/expect'
import * as fc from 'fast-check'
import { Dataset, key, literal, namedNode, type Quad, quad } from '@okikio/rdf'
import { open } from './mod.ts'
import { MemoryFileSystem } from './_memory_test.ts'

const id = fc.integer({ min: 0, max: 31 })
const operation = fc.record({ kind: fc.constantFrom<'add' | 'delete'>('add', 'delete'), id })

function value(id: number): Quad {
  return quad(
    namedNode(`https://example.com/s/${id}`),
    namedNode('https://example.com/p'),
    literal(String(id % 7)),
  )
}

test('persistent operation sequences match the in-memory RDF Dataset model after reopen', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(operation, { minLength: 0, maxLength: 120 }), async (operations) => {
      const fs = new MemoryFileSystem()
      const expected = new Dataset()
      let store = await open(fs, { path: '/db' })

      for (let index = 0; index < operations.length; index++) {
        const current = operations[index]!
        const item = value(current.id)
        if (current.kind === 'add') {
          expected.add(item)
          await store.add(item)
        } else {
          expected.delete(item)
          await store.delete(item)
        }
        if ((index + 1) % 17 === 0) {
          await store.close()
          store = await open(fs, { path: '/db' })
        }
      }

      await store.close()
      const reopened = await open(fs, { path: '/db' })
      const actualKeys = [...reopened.snapshot()].map(key).sort()
      const expectedKeys = [...expected].map(key).sort()
      expect(actualKeys).toEqual(expectedKeys)
      expect(reopened.size).toBe(expected.size)
    }),
    { seed: 20260817, numRuns: 120 },
  )
})
