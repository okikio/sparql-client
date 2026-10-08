/**
 * Adapted from rdfjs-base/dataset at 1a62b216c6ce76c809c40e9f1f62126947763808.
 * The 36 supported original assertions and case names are retained. The legacy
 * Quad-subject case becomes an explicit RDF 1.2 profile rejection test, mapped
 * in provenance.json; imports, namespace construction and runner registration
 * use this repository. MIT license is retained under
 * bench/upstream/sources/rdfjs-base-dataset/LICENSE.md. See provenance.json.
 * @module
 */

import { expect } from '@std/expect'
import type { NamedNode } from '@okikio/rdf'
import * as rdf from '@okikio/rdf'
import { describe, it } from 'node:test'

function define() {
  const factory = { dataset: rdf.dataset }

  const names = [
    'datatypeA',
    'datatypeB',
    'graph1',
    'graph2',
    'object',
    'object1',
    'object2',
    'object3',
    'predicate',
    'predicate1',
    'predicate2',
    'subject',
    'subject1',
    'subject2',
  ] as const
  const ex = Object.fromEntries(
    names.map((name) => [name, rdf.namedNode('http://example.org/' + name)]),
  ) as Record<typeof names[number], NamedNode>

  describe('DatasetCore', () => {
    describe('factory', () => {
      it('should be a function', () => {
        expect(typeof factory.dataset).toBe('function')
      })

      it('should add the given Quads', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)

        const dataset = factory.dataset([quad1, quad2])

        expect(dataset.has(quad1)).toBe(true)
        expect(dataset.has(quad2)).toBe(true)
      })
    })

    describe('size', () => {
      it('should be a number property', () => {
        const dataset = factory.dataset()

        expect(typeof dataset.size).toBe('number')
      })

      it('should be 0 if there are no Quads in the Dataset', () => {
        const dataset = factory.dataset()

        expect(dataset.size).toBe(0)
      })

      it('should be equal to the number of Quads in the Dataset', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1, quad2])

        expect(dataset.size).toBe(2)
      })

      it('should be updated after Quads are added', () => {
        const dataset = factory.dataset([rdf.quad(ex.subject, ex.predicate, ex.object1)])

        expect(dataset.size).toBe(1)

        dataset.add(rdf.quad(ex.subject, ex.predicate, ex.object2))

        expect(dataset.size).toBe(2)
      })

      it('should be updated after Quads are deleted', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1, quad2])

        expect(dataset.size).toBe(2)

        dataset.delete(quad1)

        expect(dataset.size).toBe(1)
      })
    })

    describe('add', () => {
      it('should be a function', () => {
        const dataset = factory.dataset()

        expect(typeof dataset.add).toBe('function')
      })

      it('should return itself', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, ex.object)
        const dataset = factory.dataset()

        const result = dataset.add(quad)

        expect(result).toBe(dataset)
      })

      it('should add the given Quad', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, ex.object)
        const dataset = factory.dataset()

        dataset.add(quad)

        expect(dataset.has(quad)).toBe(true)
      })

      it('should not add duplicate Quads', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, ex.object)
        const quadB = rdf.quad(ex.subject, ex.predicate, ex.object)
        const dataset = factory.dataset()

        dataset.add(quadA)
        dataset.add(quadB)

        expect(dataset.size).toBe(1)
      })

      it('should support Quads with Blank Nodes', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, rdf.blankNode())
        const dataset = factory.dataset()

        dataset.add(quad)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quad)).toBe(true)
      })

      it('should support Quads with Literals', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, rdf.literal('test'))
        const dataset = factory.dataset()

        dataset.add(quad)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quad)).toBe(true)
      })

      it('should support Quads with language Literals', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, rdf.literal('test', 'en'))
        const quadB = rdf.quad(ex.subject, ex.predicate, rdf.literal('test', 'de'))
        const dataset = factory.dataset()

        dataset.add(quadA)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(false)

        dataset.add(quadB)

        expect(dataset.size).toBe(2)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(true)
      })

      it('should support Quads with directional language Literals', () => {
        const quadA = rdf.quad(
          ex.subject,
          ex.predicate,
          rdf.literal('test', { language: 'en', direction: 'ltr' }),
        )
        const quadB = rdf.quad(
          ex.subject,
          ex.predicate,
          rdf.literal('test', { language: 'en', direction: 'rtl' }),
        )
        const dataset = factory.dataset()

        dataset.add(quadA)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(false)

        dataset.add(quadB)

        expect(dataset.size).toBe(2)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(true)
      })

      it('should support Quads with directional and non-directional Literals using the same language', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, rdf.literal('test', 'en'))
        const quadB = rdf.quad(
          ex.subject,
          ex.predicate,
          rdf.literal('test', { language: 'en', direction: 'ltr' }),
        )
        const dataset = factory.dataset()

        dataset.add(quadA)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(false)

        dataset.add(quadB)

        expect(dataset.size).toBe(2)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(true)
      })

      it('should support Quads with datatype Literals', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, rdf.literal('123', ex.datatypeA))
        const quadB = rdf.quad(ex.subject, ex.predicate, rdf.literal('123', ex.datatypeB))
        const dataset = factory.dataset()

        dataset.add(quadA)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quadA)).toBe(true)
        expect(!dataset.has(quadB)).toBe(true)

        dataset.add(quadB)

        expect(dataset.size).toBe(2)
        expect(dataset.has(quadA)).toBe(true)
        expect(dataset.has(quadB)).toBe(true)
      })

      it('rejects the upstream legacy Quad-subject case outside the RDF 1.2 profile', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, ex.object)
        // RDF 1.2 triple terms are object terms. Reflect.apply admits the
        // deliberately unsupported external call without widening term types.
        expect(() => Reflect.apply(rdf.quad, undefined, [quadA, ex.predicate, ex.object]))
          .toThrow(TypeError)
      })

      it('should support Quads having a Quad as object', () => {
        const quadA = rdf.quad(ex.subject, ex.predicate, ex.object)
        const quadB = rdf.quad(ex.subject, ex.predicate, quadA)
        const dataset = factory.dataset()

        dataset.add(quadB)

        expect(dataset.size).toBe(1)
        expect(dataset.has(quadB)).toBe(true)
      })
    })

    describe('delete', () => {
      it('should be a function', () => {
        const dataset = factory.dataset()

        expect(typeof dataset.delete).toBe('function')
      })

      it('should return itself', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, ex.object)
        const dataset = factory.dataset([quad])

        const result = dataset.delete(quad)

        expect(result).toBe(dataset)
      })

      it('should remove the given Quad', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, ex.object)
        const dataset = factory.dataset([quad])

        dataset.delete(quad)

        expect(dataset.has(quad)).toBe(false)
      })

      it('should remove only the given Quad', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1, quad2])

        dataset.delete(quad1)

        expect(dataset.has(quad1)).toBe(false)
        expect(dataset.has(quad2)).toBe(true)
      })

      it('should remove the Quad with the same SPOG as the given Quad', () => {
        const quad = rdf.quad(ex.subject, ex.predicate, ex.object)
        const quadCloned = rdf.quad(quad.subject, quad.predicate, quad.object, quad.graph)
        const dataset = factory.dataset([quad])

        dataset.delete(quadCloned)

        expect(dataset.has(quad)).toBe(false)
      })

      it('should ignore an unknown Quad', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1])

        dataset.delete(quad2)

        expect(dataset.has(quad1)).toBe(true)
        expect(dataset.has(quad2)).toBe(false)
        expect(dataset.size).toBe(1)
      })
    })

    describe('has', () => {
      it('should be a function', () => {
        const dataset = factory.dataset()

        expect(typeof dataset.has).toBe('function')
      })

      it('should return false if the given Quad is not in the Dataset', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1])

        expect(dataset.has(quad2)).toBe(false)
      })

      it('should return true if the given Quad is in the Dataset', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1, quad2])

        expect(dataset.has(quad2)).toBe(true)
      })
    })

    describe('match', () => {
      it('should be a function', () => {
        const dataset = factory.dataset()

        expect(typeof dataset.match).toBe('function')
      })

      it('should use the given subject to select Quads', () => {
        const quad1 = rdf.quad(ex.subject1, ex.predicate, ex.object)
        const quad2 = rdf.quad(ex.subject2, ex.predicate, ex.object)
        const dataset = factory.dataset([quad1, quad2])

        const matches = dataset.match(ex.subject2)

        expect(matches.size).toBe(1)
        expect(matches.has(quad2)).toBe(true)
      })

      it('should use the given predicate to select Quads', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate1, ex.object)
        const quad2 = rdf.quad(ex.subject, ex.predicate2, ex.object)
        const dataset = factory.dataset([quad1, quad2])

        const matches = dataset.match(null, ex.predicate2)

        expect(matches.size).toBe(1)
        expect(matches.has(quad2)).toBe(true)
      })

      it('should use the given object to select Quads', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object2)
        const dataset = factory.dataset([quad1, quad2])

        const matches = dataset.match(null, null, ex.object2)

        expect(matches.size).toBe(1)
        expect(matches.has(quad2)).toBe(true)
      })

      it('should use the given graph to select Quads', () => {
        const quad1 = rdf.quad(ex.subject, ex.predicate, ex.object, ex.graph1)
        const quad2 = rdf.quad(ex.subject, ex.predicate, ex.object, ex.graph2)
        const dataset = factory.dataset([quad1, quad2])

        const matches = dataset.match(null, null, null, ex.graph2)

        expect(matches.size).toBe(1)
        expect(matches.has(quad2)).toBe(true)
      })

      it('should return an empty Dataset if there are no matches', () => {
        const quad1 = rdf.quad(ex.subject1, ex.predicate, ex.object)
        const quad2 = rdf.quad(ex.subject2, ex.predicate, ex.object)
        const dataset = factory.dataset([quad1, quad2])

        const matches = dataset.match(null, null, ex.object3)

        expect(matches.size).toBe(0)
      })
    })

    describe('Symbol.iterator', () => {
      it('should be a function', () => {
        const dataset = factory.dataset()

        expect(typeof dataset[Symbol.iterator]).toBe('function')
      })

      it('should return an iterator', () => {
        const quad1 = rdf.quad(ex.subject1, ex.predicate, ex.object)
        const quad2 = rdf.quad(ex.subject2, ex.predicate, ex.object)
        const dataset = factory.dataset([quad1, quad2])

        const iterator = dataset[Symbol.iterator]()

        expect(typeof iterator.next).toBe('function')
        expect(typeof iterator.next().value).toBe('object')
      })

      it('should iterate over all Quads', () => {
        const quad1 = rdf.quad(ex.subject1, ex.predicate, ex.object)
        const quad2 = rdf.quad(ex.subject2, ex.predicate, ex.object)
        const dataset = factory.dataset([quad1, quad2])

        const iterator = dataset[Symbol.iterator]()

        const output = factory.dataset()

        for (let item = iterator.next(); item.value; item = iterator.next()) {
          output.add(item.value)
        }

        expect(output.size).toBe(2)
        expect(output.has(quad1)).toBe(true)
        expect(output.has(quad2)).toBe(true)
      })
    })
  })
}

define()
