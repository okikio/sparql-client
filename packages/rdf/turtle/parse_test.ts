import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '../mod.ts'
import { events, parse } from './mod.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('@okikio/rdf/turtle', () => {
  it('expands RDF 1.2 annotations without constructing a syntax tree', async () => {
    const source = 'PREFIX : <https://example.com/>\n:a :p :b ~ :r {| :source :c |} .'
    const quads = await collect(parse(source))
    expect(quads).toHaveLength(3)
    expect(quads.some((value) => value.predicate.value === RDF.reifies)).toBe(true)
  })

  it('accepts RDF 1.2 double literals whose decimal point is followed by an exponent', async () => {
    const quads = await collect(parse('@prefix : <https://example/> . :s :p 1.e3 .'))
    expect(quads).toHaveLength(1)
    expect(quads[0]?.object.termType).toBe('Literal')
    expect(quads[0]?.object.value).toBe('1.e3')
  })

  it('buffers a malformed statement before tolerant diagnostics are released', async () => {
    const values = await collect(
      events('PREFIX : <https://example.com/>\n:a :p [ :q :r ; BROKEN ] .\n:b :p :c .', {
        tolerant: true,
      }),
    )
    expect(values.filter((value) => value.kind === 'quad')).toHaveLength(1)
    expect(values.filter((value) => value.kind === 'diagnostic')).toHaveLength(1)
  })

  it('validates RDF 1.2 language tags, directions, and language datatypes', async () => {
    const valid = await collect(parse([
      '@prefix : <https://example/> .',
      ':s :private "value"@x-private .',
      ':s :legacy "value"@i-klingon .',
      ':s :directed "value"@en-US--rtl .',
    ].join('\n')))
    expect(valid).toHaveLength(3)

    const invalid = [
      '"value"@en--unk',
      '"value"@en--LTR',
      '"value"@cantbethislong',
      '"value"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#langString>',
      '"value"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString>',
    ]
    for (const object of invalid) {
      await expect(
        collect(parse(`@prefix : <https://example/> . :s :p ${object} .`)),
      ).rejects.toThrow()
    }
  })
})
