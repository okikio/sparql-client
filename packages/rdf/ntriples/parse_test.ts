import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, type Quad, quad } from '../mod.ts'
import { parse, write } from './mod.ts'

/** Collects one parsed N-Triples source so rejection tests consume the async generator. */
async function all(source: string): Promise<Quad[]> {
  const values: Quad[] = []
  for await (const value of parse(source)) values.push(value)
  return values
}

describe('@okikio/rdf/ntriples', () => {
  it('parses triples into the default graph and round-trips them', async () => {
    const source = '<https://example/s> <https://example/p> "value" .\n'
    const values = await all(source)
    expect(values.length).toBe(1)
    expect(values[0]?.graph.termType).toBe('DefaultGraph')
    expect(write(values)).toBe(source)
  })

  it('rejects named graphs during serialization', () => {
    const value = quad(
      namedNode('https://example/s'),
      namedNode('https://example/p'),
      literal('value'),
      namedNode('https://example/g'),
    )
    expect(() => write([value])).toThrow('N-Triples cannot serialize named graphs')
  })

  it('accepts the RDF 1.1 minimal-whitespace fixture across term forms', async () => {
    const source = [
      '<http://example/s><http://example/p><http://example/o>.',
      '<http://example/s><http://example/p>"Alice".',
      '<http://example/s><http://example/p>_:o.',
      '_:s<http://example/p><http://example/o>.',
      '_:s<http://example/p>"Alice".',
      '_:s<http://example/p>_:bnode1.',
      '',
    ].join('\n')
    expect(await all(source)).toHaveLength(6)
  })

  it('accepts RDF 1.2 terms without separating whitespace', async () => {
    const source =
      '<http://example/s><http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies><<(<http://example/s2><http://example/p2><http://example/o2>)>>.\n'
    const values = await all(source)
    expect(values.length).toBe(1)
    expect(values[0]?.object.termType).toBe('Quad')
  })

  it('accepts nested RDF 1.2 triple terms without separating whitespace', async () => {
    const source =
      '<http://example/s><http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies><<(<http://example/s2><http://example/q2><<(<http://example/s3><http://example/p3><http://example/o3>)>>)>>.'
    const values = await all(source)
    expect(values.length).toBe(1)
    expect(values[0]?.object.termType).toBe('Quad')
  })

  it('accepts version announcements without required separating whitespace', async () => {
    expect(await all('VERSION"1.2"\n<http://example/s><http://example/p><http://example/o>.\n'))
      .toHaveLength(1)
  })

  it('rejects malformed RDF 1.2 language and direction forms', async () => {
    const invalid = [
      '"Hello"@en--unk',
      '"Hello"@en--LTR',
      '"Hello"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#langString>',
      '"Hello"@cantbethislong',
      '"Hello"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString>',
    ]
    for (const object of invalid) {
      await expect(all(`<http://example/a><http://example/b>${object}.\n`)).rejects.toThrow()
    }
  })

  it('accepts private-use, grandfathered, and directional BCP 47 language tags', async () => {
    const values = await all([
      '<http://example/a><http://example/b>"private"@x-private.',
      '<http://example/a><http://example/b>"legacy"@i-klingon.',
      '<http://example/a><http://example/b>"directed"@en-US--rtl.',
      '',
    ].join('\n'))
    expect(values).toHaveLength(3)
  })

  it('requires absolute IRIs and exact RDF blank-node label characters', async () => {
    await expect(
      all('<http://example/a><http://example/b><//example/missing-scheme>.\n'),
    ).rejects.toThrow('not absolute')
    await expect(
      all('_:\u0301bad<http://example/b><http://example/c>.\n'),
    ).rejects.toThrow('blank-node label')

    const astral = await all('_:\u{10000}<http://example/b><http://example/c>.\n')
    expect(astral[0]?.subject.termType).toBe('BlankNode')
  })
})
