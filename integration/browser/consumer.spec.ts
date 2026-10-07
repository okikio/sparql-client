import { expect, test } from '@playwright/test'
import type { browserTest } from './window.ts'

/** Each evaluation opts into the fixture global without polluting production declarations. */
type FixtureType = typeof globalThis & { browserTest: typeof browserTest }

test.beforeEach(async ({ page }) => {
  await page.goto('/integration/browser/index.html')
  await page.waitForFunction(() => Boolean((globalThis as Partial<FixtureType>).browserTest))
})

for (const realm of ['run', 'worker'] as const) {
  test(`${realm}: RDF chunks, terms, dataset indexes and SPARQL builder preserve semantics`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('semantics'),
      { realm },
    )
    expect(value).toEqual({
      size: 2,
      invariant: true,
      roundTrip: true,
      object: '零 café 😀',
      language: 'fr',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
      graph: 'urn:g',
      base: 'SELECT ?o',
      query: 'SELECT ?o WHERE { <urn:s> <urn:p> ?o . }',
    })
  })

  test(`${realm}: abort settles a pending parser read and releases its source`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('cancel'),
      { realm },
    )
    expect(value).toEqual({ name: 'AbortError', cancelled: 1, locked: false })
  })

  test(`${realm}: early return cancels upstream and releases the reader`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('early'),
      { realm },
    )
    expect(value).toEqual({ values: ['first'], cancelled: 1, locked: false })
  })

  test(`${realm}: exact parser limit and malformed-statement recovery are explicit`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('limits'),
      { realm },
    )
    expect(value).toMatchObject({ at: 1, events: ['quad', 'diagnostic', 'quad'] })
    expect(value).toHaveProperty('failure', expect.stringContaining('maxLineLength'))
  })

  test(`${realm}: canonical bytes and digest survive blank-node relabeling`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('canon'),
      { realm },
    )
    expect(value).toMatchObject({ text: '_:c14n0 <urn:p> "value" .\n', invariant: true })
    expect(value).toHaveProperty('hash', expect.stringMatching(/^[0-9a-f]{64}$/u))
  })

  test(`${realm}: native fetch encodings, RDF terms and stalled-body cancellation`, async ({ page }) => {
    const value = await page.evaluate(
      ({ realm }) => (globalThis as FixtureType).browserTest[realm]('http'),
      { realm },
    )
    expect(value).toMatchObject({
      literal: { type: 'Literal', value: 'bonjour', language: 'fr' },
      graph: 'urn:g',
      object: 'bonjour',
      abortKind: 'abort',
      recovered: true,
      headers: [['authorization', 'Bearer browser-fixture']],
    })
    if (!('wire' in value)) throw new Error('HTTP scenario did not return wire evidence.')
    expect(value.wire.map((entry: { method: string }) => entry.method)).toEqual([
      'GET',
      'POST',
      'POST',
    ])
    expect(value.wire.map((entry: { contentType: string }) => entry.contentType)).toEqual([
      '',
      'application/x-www-form-urlencoded; charset=utf-8',
      'application/sparql-query; charset=utf-8',
    ])
    expect(
      value.wire.every((entry: { query: string; authorization: string }) =>
        entry.query.replace(/\s+/gu, ' ').trim() === 'SELECT ?o WHERE { <urn:s> <urn:p> ?o . }' &&
        entry.authorization === 'Bearer browser-fixture'
      ),
    ).toBe(true)
  })
}
