/** Runs pinned implementation corpora without invoking upstream setup or test frameworks. @module */

import { after, describe, it } from 'node:test'
import { expect } from '@std/expect'
import { toFileUrl } from '@std/path'
import { blankNode, literal, namedNode, quad } from '@okikio/rdf'
import { parseCase, readCase, readCorpus, rejectionType, sameTerms } from './upstream.ts'

const corpus = await readCorpus()
// A fixture changed between acquisition and parsing must invalidate the run,
// including negative cases that could otherwise reject different input.
after(async () => {
  expect(await readCorpus()).toEqual(corpus)
})
for (const source of corpus.sources) {
  describe(`upstream ${source.id} at ${source.revision}`, () => {
    for (const entry of corpus.cases.filter((entry) => entry.source === source.id)) {
      it(`${entry.id}: ${entry.name}`, { timeout: 15_000 }, async () => {
        // Fixture/expected-file acquisition must fail outside the negative syntax catch.
        const { input, expected } = await readCase(entry)
        const failure = entry.kind === 'negative' ? rejectionType(entry, input) : undefined
        for (const split of [false, true]) {
          if (entry.kind === 'negative') {
            await expect(parseCase(entry, input, split)).rejects.toBeInstanceOf(failure!)
          } else {
            const actual = await parseCase(entry, input, split)
            if (entry.kind === 'eval') expect(sameTerms(actual, expected!)).toBe(true)
          }
        }
      })
    }
  })
}

describe('upstream term oracle', () => {
  it('accepts reordered statements and rejects different duplicate multiplicities or term fields', () => {
    const s = namedNode('urn:s'), p = namedNode('urn:p')
    const a = quad(s, p, literal('a'))
    const b = quad(s, p, literal('b'))
    expect(sameTerms([a, a, b], [b, a, a])).toBe(true)
    expect(sameTerms([a, a, b], [a, b, b])).toBe(false)
    expect(sameTerms([a, b], [a])).toBe(false)
    const left = blankNode('left'), right = blankNode('right')
    expect(sameTerms([quad(left, p, left)], [quad(right, p, right)])).toBe(true)
    expect(sameTerms([quad(left, p, left)], [quad(right, p, blankNode('other'))])).toBe(false)
    expect(sameTerms([a], [quad(s, namedNode('urn:wrong'), literal('a'))])).toBe(false)
    expect(sameTerms([a], [quad(s, p, literal('a'), namedNode('urn:g'))])).toBe(false)
    expect(sameTerms([a], [quad(s, p, literal('a', 'en'))])).toBe(false)
    expect(sameTerms([a], [quad(s, p, literal('a', namedNode('urn:datatype')))])).toBe(false)
    expect(sameTerms([quad(s, p, literal('a', { language: 'en', direction: 'rtl' }))], [
      quad(s, p, literal('a', { language: 'en', direction: 'ltr' })),
    ])).toBe(false)
  })
})

describe('upstream fixture acquisition authority', () => {
  it('rejects absent or changed negative input before parser rejection can count as success', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'upstream-fixture-' })
    try {
      const root = new URL('./', toFileUrl(`${directory}/corpus.json`))
      const input = new TextEncoder().encode('<urn:s> <urn:p> <urn:o>.')
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', input)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('')
      const manifest = {
        schema: 1,
        sources: [{
          id: 'control',
          repository: 'https://example.invalid/',
          revision: '0'.repeat(40),
          license: 'control',
        }],
        files: [{ path: 'input.nt', source: 'original.nt', bytes: input.length, sha256: hash }],
        cases: [{
          source: 'control',
          id: 'negative',
          origin: 'manifest',
          name: 'negative',
          format: 'ntriples',
          kind: 'negative',
          error: 'syntax',
          base: 'urn:base:',
          input: 'input.nt',
        }],
        excluded: [],
      }
      await Deno.writeTextFile(`${directory}/corpus.json`, JSON.stringify(manifest))
      await expect(readCorpus(root)).rejects.toBeInstanceOf(Deno.errors.NotFound)
      await Deno.writeFile(`${directory}/input.nt`, input)
      expect((await readCorpus(root)).cases.length).toBe(1)
      await Deno.writeTextFile(
        `${directory}/corpus.json`,
        JSON.stringify({ ...manifest, cases: [{ ...manifest.cases[0], kind: 'unknown' }] }),
      )
      await expect(readCorpus(root)).rejects.toBeInstanceOf(TypeError)
      for (
        const entry of [
          { ...manifest.cases[0], error: undefined },
          { ...manifest.cases[0], error: 'unknown' },
          { ...manifest.cases[0], kind: 'positive' },
        ]
      ) {
        await Deno.writeTextFile(
          `${directory}/corpus.json`,
          JSON.stringify({ ...manifest, cases: [entry] }),
        )
        await expect(readCorpus(root)).rejects.toBeInstanceOf(TypeError)
      }
      await Deno.writeTextFile(`${directory}/corpus.json`, JSON.stringify(manifest))
      await Deno.writeTextFile(`${directory}/input.nt`, '<urn:wrong> <urn:p> <urn:o>.')
      await expect(readCorpus(root)).rejects.toBeInstanceOf(Error)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})

describe('upstream negative error domains', () => {
  it('rejects misclassified encoding bytes and keeps internal errors outside syntax success', () => {
    const syntax = corpus.cases.find((entry) => entry.error === 'syntax')!
    const encoding = corpus.cases.find((entry) => entry.error === 'utf8')!
    const valid = new TextEncoder().encode('<urn:s> <urn:p>')
    const invalid = new Uint8Array([0xef, 0xbb])
    const syntaxError = rejectionType(syntax, valid)
    expect(new SyntaxError() instanceof syntaxError).toBe(true)
    expect(new Error('internal failure') instanceof syntaxError).toBe(false)
    expect(new TypeError('internal failure') instanceof syntaxError).toBe(false)
    expect(rejectionType(encoding, invalid)).toBe(TypeError)
    expect(() => rejectionType(encoding, valid)).toThrow(TypeError)
    expect(() => rejectionType(syntax, invalid)).toThrow(TypeError)
  })
})
