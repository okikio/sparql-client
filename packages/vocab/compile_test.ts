import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import { compile } from './compile.ts'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class')

describe('@okikio/vocab compile', () => {
  it('replaces format-specific ttl-to-ts generation with a quad-source compiler', async () => {
    const product = namedNode('https://example.test/Product')
    const direct = { id: 'direct', quads: [quad(product, RDF_TYPE, RDFS_CLASS)] }
    const turtle = {
      id: 'turtle',
      quads: parseTurtle('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n<https://example.test/Offer> a rdfs:Class .'),
    }
    const result = await compile([direct, turtle], {
      vocabulary: 'Example',
      namespace: 'https://example.test/',
      prefix: 'example',
    })
    expect(result.source.includes('export const Product =')).toBe(true)
    expect(result.source.includes('export const Offer =')).toBe(true)
  })

  it('is deterministic for repeated semantic inputs', async () => {
    const make = () => [{
      id: 'source',
      quads: [quad(namedNode('https://example.test/Product'), RDF_TYPE, RDFS_CLASS)],
    }]
    const options = { vocabulary: 'Example', namespace: 'https://example.test/', prefix: 'example' }
    const first = await compile(make(), options)
    const second = await compile(make(), options)
    expect(first.source).toBe(second.source)
    expect(first.manifest).toEqual(second.manifest)
  })
})
