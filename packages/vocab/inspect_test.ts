import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from '@okikio/rdf/turtle'
import { inspect } from './inspect.ts'

describe('@okikio/vocab ontology adapter', () => {
  it('adds Schema.org domain/range aliases without changing the generic ontology inspector', async () => {
    const source = `
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix schema: <https://schema.org/> .
      @prefix ex: <https://example.com/> .
      ex:Product a rdfs:Class .
      ex:name a rdf:Property ; schema:domainIncludes ex:Product ; schema:rangeIncludes schema:Text .
    `
    const model = await inspect([{ id: 'schema-style', quads: parse(source) }])
    expect(model.properties[0]?.domains).toEqual(['https://example.com/Product'])
    expect(model.properties[0]?.ranges).toEqual(['https://schema.org/Text'])
    expect(model.properties[0]?.names).toEqual(['name'])
  })

  it('accepts additional vocabulary-specific relationship aliases', async () => {
    const source = `
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix ex: <https://example.com/> .
      ex:Thing a rdfs:Class .
      ex:value a rdf:Property ; ex:appliesTo ex:Thing .
    `
    const model = await inspect([{ id: 'custom', quads: parse(source) }], {
      domainPredicates: ['https://example.com/appliesTo'],
    })
    expect(model.properties[0]?.domains).toEqual(['https://example.com/Thing'])
  })
})
