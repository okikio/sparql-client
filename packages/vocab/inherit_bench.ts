/** SCC/property projection scenarios; no performance claim without a measured baseline. @module */
import { bench, do_not_optimize } from 'mitata'
import { deepStrictEqual } from 'node:assert'
import { report } from '../../bench/report.ts'
import { inherit } from './inherit.ts'
import type { VocabularyModelType } from './model.ts'

// Graph and oracle are constructed before timed callbacks. In a cycle every
// class reaches all 100 properties; in a chain C99 reaches C0's one property.
const count = 100
function fixture(cycle: boolean): VocabularyModelType {
  const classes = Array.from({ length: count }, (_, index) => ({
    iri: `urn:C${index}`,
    names: [`C${index}`],
    labels: [],
    comments: [],
    superClasses: cycle ? [`urn:C${(index + 1) % count}`] : index ? [`urn:C${index - 1}`] : [],
    equivalentClasses: [],
    disjointClasses: [],
    deprecated: false,
  }))
  const properties = Array.from({ length: cycle ? count : 1 }, (_, index) => ({
    iri: `urn:p${index}`,
    names: [`p${index}`],
    labels: [],
    comments: [],
    kinds: ['rdf'] as const,
    domains: [`urn:C${index}`],
    ranges: [],
    superProperties: [],
    equivalentProperties: [],
    inverseOf: [],
    disjointProperties: [],
    characteristics: [],
    functional: false,
    deprecated: false,
  }))
  return { sources: [], classes, properties, datatypes: [], assertions: [], diagnostics: [] }
}
for (const cycle of [false, true]) {
  const model = fixture(cycle)
  // Every class in the chain reaches C0's property. Every class in the cycle
  // reaches every property. Build both complete identities from that authored
  // meaning, so missing classes and substituted or duplicate properties fail.
  const expected = new Map(Array.from({ length: count }, (_, index) =>
    [
      `urn:C${index}`,
      Array.from({ length: cycle ? count : 1 }, (_, property) => `urn:p${property}`).sort(),
    ] as const))
  const actual = new Map([...inherit(model)].map(([iri, properties]) =>
    [
      iri,
      properties.map((property) => property.iri).sort(),
    ] as const
  ))
  deepStrictEqual(actual, expected, 'Inherited class/property identities differ.')
  bench(
    `vocab SCC projection: ${
      cycle ? '100-class cycle / 100 properties' : '100-class chain / one property'
    }`,
    () => {
      do_not_optimize(inherit(model))
    },
  )
}
await report()
