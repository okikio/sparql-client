import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad } from '../mod.ts'
import { canonicalize, canonicalizeQuads, hash, isomorphic, type CanonizerType } from './mod.ts'

const canonical = '<https://example.test/s> <https://example.test/p> "value" .\n'
const canonizer: CanonizerType = {
  async canonize(_input, options) {
    expect(options.algorithm).toBe('RDFC-1.0')
    expect(options.rejectURDNA2015).toBe(true)
    return canonical
  },
}

describe('@okikio/rdf/canon', () => {
  it('owns the RDFC-1.0 option contract and native quad conversion', async () => {
    const input = [quad(blankNode('input'), namedNode('https://example.test/p'), literal('value'))]
    expect(await canonicalize(input, { canonizer })).toBe(canonical)
    const values = await canonicalizeQuads(input, { canonizer })
    expect(values).toHaveLength(1)
    expect(values[0]?.subject.value).toBe('https://example.test/s')
  })

  it('rejects RDF 1.2 terms that RDFC-1.0 does not define', async () => {
    const directional = quad(
      namedNode('https://example.test/s'),
      namedNode('https://example.test/p'),
      literal('bonjour', { language: 'fr', direction: 'ltr' }),
    )
    await expect(canonicalize([directional], { canonizer })).rejects.toThrow('directional')
  })

  it('hashes canonical bytes and compares canonical representations', async () => {
    const input = [quad(namedNode('https://example.test/a'), namedNode('https://example.test/p'), literal('x'))]
    expect(/^[0-9a-f]{64}$/u.test(await hash(input, { canonizer }))).toBe(true)
    expect(await isomorphic(input, input, { canonizer })).toBe(true)
  })
})
