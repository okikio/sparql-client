import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad } from '../mod.ts'
import { canonicalize, canonicalizeQuads, hash, isomorphic } from './mod.ts'

const ex = 'http://example.com/#'

describe('@okikio/rdf/canon', () => {
  it('canonicalizes a dataset with uniquely hashed blank nodes', async () => {
    const input = [
      quad(namedNode(`${ex}p`), namedNode(`${ex}q`), blankNode('e0')),
      quad(namedNode(`${ex}p`), namedNode(`${ex}r`), blankNode('e1')),
      quad(blankNode('e0'), namedNode(`${ex}s`), namedNode(`${ex}u`)),
      quad(blankNode('e1'), namedNode(`${ex}t`), namedNode(`${ex}u`)),
    ]
    expect(await canonicalize(input)).toBe(
      `<${ex}p> <${ex}q> _:c14n0 .\n` +
        `<${ex}p> <${ex}r> _:c14n1 .\n` +
        `_:c14n0 <${ex}s> <${ex}u> .\n` +
        `_:c14n1 <${ex}t> <${ex}u> .\n`,
    )
  })

  it('uses N-degree hashing to order blank nodes with shared first-degree hashes', async () => {
    const ids = new Map<string, string>()
    const input = [
      quad(namedNode(`${ex}p`), namedNode(`${ex}q`), blankNode('e1')),
      quad(namedNode(`${ex}p`), namedNode(`${ex}q`), blankNode('e0')),
      quad(blankNode('e2'), namedNode(`${ex}r`), blankNode('e3')),
      quad(blankNode('e1'), namedNode(`${ex}p`), blankNode('e3')),
      quad(blankNode('e0'), namedNode(`${ex}p`), blankNode('e2')),
    ]
    const value = await canonicalize(input, { canonicalIdMap: ids, maxWorkFactor: 64 })
    expect(value).toBe(
      `<${ex}p> <${ex}q> _:c14n2 .\n` +
        `<${ex}p> <${ex}q> _:c14n3 .\n` +
        `_:c14n0 <${ex}r> _:c14n1 .\n` +
        `_:c14n2 <${ex}p> _:c14n1 .\n` +
        `_:c14n3 <${ex}p> _:c14n0 .\n`,
    )
    expect(Object.fromEntries(ids)).toEqual({ e2: 'c14n0', e3: 'c14n1', e1: 'c14n2', e0: 'c14n3' })
  })

  it('returns canonical native quads and stable digests', async () => {
    const input = [quad(blankNode('x'), namedNode(`${ex}p`), literal('value'))]
    const values = await canonicalizeQuads(input)
    expect(values).toHaveLength(1)
    expect(values[0]?.subject.value).toBe('c14n0')
    expect(await hash(input)).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      await isomorphic(input, [quad(blankNode('other'), namedNode(`${ex}p`), literal('value'))]),
    ).toBe(true)
  })

  it('rejects RDF 1.2 directional literals and bounded N-degree work exhaustion', async () => {
    await expect(canonicalize([
      quad(
        namedNode(`${ex}s`),
        namedNode(`${ex}p`),
        literal('bonjour', { language: 'fr', direction: 'ltr' }),
      ),
    ])).rejects.toThrow('directional')

    const input = [
      quad(blankNode('a'), namedNode(`${ex}p`), blankNode('b')),
      quad(blankNode('b'), namedNode(`${ex}p`), blankNode('a')),
    ]
    await expect(canonicalize(input, { maxDeepIterations: 0 })).rejects.toThrow('work limit')
  })
})
