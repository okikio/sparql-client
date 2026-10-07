import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { exportMap, sameExports } from './exports.ts'

describe('direct package export maps', () => {
  it('compares public names and targets independently of insertion order', () => {
    expect(sameExports({ '.': './mod.ts', './http': './http/mod.ts' }, {
      './http': './http/mod.ts',
      '.': './mod.ts',
    })).toBe(true)
    expect(sameExports({ './Å': './first.ts', './Å': './second.ts' }, {
      './Å': './second.ts',
      './Å': './first.ts',
    })).toBe(true)
    expect(sameExports('./mod.ts', { '.': './mod.ts' })).toBe(true)
    expect(sameExports({ '.': './mod.ts' }, { '.': './other.ts' })).toBe(false)
    expect(sameExports({ '.': './mod.ts' }, { '.': './mod.ts', './extra': './extra.ts' })).toBe(
      false,
    )
    expect(sameExports({ './first': './mod.ts' }, { './second': './mod.ts' })).toBe(false)
  })
  it('rejects conditional maps and malformed direct targets', () => {
    for (const value of [null, [], { '.': { import: './mod.ts' } }, { '.': 1 }]) {
      expect(() => exportMap(value)).toThrow(TypeError)
    }
  })
})
