import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from './mod.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('@okikio/rdf/trig', () => {
  it('retains default and named graph identity', async () => {
    const values = await collect(
      parse('PREFIX : <https://example.com/>\n:a :p :d .\n:g { :a :p :n . }'),
    )
    expect(values.map((value) => value.graph.value)).toEqual(['', 'https://example.com/g'])
  })
  it('distinguishes a top-level property list from the empty anonymous graph label', async () => {
    const property = await collect(
      parse('@prefix : <https://example/> . [ :inside :value ] :outside :tail .'),
    )
    expect(property).toHaveLength(2)
    expect(property.every((item) => item.graph.termType === 'DefaultGraph')).toBe(true)
    expect(property[0]?.subject.value).toBe(property[1]?.subject.value)

    const graph = await collect(parse('@prefix : <https://example/> . [] { :s :p :o . }'))
    expect(graph).toHaveLength(1)
    expect(graph[0]?.graph.termType).toBe('BlankNode')
  })

  it('shares RDF 1.2 language-tag and direction validation with Turtle', async () => {
    const valid = await collect(parse([
      '@prefix : <https://example/> .',
      ':g { :s :private "value"@x-private . }',
      ':g { :s :legacy "value"@i-klingon . }',
      ':g { :s :directed "value"@en-US--rtl . }',
    ].join('\n')))
    expect(valid).toHaveLength(3)

    await expect(
      collect(parse('@prefix : <https://example/> . :g { :s :p "value"@en--LTR . }')),
    ).rejects.toThrow()
  })
})
