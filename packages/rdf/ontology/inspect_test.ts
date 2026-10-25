import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse } from '../turtle/mod.ts'
import { namedNode, type Quad, quad, RDF } from '../mod.ts'
import { index, inspect } from './mod.ts'

const SCHEMA_DOMAIN = 'https://schema.org/domainIncludes'
const SCHEMA_RANGE = 'https://schema.org/rangeIncludes'

describe('@okikio/rdf/ontology', () => {
  it('rejects invalid quad bounds before acquiring any ontology source', async () => {
    let acquired = 0
    const quads = {
      [Symbol.iterator]() {
        acquired++
        return [][Symbol.iterator]()
      },
    }
    for (const maxQuads of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(inspect([{ id: 'bound', quads }], { maxQuads })).rejects.toBeInstanceOf(
        RangeError,
      )
    }
    expect((await inspect([], { maxQuads: 1 })).classes).toHaveLength(0)
    expect(acquired).toBe(0)
  })

  it(
    'cancels a pending ontology read and closes its iterator once',
    { timeout: 2_000 },
    async () => {
      const controller = new AbortController()
      const started = Promise.withResolvers<void>()
      let returned = 0
      const quads: AsyncIterable<Quad> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              started.resolve()
              return new Promise<IteratorResult<Quad>>(() => {})
            },
            return() {
              returned++
              return Promise.resolve({ done: true as const, value: undefined })
            },
          }
        },
      }
      const reason = new Error('cancel borrowed ontology source')
      const pending = inspect([{ id: 'pending', quads }], { signal: controller.signal })
      await started.promise
      controller.abort(reason)
      await expect(pending).rejects.toBe(reason)
      expect(returned).toBe(1)
    },
  )

  it('honors pre-abort for sources and for an empty ontology', async () => {
    let acquired = 0
    const reason = new Error('cancel before ontology acquisition')
    const quads = {
      [Symbol.iterator]() {
        acquired++
        return [][Symbol.iterator]()
      },
    }
    const signal = AbortSignal.abort(reason)
    await expect(inspect([{ id: 'pre-abort', quads }], { signal })).rejects.toBe(reason)
    await expect(inspect([], { signal })).rejects.toBe(reason)
    expect(acquired).toBe(0)
  })

  it('counts materialized input across sources and closes the source exceeding the bound', async () => {
    const value = quad(
      namedNode('urn:Class'),
      namedNode(RDF.type),
      namedNode('http://www.w3.org/2000/01/rdf-schema#Class'),
    )
    expect((await inspect([{ id: 'first', quads: [value] }], { maxQuads: 1 })).classes)
      .toHaveLength(1)
    let returned = 0
    let pulled = 0
    const quads = {
      [Symbol.iterator]() {
        return {
          next() {
            pulled++
            return { done: false as const, value }
          },
          return() {
            returned++
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    await expect(
      inspect([{ id: 'first', quads: [value] }, { id: 'second', quads }], { maxQuads: 1 }),
    )
      .rejects.toBeInstanceOf(RangeError)
    expect(pulled).toBe(1)
    expect(returned).toBe(1)
  })

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
    expect(index(model).superClasses('https://example.com/Product')).toEqual([
      'https://example.com/Thing',
    ])
    expect(index(model).propertiesForClass('https://example.com/Product').map((value) => value.iri))
      .toEqual(['https://example.com/name'])
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
