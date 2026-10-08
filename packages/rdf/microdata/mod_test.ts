import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { RDF } from '../mod.ts'
import { parse } from './mod.ts'

async function all(source: string, options = {}) {
  const values = []
  for await (const value of parse(source, options)) values.push(value)
  return values
}

describe('@okikio/rdf/microdata', () => {
  it('bounds buffered semantic fan-out, including caller vocabulary aliases', async () => {
    const html = '<div itemscope itemtype="urn:v:Item"><span itemprop="name">value</span></div>'
    const vocabularies = {
      'urn:v:': { properties: { name: { equivalentProperty: ['urn:alias:a', 'urn:alias:b'] } } },
    }
    expect(await all(html, { vocabularies, maxQuads: 4 })).toHaveLength(4)
    const iterator = parse(html, { vocabularies, maxQuads: 3 })
    await expect(iterator.next()).rejects.toThrow(RangeError)
  })

  it('rejects invalid semantic limits before acquiring markup input', async () => {
    let acquired = 0
    const source = {
      *[Symbol.iterator]() {
        acquired++
        yield '<div itemscope></div>'
      },
    }
    for (const option of ['maxQuads', 'maxItemDepth']) {
      for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(parse(source, { [option]: limit }).next()).rejects.toThrow(RangeError)
      }
    }
    expect(acquired).toBe(0)
  })
  it('bounds itemref expansion independently of shallow markup depth', async () => {
    const html = '<div itemscope itemref="a"></div>' +
      '<div id="a" itemprop="child" itemscope itemref="b"></div>' +
      '<div id="b" itemprop="child" itemscope><span itemprop="name">value</span></div>'
    expect(await all(html, { base: 'urn:base', maxItemDepth: 3 })).toHaveLength(3)
    await expect(all(html, { base: 'urn:base', maxItemDepth: 2 })).rejects.toThrow(RangeError)
  })
  it('ignores relative item types and preserves absolute RDF IRI spelling', async () => {
    const values = await all(
      '<div itemscope itemtype="Person"><a itemprop="url" href="http://Example.test">x</a></div>',
      { base: 'http://example.test/item' },
    )
    expect(values).toHaveLength(1)
    expect(values[0]?.predicate.value).toBe('http://example.test/item#url')
    expect(values[0]?.object.value).toBe('http://Example.test')
  })

  it('rejects recursive itemref while reusing completed shared item subjects', async () => {
    await expect(
      all(
        '<div itemscope itemref="a"><div id="a" itemprop="friend" itemscope itemref="a"></div></div>',
      ),
    ).rejects.toThrow(TypeError)
    const values = await all(
      '<div itemscope itemtype="http://example.test/Person" itemref="shared"></div><div itemscope itemtype="http://example.test/Person" itemref="shared"></div><div id="shared" itemscope itemprop="friend"><span itemprop="name">Alice</span></div>',
    )
    const links = values.filter((value) => value.predicate.value === 'http://example.test/friend')
    expect(links).toHaveLength(2)
    expect(links[0]?.object.equals(links[1]!.object)).toBe(true)
    expect(values.filter((value) => value.predicate.value === 'http://example.test/name'))
      .toHaveLength(1)
  })

  it('extracts schema vocabulary types, properties, URLs, and language natively', async () => {
    const html =
      `<div itemscope itemtype="https://schema.org/Person" itemid="https://example.test/alice" lang="en"><span itemprop="name">Alice</span><a itemprop="url" href="/alice">Profile</a></div>`
    const values = await all(html, { base: 'https://example.test/' })
    expect(
      values.some((value) =>
        value.predicate.value === RDF.type && value.object.value === 'https://schema.org/Person'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'https://schema.org/name' &&
        value.object.termType === 'Literal' && value.object.language === 'en'
      ),
    ).toBe(true)
    expect(
      values.some((value) =>
        value.predicate.value === 'https://schema.org/url' &&
        value.object.value === 'https://example.test/alice'
      ),
    ).toBe(true)
  })

  it('resolves itemref properties outside the item subtree', async () => {
    const html =
      `<div itemscope itemtype="https://schema.org/Person" itemref="extra"><span itemprop="name">Alice</span></div><div id="extra"><meta itemprop="jobTitle" content="Engineer"></div>`
    const values = await all(html)
    expect(
      values.some((value) =>
        value.predicate.value === 'https://schema.org/jobTitle' && value.object.value === 'Engineer'
      ),
    ).toBe(true)
  })

  it('supports reverse properties without producing reverse literal subjects', async () => {
    const html =
      `<div itemscope itemtype="https://schema.org/Person" itemid="https://example.test/a"><div itemscope itemid="https://example.test/b" itemprop-reverse="knows"></div></div>`
    const values = await all(html)
    expect(
      values.some((value) =>
        value.subject.value === 'https://example.test/b' &&
        value.object.value === 'https://example.test/a'
      ),
    ).toBe(true)
  })
})
