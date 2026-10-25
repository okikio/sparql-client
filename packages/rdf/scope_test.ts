import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { dataset, type Quad } from '@okikio/rdf'
import { parse as turtle } from '@okikio/rdf/turtle'
import { parse as trig } from '@okikio/rdf/trig'
import { parse as xml } from '@okikio/rdf/xml'
import { parse as microdata } from '@okikio/rdf/microdata'

async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const values: Quad[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('RDF document blank-node identity', () => {
  for (
    const [name, parse, input] of [
      ['Turtle', turtle, '_:node <urn:test:p> _:node . [] <urn:test:p> [] .'],
      ['TriG', trig, '_:graph { _:node <urn:test:p> _:node . [] <urn:test:p> [] . }'],
      [
        'RDF/XML',
        xml,
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="urn:test:"><rdf:Description rdf:nodeID="shared"><ex:p rdf:nodeID="shared"/></rdf:Description></rdf:RDF>',
      ],
    ] as const
  ) {
    it(`reuses ${name} labels within a document and isolates separate documents`, async () => {
      const first = await collect(parse(input))
      const second = await collect(parse(input))
      expect(first[0]?.subject.equals(first[0].object)).toBe(true)
      expect(first[0]?.subject.equals(second[0]!.subject)).toBe(false)
      expect(dataset([...first, ...second]).size).toBe(first.length + second.length)
      if (name === 'TriG') expect(first[0]?.graph.equals(second[0]!.graph)).toBe(false)
    })
  }

  it('keeps independently extracted Microdata items distinct', async () => {
    const input =
      '<div itemscope itemtype="urn:test:Person"><span itemprop="name">Alice</span></div>'
    const first = await collect(microdata(input)), second = await collect(microdata(input))
    expect(first[0]?.subject.equals(second[0]!.subject)).toBe(false)
    expect(dataset([...first, ...second]).size).toBe(first.length + second.length)
  })
})
