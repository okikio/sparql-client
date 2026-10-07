import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad } from '../mod.ts'
import { canonicalize, canonicalizeQuads, hash, isomorphic } from './mod.ts'

const ex = 'http://example.com/#'

describe('@okikio/rdf/canon', () => {
  it('cancels canonicalization while its source is stalled', async () => {
    const controller = new AbortController()
    let returned = 0
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const source: AsyncIterable<ReturnType<typeof quad>> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            entered()
            return new Promise<IteratorResult<ReturnType<typeof quad>>>(() => {})
          },
          return() {
            returned++
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }
    const pending = canonicalize(source, { signal: controller.signal })
    await started
    controller.abort(new Error('stop stalled canonicalization'))
    await expect(pending).rejects.toThrow('stop stalled canonicalization')
    expect(returned).toBe(1)
  })
  it('canonicalizes duplicate input as a dataset while bounding all admitted input work', async () => {
    const value = quad(blankNode('a'), namedNode('urn:p'), literal('quoted " 雪'))
    expect(await canonicalize([value, value])).toBe(await canonicalize([value]))
    await expect(canonicalize([value, value], { maxQuads: 1 })).rejects.toThrow('maxQuads')
  })

  it('honors SHA-384 independently of the default SHA-256 blank-node ordering', async () => {
    const input = [
      quad(
        namedNode('http://example.org/vocab#test'),
        namedNode('http://example.org/vocab#A'),
        blankNode('e0'),
      ),
      quad(
        namedNode('http://example.org/vocab#test'),
        namedNode('http://example.org/vocab#B'),
        blankNode('e1'),
      ),
      quad(blankNode('e0'), namedNode('http://example.org/vocab#next'), blankNode('e2')),
      quad(blankNode('e1'), namedNode('http://example.org/vocab#next'), blankNode('e2')),
    ]
    const ids = new Map<string, string>()
    const actual = await canonicalize(input, {
      messageDigestAlgorithm: 'sha384',
      canonicalIdMap: ids,
    })
    expect(actual).toBe(
      '<http://example.org/vocab#test> <http://example.org/vocab#A> _:c14n0 .\n' +
        '<http://example.org/vocab#test> <http://example.org/vocab#B> _:c14n2 .\n' +
        '_:c14n0 <http://example.org/vocab#next> _:c14n1 .\n' +
        '_:c14n2 <http://example.org/vocab#next> _:c14n1 .\n',
    )
    expect(Object.fromEntries(ids)).toEqual({ e0: 'c14n0', e2: 'c14n1', e1: 'c14n2' })
  })
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
    // Independent SHA-256 golden value for _:c14n0 <http://example.com/#p> "value" .\n.
    expect(await hash(input)).toBe(
      '2e00de7ec5197d61472c941e23adbf785feaaed24d5e052f180ccdccacff959e',
    )
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
