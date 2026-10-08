import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { permutations } from './permutations.ts'

describe('canonicalization candidate permutations', () => {
  it('retains positional order, duplicate multiplicity, and independent candidate arrays', () => {
    expect([...permutations([])]).toEqual([[]])
    expect([...permutations(['a', 'b', 'c'])]).toEqual([
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
      ['b', 'a', 'c'],
      ['b', 'c', 'a'],
      ['c', 'a', 'b'],
      ['c', 'b', 'a'],
    ])
    const values = [...permutations(['a', 'a', 'b'])]
    expect(values).toHaveLength(6)
    expect(values.filter((value) => value.join('') === 'aab')).toHaveLength(2)
    values[0]![0] = 'changed'
    expect(values[1]![0]).toBe('a')
  })
  it('admits a large first candidate without overflowing the host stack', () => {
    const input = Array.from({ length: 12_000 }, (_, index) => String(index))
    const iterator = permutations(input)
    expect(iterator.next()).toEqual({ done: false, value: input })
    iterator.return([])
    expect(iterator.next().done).toBe(true)
  })
})
