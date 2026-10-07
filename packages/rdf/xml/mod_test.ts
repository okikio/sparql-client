import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad, RDF } from '../mod.ts'
import { parse } from './mod.ts'
import { isomorphic } from '../../../conformance/equal.ts'

async function all(source: string) {
  const values = []
  for await (const value of parse(source)) values.push(value)
  return values
}

const head =
  `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/" xml:base="http://example.test/" rdf:version="1.2">`

describe('@okikio/rdf/xml', () => {
  it('rejects undeclared prefixes and reserved namespace rebinding', async () => {
    for (
      const source of [
        '<rdf:RDF/>',
        `${head}<rdf:Description missing:property="value"/></rdf:RDF>`,
        `${head.replace('xmlns:rdf=', 'xmlns:xml=')}</rdf:RDF>`,
        `${
          head.replace(
            'xmlns:ex="http://example.org/"',
            'xmlns:ex="http://www.w3.org/XML/1998/namespace"',
          )
        }</rdf:RDF>`,
      ]
    ) await expect(all(source)).rejects.toThrow(SyntaxError)
  })

  it('applies a relative base once when the document root is a typed node', async () => {
    const values = []
    for await (
      const value of parse(
        `<ex:Thing xmlns:ex="http://example.org/" xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xml:base="child/" r:about="item"><ex:name>Name</ex:name></ex:Thing>`,
        { base: 'http://example.org/root/' },
      )
    ) values.push(value)
    expect(values).toHaveLength(2)
    expect(values.every((value) => value.subject.value === 'http://example.org/root/child/item'))
      .toBe(true)
    expect(values.map((value) => [value.predicate.value, value.object.value]).sort()).toEqual([
      ['http://example.org/name', 'Name'],
      [RDF.type, 'http://example.org/Thing'],
    ].sort())
  })

  it('reads syntax attributes by their namespace instead of their prefix spelling', async () => {
    const values = await all(
      `<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/" xmlns:d="http://www.w3.org/2005/11/its" xml:base="http://example.org/root/child/" r:version="1.2"><r:Description r:about="item"><ex:link r:resource="other"/><ex:count r:datatype="http://www.w3.org/2001/XMLSchema#integer">3</ex:count><ex:name xml:lang="en" d:dir="rtl">Name</ex:name><ex:meta r:parseType="Resource"><ex:title>Title</ex:title></ex:meta></r:Description></r:RDF>`,
    )
    const link = values.find((value) => value.predicate.value === 'http://example.org/link')
    expect(link?.subject.value).toBe('http://example.org/root/child/item')
    expect(link?.object.value).toBe('http://example.org/root/child/other')
    const count = values.find((value) => value.predicate.value === 'http://example.org/count')
      ?.object
    expect(count?.termType).toBe('Literal')
    if (count?.termType === 'Literal') {
      expect(count.datatype.value).toBe('http://www.w3.org/2001/XMLSchema#integer')
    }
    const name = values.find((value) => value.predicate.value === 'http://example.org/name')?.object
    expect(name?.termType).toBe('Literal')
    if (name?.termType === 'Literal') expect(name.direction).toBe('rtl')
    const meta = values.find((value) => value.predicate.value === 'http://example.org/meta')?.object
    expect(meta?.termType).toBe('BlankNode')
    expect(
      values.find((value) => value.predicate.value === 'http://example.org/title')?.subject.equals(
        meta!,
      ),
    ).toBe(true)
  })

  it('does not interpret a rebound rdf prefix as RDF syntax', async () => {
    const values = await all(
      `<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdf="http://example.org/" xmlns:ex="http://example.org/"><r:Description r:about="http://example.org/item" rdf:about="property"><ex:name>Name</ex:name></r:Description></r:RDF>`,
    )
    expect(values.every((value) => value.subject.value === 'http://example.org/item')).toBe(true)
    expect(
      values.find((value) => value.predicate.value === 'http://example.org/about')?.object.value,
    ).toBe('property')
  })

  it('rejects syntax attributes duplicated through different aliases', async () => {
    await expect(all(
      `<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:a="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><r:Description r:about="urn:test:a" a:about="urn:test:b"/></r:RDF>`,
    )).rejects.toThrow(SyntaxError)
  })

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
    const meta = blankNode('meta'), list = blankNode('head'), tail = blankNode('tail')
    const subject = namedNode('http://example.test/s')
    expect(isomorphic(values, [
      quad(subject, namedNode('http://example.org/meta'), meta),
      quad(meta, namedNode('http://example.org/name'), literal('x')),
      quad(subject, namedNode('http://example.org/items'), list),
      quad(list, namedNode(RDF.first), namedNode('http://example.test/a')),
      quad(list, namedNode(RDF.rest), tail),
      quad(tail, namedNode(RDF.first), namedNode('http://example.test/b')),
      quad(tail, namedNode(RDF.rest), namedNode(RDF.nil)),
    ])).toBe(true)
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

  it('accepts Unicode XML NCNames for rdf:ID and rdf:nodeID', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:ID="Dürst"><ex:p rdf:nodeID="nœud"/></rdf:Description></rdf:RDF>`,
    )
    expect(values.some((value) => value.subject.value === 'http://example.test/#Dürst')).toBe(
      true,
    )
    expect(
      values.some((value) =>
        value.object.termType === 'BlankNode' && value.object.value.length > 0
      ),
    ).toBe(true)
  })

  it('rejects reserved RDF names in node, property, and property-attribute positions', async () => {
    await expect(all(`${head}<rdf:li rdf:about="s"/></rdf:RDF>`)).rejects.toThrow(SyntaxError)
    await expect(
      all(
        `${head}<rdf:Description rdf:about="s"><rdf:Description>bad</rdf:Description></rdf:Description></rdf:RDF>`,
      ),
    ).rejects.toThrow(SyntaxError)
    await expect(
      all(`${head}<rdf:Description rdf:about="s" rdf:li="bad"/></rdf:RDF>`),
    ).rejects.toThrow(SyntaxError)
    await expect(all(`${head}<rdf:aboutEach rdf:about="s"/></rdf:RDF>`)).rejects.toThrow(
      SyntaxError,
    )
  })

  it('treats rdf:type property attributes as IRIs', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about="s" rdf:type="kind"><ex:p rdf:resource="o" rdf:type="other" ex:name="Object"/></rdf:Description></rdf:RDF>`,
    )
    const nodeType = values.find((value) =>
      value.subject.value === 'http://example.test/s' && value.predicate.value === RDF.type
    )
    expect(nodeType?.object.value).toBe('http://example.test/kind')
    const objectType = values.find((value) =>
      value.subject.value === 'http://example.test/o' && value.predicate.value === RDF.type
    )
    expect(objectType?.object.value).toBe('http://example.test/other')
    expect(
      values.some((value) =>
        value.subject.value === 'http://example.test/o' &&
        value.predicate.value === 'http://example.org/name' && value.object.value === 'Object'
      ),
    ).toBe(true)
  })

  it('uses one blank node for all property attributes on an empty property element', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about="s"><ex:p ex:a="one" ex:b="two"/></rdf:Description></rdf:RDF>`,
    )
    const statement = values.find((value) => value.predicate.value === 'http://example.org/p')
    expect(statement?.object.termType).toBe('BlankNode')
    const id = statement?.object.value
    expect(
      values.some((value) =>
        value.subject.value === id && value.predicate.value === 'http://example.org/a'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.subject.value === id && value.predicate.value === 'http://example.org/b'
      ),
    ).toBe(true)
  })

  it('rejects property attribute/content combinations that match no RDF/XML production', async () => {
    await expect(
      all(
        `${head}<rdf:Description rdf:about="s"><ex:p rdf:parseType="Resource" rdf:resource="o"/></rdf:Description></rdf:RDF>`,
      ),
    ).rejects.toThrow(SyntaxError)
    await expect(
      all(
        `${head}<rdf:Description rdf:about="s"><ex:p rdf:resource="o"><rdf:Description rdf:about="x"/></ex:p></rdf:Description></rdf:RDF>`,
      ),
    ).rejects.toThrow(SyntaxError)
    await expect(
      all(
        `${head}<rdf:Description rdf:about="s"><ex:p ex:name="bad">text</ex:p></rdf:Description></rdf:RDF>`,
      ),
    ).rejects.toThrow(SyntaxError)
  })

  it('treats unknown rdf:parseType values as XML literals', async () => {
    const values = await all(
      `${head}<rdf:Description rdf:about="s"><ex:p rdf:parseType="Vendor"><ex:inner>text</ex:inner></ex:p></rdf:Description></rdf:RDF>`,
    )
    expect(values).toHaveLength(1)
    expect(values[0]?.object.termType).toBe('Literal')
    if (values[0]?.object.termType === 'Literal') {
      expect(values[0].object.datatype.value).toBe(
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
      )
    }
  })

  it('rejects invalid XML NCNames used by rdf:ID and rdf:nodeID', async () => {
    await expect(all(`${head}<rdf:Description rdf:ID="9bad"/></rdf:RDF>`)).rejects.toThrow(
      SyntaxError,
    )
    await expect(
      all(`${head}<rdf:Description rdf:nodeID="bad:name"/></rdf:RDF>`),
    ).rejects.toThrow(SyntaxError)
  })
})
