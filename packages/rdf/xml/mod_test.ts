import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '../mod.ts'
import { parse } from './mod.ts'

async function all(source: string) {
  const values = []
  for await (const value of parse(source)) values.push(value)
  return values
}

const head =
  `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/" xml:base="http://example.test/" rdf:version="1.2">`

describe('@okikio/rdf/xml', () => {
  it('parses typed nodes, language literals, and resource properties natively', async () => {
    const values = await all(
      `${head}<ex:Thing rdf:about="item" xml:lang="en"><ex:name>Widget</ex:name><ex:link rdf:resource="other"/></ex:Thing></rdf:RDF>`,
    )
    expect(
      values.some((value) =>
        value.predicate.value === RDF.type && value.object.value === 'http://example.org/Thing'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'http://example.org/name' &&
        value.object.termType === 'Literal' && value.object.language === 'en'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'http://example.org/link' &&
        value.object.value === 'http://example.test/other'
      ),
    ).toBe(true)
  })

  it('parses resource and collection parse types', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about="s"><ex:meta rdf:parseType="Resource"><ex:name>x</ex:name></ex:meta><ex:items rdf:parseType="Collection"><rdf:Description rdf:about="a"/><rdf:Description rdf:about="b"/></ex:items></rdf:Description></rdf:RDF>`,
    )
    expect(values.some((value) => value.predicate.value === RDF.first)).toBe(true)
    expect(values.some((value) => value.predicate.value === RDF.rest)).toBe(true)
    expect(values.some((value) => value.predicate.value === 'http://example.org/name')).toBe(true)
  })

  it('creates an RDF 1.2 triple term without asserting the quoted triple', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about=""><ex:quote rdf:parseType="Triple"><rdf:Description rdf:about="http://example.org/s"><ex:p rdf:resource="http://example.org/o"/></rdf:Description></ex:quote></rdf:Description></rdf:RDF>`,
    )
    expect(values).toHaveLength(1)
    expect(values[0]?.object.termType).toBe('Quad')
    if (values[0]?.object.termType === 'Quad') {
      expect(values[0].object.predicate.value).toBe('http://example.org/p')
    }
  })

  it('emits classic rdf:ID reification and RDF 1.2 annotation reifiers', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about="http://example.org/s"><ex:p rdf:ID="classic" rdf:annotation="annotation">value</ex:p></rdf:Description></rdf:RDF>`,
    )
    expect(values.some((value) => value.predicate.value === RDF.subject)).toBe(true)
    const annotation = values.find((value) => value.predicate.value === RDF.reifies)
    expect(annotation?.object.termType).toBe('Quad')
  })
})
