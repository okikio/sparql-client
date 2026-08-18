import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import fc from 'fast-check'
import type { ClassType, VocabularyModelType } from './model.ts'
import { plan } from './name.ts'

function cls(iri: string, name: string): ClassType {
  return {
    iri,
    names: [name],
    labels: [],
    comments: [],
    superClasses: [],
    equivalentClasses: [],
    disjointClasses: [],
    deprecated: false,
  }
}

function model(classes: readonly ClassType[]): VocabularyModelType {
  return { sources: [], classes, properties: [], datatypes: [], assertions: [], diagnostics: [] }
}

describe('vocabulary compiler properties', () => {
  it('plans symbols independently of ontology input order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,12}$/), { maxLength: 30 }),
        (names) => {
          const values = names.map((name, index) =>
            cls(`https://example.test/${index}/${name}`, name)
          )
          const forward = plan(model(values), { prefix: 'ex' })
          const reverse = plan(model([...values].reverse()), { prefix: 'ex' })
          expect(forward.symbols).toEqual(reverse.symbols)
        },
      ),
    )
  })
})
