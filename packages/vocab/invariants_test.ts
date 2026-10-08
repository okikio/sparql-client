import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from '@okikio/rdf/turtle'
import { compile } from './compile.ts'
import type { VocabularySchema } from './runtime.ts'
import { createSchema } from './runtime.ts'
import { toFileUrl } from '@std/path'

const source = `
@prefix ex: <urn:> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:Product a rdfs:Class; rdfs:subClassOf ex:Other .
ex:Other a rdfs:Class; rdfs:subClassOf ex:Product .
ex:ProductSchema a rdf:Property; rdfs:domain ex:Product; rdfs:range xsd:string .
ex:price a rdf:Property; rdfs:domain ex:Other; rdfs:range xsd:decimal .
ex:namespace a rdf:Property .
ex:NodeType a rdfs:Class .
`
const options = { vocabulary: 'Example', namespace: 'urn:', prefix: 'Example' }

describe('vocabulary symbol, graph and validation authorities', () => {
  it('emits collision-free complete families and SCC-shared inherited properties', async () => {
    const result = await compile([{ id: 'fixture', quads: parse(source) }], options)
    expect(result.source).not.toMatch(/interface (?:Product|Other)PropertiesType extends/u)
    const property = result.manifest.symbols.find((value) => value.iri === 'urn:ProductSchema')!
    expect(property.name).not.toBe('ProductSchema')
    expect(result.manifest.symbols.find((value) => value.iri === 'urn:namespace')?.name).not.toBe(
      'namespace',
    )
    expect(result.manifest.symbols.find((value) => value.iri === 'urn:NodeType')?.name).not.toBe(
      'NodeType',
    )
    const directory = await Deno.makeTempDir()
    try {
      const path = `${directory}/vocabulary.ts`
      await Deno.writeTextFile(path, result.source)
      const module = await import(toFileUrl(path).href) as Record<string, unknown>
      for (const name of ['Product', 'Other']) {
        const schema = module[`${name}Schema`] as VocabularySchema
        const value = { '@type': name, price: 3, [property.name]: 'valid' }
        expect(await schema['~standard'].validate(value)).toEqual({ value })
        expect(await schema['~standard'].validate({ ...value, price: 'invalid' })).toMatchObject({
          issues: [{ path: ['price', 0] }],
        })
        expect(await schema['~standard'].validate({ ...value, [property.name]: 3 })).toMatchObject({
          issues: expect.any(Array),
        })
        const json = schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
        expect(json.properties).toHaveProperty('price')
        expect(json.properties).toHaveProperty(property.name)
      }
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
  it('uses the same reserved-field policy at runtime and JSON Schema export', async () => {
    const schema = createSchema({ types: ['Product'] })
    expect(schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' }).properties)
      .toMatchObject({ '@id': { type: 'string' } })
    for (const id of [2, null, [], {}]) {
      expect(await schema['~standard'].validate({ '@type': 'Product', '@id': id })).toMatchObject({
        issues: [{ path: ['@id'] }],
      })
    }
    const value = { '@type': 'Product', '@id': 'urn:id', extension: 2 }
    expect(await schema['~standard'].validate(value)).toEqual({ value })
    expect(() => createSchema({ types: ['Product'], properties: { '@id': 'number' } })).toThrow(
      TypeError,
    )
  })
  it('isolates schema descriptors from borrowed configuration and returned JSON Schema mutation', async () => {
    const types = ['Product'], properties = { name: 'string' as const }
    const schema = createSchema({ types, properties })
    types[0] = 'Other'
    const value = { '@type': 'Product', name: 'valid' }
    expect(await schema['~standard'].validate(value)).toEqual({ value })
    const json = schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    const fields = json.properties as Record<
      string,
      { type?: string; anyOf?: Record<string, unknown>[] }
    >
    fields['@id']!.type = 'number'
    fields.name!.anyOf![0]!.type = 'number'
    expect(schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' }).properties)
      .toMatchObject({
        '@id': { type: 'string' },
        name: { anyOf: [{ type: 'string' }, { type: 'array' }] },
      })
    const multiple = createSchema({ types: ['Product', 'Other'] })
    expect(multiple['~standard'].jsonSchema.output({ target: 'draft-07' }).properties)
      .toMatchObject({ '@type': { type: 'array' } })
    expect(await multiple['~standard'].validate({ '@type': 'Product' })).toMatchObject({
      issues: expect.any(Array),
    })
  })
  it('rejects compiler limits and pre-abort without emitting partial artifacts', async () => {
    await expect(compile([{ id: 'fixture', quads: parse(source) }], { ...options, maxTerms: 1 }))
      .rejects.toBeInstanceOf(RangeError)
    await expect(compile([{ id: 'fixture', quads: parse(source) }], { ...options, maxBytes: 10 }))
      .rejects.toBeInstanceOf(RangeError)
    await expect(
      compile([{ id: 'fixture', quads: parse(source) }], { ...options, maxProperties: 1 }),
    ).rejects.toBeInstanceOf(RangeError)
    const chain =
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . <urn:A> a rdfs:Class . <urn:B> a rdfs:Class; rdfs:subClassOf <urn:A> . <urn:C> a rdfs:Class; rdfs:subClassOf <urn:B> . <urn:p> rdfs:domain <urn:A> .'
    await expect(compile([{ id: 'chain', quads: parse(chain) }], { ...options, maxProperties: 2 }))
      .rejects.toBeInstanceOf(RangeError)
    await expect(compile([], { ...options, signal: AbortSignal.abort(null) })).rejects.toBe(null)
  })
})
