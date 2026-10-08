import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '@okikio/rdf'
import type { NamedNode } from '@okikio/rdf'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import { toFileUrl } from '@std/path'
import { compile } from './compile.ts'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class')

describe('@okikio/vocab compile', () => {
  it('replaces format-specific ttl-to-ts generation with a quad-source compiler', async () => {
    const product = namedNode('https://example.test/Product')
    const direct = { id: 'direct', quads: [quad(product, RDF_TYPE, RDFS_CLASS)] }
    const turtle = {
      id: 'turtle',
      quads: parseTurtle(
        '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n<https://example.test/Offer> a rdfs:Class .',
      ),
    }
    const result = await compile([direct, turtle], {
      vocabulary: 'Example',
      namespace: 'https://example.test/',
      prefix: 'example',
    })
    expect(result.manifest.symbols).toEqual([
      {
        iri: 'https://example.test/Offer',
        kind: 'class',
        name: 'Offer',
        exports: {
          term: 'Offer',
          type: 'OfferType',
          schema: 'OfferSchema',
          properties: 'OfferPropertiesType',
        },
      },
      {
        iri: 'https://example.test/Product',
        kind: 'class',
        name: 'Product',
        exports: {
          term: 'Product',
          type: 'ProductType',
          schema: 'ProductSchema',
          properties: 'ProductPropertiesType',
        },
      },
    ])
    const directory = await Deno.makeTempDir({ prefix: 'vocabulary-consumer-' })
    try {
      const file = `${directory}/vocabulary.ts`
      // Import the generated public module, so wrong exports or term IRIs fail
      // independently of whitespace and emitter annotation choices.
      await Deno.writeTextFile(file, result.source)
      const generated: { Product: NamedNode; Offer: NamedNode } = await import(
        toFileUrl(file).href
      )
      expect(generated.Product.equals(product)).toBe(true)
      expect(generated.Offer.equals(namedNode('https://example.test/Offer'))).toBe(true)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
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

  it('emits separate usable bindings when one resource is a class and a property', async () => {
    const shared = namedNode('https://example.test/Shared')
    const assertions = [
      quad(shared, RDF_TYPE, RDFS_CLASS),
      quad(shared, RDF_TYPE, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')),
    ]
    const options = { vocabulary: 'Example', namespace: 'https://example.test/', prefix: 'example' }
    const forward = await compile([{ id: 'source', quads: assertions }], options)
    const reverse = await compile([{ id: 'source', quads: [...assertions].reverse() }], options)
    expect(forward.manifest.symbols).toEqual([
      {
        iri: shared.value,
        kind: 'class',
        name: 'Shared',
        exports: {
          term: 'Shared',
          type: 'SharedType',
          schema: 'SharedSchema',
          properties: 'SharedPropertiesType',
        },
      },
      {
        iri: shared.value,
        kind: 'property',
        name: 'ExampleSharedProperty',
        exports: { term: 'ExampleSharedProperty' },
      },
    ])
    expect(reverse.manifest.symbols).toEqual(forward.manifest.symbols)
    const directory = await Deno.makeTempDir({ prefix: 'vocabulary-roles-' })
    try {
      const file = `${directory}/vocabulary.ts`
      await Deno.writeTextFile(file, forward.source)
      const generated: { Shared: NamedNode; ExampleSharedProperty: NamedNode } = await import(
        toFileUrl(file).href
      )
      expect(generated.Shared.equals(shared)).toBe(true)
      expect(generated.ExampleSharedProperty.equals(shared)).toBe(true)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
