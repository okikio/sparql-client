import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { resolve } from './iri.ts'

describe('RDF IRI resolution', () => {
  it('matches the normal and abnormal RFC 3986 section 5.4 examples', () => {
    const base = 'http://a/b/c/d;p?q'
    const vectors = {
      'g:h': 'g:h',
      g: 'http://a/b/c/g',
      './g': 'http://a/b/c/g',
      'g/': 'http://a/b/c/g/',
      '/g': 'http://a/g',
      '//g': 'http://g',
      '?y': 'http://a/b/c/d;p?y',
      'g?y': 'http://a/b/c/g?y',
      '#s': 'http://a/b/c/d;p?q#s',
      'g#s': 'http://a/b/c/g#s',
      'g?y#s': 'http://a/b/c/g?y#s',
      ';x': 'http://a/b/c/;x',
      'g;x': 'http://a/b/c/g;x',
      'g;x?y#s': 'http://a/b/c/g;x?y#s',
      '': base,
      '.': 'http://a/b/c/',
      './': 'http://a/b/c/',
      '..': 'http://a/b/',
      '../': 'http://a/b/',
      '../g': 'http://a/b/g',
      '../..': 'http://a/',
      '../../': 'http://a/',
      '../../g': 'http://a/g',
      '../../../g': 'http://a/g',
      '../../../../g': 'http://a/g',
      '/./g': 'http://a/g',
      '/../g': 'http://a/g',
      'g.': 'http://a/b/c/g.',
      '.g': 'http://a/b/c/.g',
      'g..': 'http://a/b/c/g..',
      '..g': 'http://a/b/c/..g',
      './../g': 'http://a/b/g',
      './g/.': 'http://a/b/c/g/',
      'g/./h': 'http://a/b/c/g/h',
      'g/../h': 'http://a/b/c/h',
      'g;x=1/./y': 'http://a/b/c/g;x=1/y',
      'g;x=1/../y': 'http://a/b/c/y',
      'g?y/./x': 'http://a/b/c/g?y/./x',
      'g?y/../x': 'http://a/b/c/g?y/../x',
      'g#s/./x': 'http://a/b/c/g#s/./x',
      'g#s/../x': 'http://a/b/c/g#s/../x',
      'http:g': 'http:g',
    }
    for (const [reference, expected] of Object.entries(vectors)) {
      expect(resolve(reference, base)).toBe(expected)
    }
  })

  it('preserves Unicode, host spelling, encoded dots, and empty components', () => {
    expect(resolve('http://ExAmple.test')).toBe('http://ExAmple.test')
    expect(resolve('http://例え.test/é')).toBe('http://例え.test/é')
    expect(resolve('#Dürst', 'http://example.test/')).toBe('http://example.test/#Dürst')
    expect(resolve('%2e/%2E%2E/x', 'http://a/b/')).toBe('http://a/b/%2e/%2E%2E/x')
    expect(resolve('?', 'http://a/?q#f')).toBe('http://a/?')
    expect(resolve('#', 'http://a/?q#f')).toBe('http://a/?q#')
    expect(() => resolve('relative')).toThrow(TypeError)
    expect(() => resolve('relative', '/relative')).toThrow(TypeError)
  })
})
