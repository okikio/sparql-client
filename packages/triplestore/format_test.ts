import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { FORMAT, generationName, parseCommit, parseFormat, writeRecord } from './format.ts'

describe('@okikio/triplestore format records', () => {
  it('round-trips the root format marker', () => {
    expect(parseFormat(writeRecord(FORMAT))).toEqual(FORMAT)
  })

  it('validates homogeneous delta and snapshot commit invariants', () => {
    const checksum = `sha256:${'0'.repeat(64)}`
    const delta = parseCommit(JSON.stringify({
      version: 2,
      generation: 2,
      parent: 1,
      mode: 'delta',
      operation: 'delete',
      segment: 'segments/0000000000000002.delta.nq',
      checksum,
      quadCount: 5,
    }))
    expect(delta.operation).toBe('delete')

    expect(() => parseCommit(JSON.stringify({
      ...delta,
      mode: 'snapshot',
      operation: 'add',
      segment: 'segments/0000000000000002.nq',
    }))).toThrow('must not declare')
  })

  it('uses lexicographically sortable generation names and rejects invalid generations', () => {
    expect(generationName(42)).toBe('0000000000000042')
    expect(() => generationName(0)).toThrow()
  })
})
