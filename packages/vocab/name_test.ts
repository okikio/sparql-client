import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import type { ClassType, VocabularyModelType } from './model.ts'
import { plan } from './name.ts'

/** Builds the minimum compiler model needed to test symbol planning. */
function model(classes: readonly ClassType[]): VocabularyModelType {
  return { sources: [], classes, properties: [], datatypes: [], assertions: [], diagnostics: [] }
}

/** Builds one class with a caller-selected source symbol candidate. */
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

describe('@okikio/vocab symbol planning', () => {
  it('resolves collisions independently of ontology input order', () => {
    const alpha = cls('https://a.example/Thing', 'Thing')
    const beta = cls('https://b.example/Thing', 'Thing')
    const forward = plan(model([alpha, beta]), { prefix: 'ex' })
    const reverse = plan(model([beta, alpha]), { prefix: 'ex' })
    expect([...forward.classes]).toEqual([...reverse.classes])
    expect(forward.symbols).toEqual(reverse.symbols)
  })

  it('qualifies reserved and invalid TypeScript identifiers', () => {
    const result = plan(model([
      cls('urn:class', 'class'),
      cls('urn:bad', 'not-valid!'),
    ]), { prefix: 'demo' })
    expect(result.classes.get('urn:class') === 'class').toBe(false)
    expect(result.classes.get('urn:bad')?.startsWith('Demo')).toBe(true)
  })
})
