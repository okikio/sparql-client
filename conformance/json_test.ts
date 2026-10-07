import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { matchJson } from './json.ts'

describe('JSON-LD conformance oracle', () => {
  it('relabels node references consistently without relabeling literal strings', () => {
    expect(
      matchJson([{ '@id': '_:a', 'urn:p': [{ '@id': '_:b' }] }, { '@id': '_:b' }], [{
        '@id': '_:x',
        'urn:p': [{ '@id': '_:y' }],
      }, { '@id': '_:y' }], false),
    ).toBe(true)
    expect(matchJson({ '@value': '_:a' }, { '@value': '_:b' }, false)).toBe(false)
    expect(
      matchJson({ '@id': '_:a', 'urn:p': [{ '@id': '_:a' }] }, {
        '@id': '_:x',
        'urn:p': [{ '@id': '_:y' }],
      }, false),
    ).toBe(false)
  })

  it('retains list, JSON literal, and context order while matching node sets', () => {
    expect(
      matchJson(
        [{ '@id': 'urn:a' }, { '@id': 'urn:b' }],
        [{ '@id': 'urn:b' }, { '@id': 'urn:a' }],
        false,
      ),
    ).toBe(true)
    expect(matchJson({ '@list': [1, 2] }, { '@list': [2, 1] }, false)).toBe(false)
    expect(
      matchJson(
        { '@type': '@json', '@value': [1, 2] },
        { '@type': '@json', '@value': [2, 1] },
        false,
      ),
    ).toBe(false)
    expect(
      matchJson({ '@type': '@json', '@value': { '@language': 'EN' } }, {
        '@type': '@json',
        '@value': { '@language': 'en' },
      }, false),
    ).toBe(false)
    expect(
      matchJson({ '@context': [{ p: 'urn:a' }, { p: 'urn:b' }] }, {
        '@context': [{ p: 'urn:b' }, { p: 'urn:a' }],
      }, false),
    ).toBe(false)
  })
})
