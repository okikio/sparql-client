import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import fc from 'fast-check'
import { blankNode, literal, namedNode } from './mod.ts'

describe('RDF term properties', () => {
  it('satisfies equality reflexivity and symmetry for native terms', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => {
      const left = namedNode(`urn:a:${encodeURIComponent(a)}`)
      const right = namedNode(`urn:a:${encodeURIComponent(b)}`)
      expect(left.equals(left)).toBe(true)
      expect(left.equals(right)).toBe(right.equals(left))
    }))
  })

  it('distinguishes blank nodes, IRIs, and literals with equal lexical values', () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), (value) => {
      const safe = value.replace(/[^A-Za-z0-9]/g, 'x') || 'x'
      expect(blankNode(safe).equals(namedNode(safe))).toBe(false)
      expect(namedNode(safe).equals(literal(safe))).toBe(false)
    }))
  })
})
