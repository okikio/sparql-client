import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, type Quad, quad } from '../mod.ts'
import { parse, write } from './mod.ts'

describe('@okikio/rdf/ntriples', () => {
  it('parses triples into the default graph and round-trips them', async () => {
    const source = '<https://example/s> <https://example/p> "value" .\n'
    const values: Quad[] = []
    for await (const value of parse(source)) values.push(value)
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
})
