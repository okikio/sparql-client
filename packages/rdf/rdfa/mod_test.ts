import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, RDF } from '../mod.ts'
import type { TextSourceType } from '../text.ts'
import { parse, type ParseOptionsType } from './mod.ts'

async function all(source: TextSourceType, options: ParseOptionsType = {}) {
  const values = []
  for await (const value of parse(source, options)) values.push(value)
  return values
}

describe('@okikio/rdf/rdfa', () => {
  it('extracts vocab properties, typeof, and resource relationships natively', async () => {
    const html =
      `<div vocab="https://schema.org/" about="https://example.test/a" typeof="Person"><span property="name">Alice</span><a rel="knows" href="https://example.test/b">B</a></div>`
    const values = await all(html, { contentType: 'text/html' })
    expect(
      values.some((value) =>
        value.predicate.value === RDF.type && value.object.value === 'https://schema.org/Person'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'https://schema.org/name' && value.object.value === 'Alice'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'https://schema.org/knows' &&
        value.object.value === 'https://example.test/b'
      ),
    ).toBe(true)
  })

  it('expands declared prefixes and reverse relations', async () => {
    const html =
      `<div prefix="foaf: http://xmlns.com/foaf/0.1/" about="https://example.test/a"><span property="foaf:name">Alice</span><a rev="foaf:knows" href="https://example.test/b">B</a></div>`
    const values = await all(html)
    expect(values.some((value) => value.predicate.value === 'http://xmlns.com/foaf/0.1/name')).toBe(
      true,
    )
    expect(
      values.some((value) =>
        value.subject.value === 'https://example.test/b' &&
        value.predicate.value === 'http://xmlns.com/foaf/0.1/knows' &&
        value.object.value === 'https://example.test/a'
      ),
    ).toBe(true)
  })

  it('emits @inlist relationships as RDF collections', async () => {
    const html =
      `<div vocab="https://schema.org/" about="https://example.test/a"><a rel="knows" inlist href="https://example.test/b"></a><a rel="knows" inlist href="https://example.test/c"></a></div>`
    const values = await all(html)
    expect(values.some((value) => value.predicate.value === RDF.first)).toBe(true)
    expect(values.some((value) => value.predicate.value === RDF.rest)).toBe(true)
  })

  it('keeps empty about distinct from absent about and preserves lexical IRIs', async () => {
    const values = await all(
      '<div about="http://example.org"><a href="other"><span about="" property="foaf:name">A</span></a></div>',
      { base: 'http://example.org/document' },
    )
    expect(values[0]?.subject.value).toBe('http://example.org/document')
    const lexical = await all(
      '<div about="http://example.org" property="foaf:homepage" resource="http://example.org/stéphane"></div>',
    )
    expect(lexical[0]?.subject.value).toBe('http://example.org')
    expect(lexical[0]?.object.value).toBe('http://example.org/stéphane')
  })

  it('clears inherited language and vocabulary through skipped wrappers', async () => {
    const values = await all(
      '<div about="urn:owner" vocab="urn:custom:" lang="en"><section vocab="" lang=""><span property="license">value</span></section></div>',
    )
    expect(values[0]?.predicate.value).toBe('http://www.w3.org/1999/xhtml/vocab#license')
    expect(values[0]?.object).toMatchObject({ termType: 'Literal', value: 'value', language: '' })
  })

  it('scopes labeled and empty-label blank nodes to one document', async () => {
    for (const label of ['same', '']) {
      const source =
        `<div about="[_:${label}]" property="foaf:name">A</div><div about="[_:${label}]" property="foaf:name">B</div>`
      const first = await all(source), second = await all(source)
      expect(first).toHaveLength(2)
      expect(first[0]?.subject.termType).toBe('BlankNode')
      expect(first[0]?.subject.equals(first[1]!.subject)).toBe(true)
      expect(first[0]?.subject.equals(second[0]!.subject)).toBe(false)
    }
  })

  it('expands the initial context and empty prefix across HTML, XHTML, XML and SVG', async () => {
    for (
      const contentType of [
        'text/html',
        'application/xhtml+xml',
        'application/xml',
        'image/svg+xml',
      ] as const
    ) {
      const values = await all(
        '<root about="urn:owner"><span property="csvw:">CSVW</span><span property="schema:name">Name</span><span property=":note">Note</span><span property="describedby">Description</span></root>',
        { contentType },
      )
      expect(values.map((value) => value.predicate.value)).toEqual([
        'http://www.w3.org/ns/csvw#',
        'http://schema.org/name',
        'http://www.w3.org/1999/xhtml/vocab#note',
        'http://www.w3.org/2007/05/powder-s#describedby',
      ])
    }
  })

  it('keeps incomplete relationships across empty relation attributes', async () => {
    const values = await all(
      '<div about="urn:owner" rel="foaf:knows"><a rel="" href="urn:ignored"><span property="foaf:name">A</span></a></div>',
    )
    expect(values.some((value) => value.object.value === 'urn:ignored')).toBe(false)
    const edge = values.find((value) => value.predicate.value === 'http://xmlns.com/foaf/0.1/knows')
    expect(edge?.object.termType).toBe('BlankNode')
  })

  it('creates property resources for an explicitly empty typeof', async () => {
    const values = await all(
      '<div about="urn:owner"><div property="schema:knows" typeof=""><span property="schema:name">A</span></div></div>',
    )
    const edge = values.find((value) => value.predicate.value === 'http://schema.org/knows')
    expect(edge?.object.termType).toBe('BlankNode')
    expect(values.find((value) => value.object.value === 'A')?.subject.equals(edge!.object)).toBe(
      true,
    )
  })

  it('builds both empty lists and ordered hanging relationship lists', async () => {
    const empty = await all('<div about="urn:owner" rel="rdf:value" inlist=""></div>')
    expect(empty).toHaveLength(1)
    expect(empty[0]?.object.value).toBe(RDF.nil)
    const values = await all(
      '<div about="urn:owner"><ol rel="rdf:value" inlist=""><li><a href="urn:first">A</a></li><li><a href="urn:second">B</a></li></ol></div>',
    )
    expect(
      values.filter((value) => value.predicate.value === RDF.first).map((value) =>
        value.object.value
      ),
    ).toEqual(['urn:first', 'urn:second'])
  })

  it('applies XHTML base and document subject rules and mutes plain rel beside property', async () => {
    for (const contentType of ['text/html', 'application/xhtml+xml'] as const) {
      const values = await all(
        '<html><head typeof="foaf:Document"><base href="http://example.org/document#fragment"/></head><body><a property="foaf:homepage" href="urn:home" rel="nofollow">Home</a></body></html>',
        { contentType, base: 'urn:supplied' },
      )
      expect(
        values.some((value) =>
          value.subject.value === 'http://example.org/document' &&
          value.predicate.value === RDF.type
        ),
      ).toBe(true)
      expect(values.some((value) => value.object.value === 'urn:home')).toBe(true)
    }
  })

  it('infers HTML time values while content and explicit datatype remain authoritative', async () => {
    for (const contentType of ['text/html', 'application/xhtml+xml'] as const) {
      for (
        const [value, kind] of [
          ['2014-03-27', 'date'],
          ['12:30:00', 'time'],
          ['2014-03-27T12:30:00Z', 'dateTime'],
          ['2014', 'gYear'],
          ['2014-03', 'gYearMonth'],
          ['P1Y2M', 'duration'],
        ] as const
      ) {
        const values = await all(
          `<div about="urn:owner"><time property="schema:startDate" datetime="${value}">Displayed</time></div>`,
          { contentType },
        )
        expect(values[0]?.object).toMatchObject({
          value,
          datatype: { value: `http://www.w3.org/2001/XMLSchema#${kind}` },
        })
      }
      const override = await all(
        '<div about="urn:owner"><time property="schema:startDate" datetime="2014" content="Value" datatype="">Displayed</time></div>',
        { contentType },
      )
      expect(override[0]?.object).toMatchObject({
        value: 'Value',
        datatype: { value: 'http://www.w3.org/2001/XMLSchema#string' },
      })
    }
  })

  it('terminates cyclic pattern copying, retains unused patterns and bounds expansion', async () => {
    const source =
      '<div about="urn:consumer"><link property="rdfa:copy" resource="_:a"/></div><div resource="_:a" typeof="rdfa:Pattern"><link property="rdfa:copy" resource="_:b"/><span property="schema:name">A</span></div><div resource="_:b" typeof="rdfa:Pattern"><link property="rdfa:copy" resource="_:a"/><span property="schema:name">B</span></div><div resource="urn:unused" typeof="rdfa:Pattern"><span property="schema:name">Unused</span></div>'
    const values = await all(source)
    expect(
      values.filter((value) =>
        value.subject.value === 'urn:consumer' && value.predicate.value === 'http://schema.org/name'
      ).map((value) => value.object.value).sort(),
    ).toEqual(['A', 'B'])
    expect(
      values.some((value) =>
        value.subject.value === 'urn:unused' && value.predicate.value === RDF.type
      ),
    ).toBe(true)
    await expect(all(source, { maxQuads: 10 })).rejects.toThrow(RangeError)
  })

  it('serializes inherited XMLLiteral namespaces and source comments with quoted delimiters', async () => {
    const values = await all(
      '<html xmlns="http://www.w3.org/1999/xhtml" prefix="foaf: http://xmlns.com/foaf/0.1/ rdf: http://www.w3.org/1999/02/22-rdf-syntax-ns#"><div about="urn:owner" property="foaf:name" datatype="rdf:XMLLiteral"><!--kept--><span title="a>b" property="foaf:firstName">A &amp; B</span></div></html>',
      { contentType: 'application/xhtml+xml' },
    )
    const value = values.find((quad) => quad.predicate.value === 'http://xmlns.com/foaf/0.1/name')
      ?.object
    expect(value?.value).toBe(
      '<!--kept--><span title="a&gt;b" property="foaf:firstName" xmlns="http://www.w3.org/1999/xhtml" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">A &amp; B</span>',
    )
  })

  it('imports native SVG RDF/XML with inherited base, namespaces, language and graph limits', async () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/terms/" xml:base="http://example.org/root/" xml:lang="en"><metadata><r:RDF xml:base="child/"><r:Description r:about="item"><dc:title>Title</dc:title></r:Description></r:RDF></metadata></svg>'
    const values = await all(source, {
      contentType: 'image/svg+xml',
      graph: namedNode('urn:graph'),
    })
    expect(values).toHaveLength(1)
    expect(values[0]).toMatchObject({
      subject: { value: 'http://example.org/root/child/item' },
      object: { value: 'Title', language: 'en' },
      graph: { value: 'urn:graph' },
    })
    await expect(
      all(source.replace('</r:Description>', '<dc:title>More</dc:title></r:Description>'), {
        contentType: 'image/svg+xml',
        maxQuads: 1,
      }),
    ).rejects.toThrow(RangeError)
    await expect(
      all(source.replace('r:about="item"', 'r:nodeID="invalid:label"'), {
        contentType: 'image/svg+xml',
      }),
    ).rejects.toThrow(SyntaxError)
  })

  it('keeps declared relative prefix expansions independent of the effective base', async () => {
    const values = await all(
      '<html><head><base href="http://changed.example/"/></head><body prefix="p: relative/"><span property="p:name">Value</span></body></html>',
      { base: 'http://retrieved.example/document' },
    )
    expect(values[0]?.subject.value).toBe('http://changed.example/')
    expect(values[0]?.predicate.value).toBe('relative/name')
  })

  it('rejects invalid limits and honors cancellation during stalled input and output', async () => {
    for (const maxQuads of [0, -1, NaN, Infinity, 1.5]) {
      await expect(all('<p/>', { maxQuads })).rejects.toThrow(RangeError)
    }
    const controller = new AbortController()
    let canceled = 0
    let entered!: () => void
    const reading = new Promise<void>((resolve) => entered = resolve)
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        entered()
        return new Promise(() => {})
      },
      cancel() {
        canceled++
      },
    }, { highWaterMark: 0 })
    const waiting = all(stream, { signal: controller.signal })
    await reading
    controller.abort(new Error('Caller canceled'))
    await expect(waiting).rejects.toThrow('Caller canceled')
    expect(canceled).toBe(1)
    expect(stream.locked).toBe(false)
    const output = new AbortController(),
      iterator = parse(
        '<div about="urn:owner"><p property="schema:name">A</p><p property="schema:name">B</p></div>',
        { signal: output.signal },
      )
    expect((await iterator.next()).done).toBe(false)
    output.abort(new Error('Stop output'))
    await expect(iterator.next()).rejects.toThrow('Stop output')
  })

  it('forwards a raised source byte cap to embedded SVG RDF/XML', async () => {
    // Exceed the native XML processor's independent default without many nodes
    // or graph statements. The public RDFa source cap should govern both passes.
    const text = 'A'.repeat(16 * 1024 * 1024 + 64)
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/terms/" xml:base="urn:document"><metadata><rdf:RDF><rdf:Description rdf:about="urn:subject"><dc:title>${text}</dc:title></rdf:Description></rdf:RDF></metadata></svg>`
    const maxBytes = new TextEncoder().encode(source).byteLength
    await expect(all(source, { contentType: 'image/svg+xml' })).rejects.toThrow(RangeError)
    const values = await all(source, { contentType: 'image/svg+xml', maxBytes })
    expect(values).toHaveLength(1)
    expect(values[0]?.subject.value).toBe('urn:subject')
    expect(values[0]?.predicate.value).toBe('http://purl.org/dc/terms/title')
    expect(values[0]?.object.value).toBe(text)
  })
})
