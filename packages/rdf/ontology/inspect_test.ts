import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from '../turtle/mod.ts'
import { index, inspect } from './mod.ts'

const SCHEMA_DOMAIN = 'https://schema.org/domainIncludes'
const SCHEMA_RANGE = 'https://schema.org/rangeIncludes'

describe('@okikio/rdf/ontology', () => {
  it('inspects named RDFS/OWL relationships and configurable vocabulary aliases', async () => {
    const source = `
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix schema: <https://schema.org/> .
      @prefix ex: <https://example.com/> .

      ex:Thing a rdfs:Class .
      ex:Product a owl:Class ; rdfs:subClassOf ex:Thing .
      ex:name a rdf:Property, owl:FunctionalProperty ;
        schema:domainIncludes ex:Thing ; schema:rangeIncludes schema:Text .
    `
    const model = await inspect([{ id: 'test', quads: parse(source) }], {
      domainPredicates: [SCHEMA_DOMAIN],
      rangePredicates: [SCHEMA_RANGE],
    })
    expect(model.classes).toHaveLength(2)
    expect(model.properties[0]?.characteristics.includes('functional')).toBe(true)
    expect(index(model).superClasses('https://example.com/Product')).toHaveLength(1)
    expect(index(model).propertiesForClass('https://example.com/Product')).toHaveLength(1)
  })

  it('retains anonymous OWL expressions instead of silently flattening them', async () => {
    const source = `
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix ex: <https://example.com/> .
      ex:Product a owl:Class ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:name ] .
    `
    const model = await inspect([{ id: 'test', quads: parse(source) }])
    expect(model.classes).toHaveLength(1)
    expect(model.assertions.length > 0).toBe(true)
  })
})
