import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namespace } from './namespace.ts'

describe('@okikio/rdf namespaces', () => {
  it('keeps the base IRI inspectable while expanding local names to named nodes', () => {
    const schema = namespace('https://schema.org/')
    expect(schema.iri).toBe('https://schema.org/')
    expect(schema('Product').value).toBe('https://schema.org/Product')
    expect(Object.keys(schema)).toEqual(['iri'])
  })
})
