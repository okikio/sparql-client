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
