import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '../mod.ts'
import { parse } from './mod.ts'

async function all(source: string, options = {}) {
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
})
