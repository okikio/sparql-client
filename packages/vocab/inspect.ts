/**
 * RDF ontology model to vocabulary-generator IR adapter.
 *
 * Generic RDFS/OWL interpretation belongs to `@okikio/rdf/ontology`. This
 * module adds vocabulary-generator policy: source symbol candidates and common
 * Schema.org domain/range aliases.
 *
 * @module
 */

import {
  inspect as inspectOntology,
  type InspectOptionsType as OntologyInspectOptionsType,
  type OntologySourceType,
} from '@okikio/rdf/ontology'
import type { ClassType, PropertyType, VocabularyModelType } from './model.ts'

/** Schema.org HTTPS extension predicate used as an additional vocabulary-domain declaration. */
const SCHEMA_DOMAIN = 'https://schema.org/domainIncludes'
/** Schema.org HTTPS extension predicate used as an additional vocabulary-range declaration. */
const SCHEMA_RANGE = 'https://schema.org/rangeIncludes'
/** Legacy Schema.org HTTP domain predicate retained for older vocabulary releases. */
const SCHEMA_HTTP_DOMAIN = 'http://schema.org/domainIncludes'
/** Legacy Schema.org HTTP range predicate retained for older vocabulary releases. */
const SCHEMA_HTTP_RANGE = 'http://schema.org/rangeIncludes'

export type { OntologySourceType }

/** Additional vocabulary conventions accepted by the vocabulary inspector. */
export interface InspectOptionsType
  extends Omit<OntologyInspectOptionsType, 'domainPredicates' | 'rangePredicates'> {
  /** Additional predicate IRIs interpreted as ontology property-domain declarations. */
  readonly domainPredicates?: readonly string[]
  /** Additional predicate IRIs interpreted as ontology property-range declarations. */
  readonly rangePredicates?: readonly string[]
}

/**
 * Inspects ontology sources into the deterministic vocabulary compiler model.
 *
 * Schema.org domain/range aliases are enabled because generated Schema.org is a
 * first-class consumer. Callers can add equivalent vocabulary-specific aliases
 * without teaching the generic RDF ontology package about those vocabularies.
 *
 * @example
 * ```ts
 * import * as vocab from '@okikio/vocab'
 *
 * const model = await vocab.inspect([{ id: 'example', quads }])
 * console.log(model.classes.length)
 * ```
 */
export async function inspect(
  sources: readonly OntologySourceType[],
  options: InspectOptionsType = {},
): Promise<VocabularyModelType> {
  const model = await inspectOntology(sources, {
    domainPredicates: [SCHEMA_DOMAIN, SCHEMA_HTTP_DOMAIN, ...(options.domainPredicates ?? [])],
    rangePredicates: [SCHEMA_RANGE, SCHEMA_HTTP_RANGE, ...(options.rangePredicates ?? [])],
    ...(options.maxQuads === undefined ? {} : { maxQuads: options.maxQuads }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  return {
    sources: model.sources,
    classes: model.classes.map(toClass),
    properties: model.properties.map(toProperty),
    datatypes: model.datatypes,
    assertions: model.assertions,
    diagnostics: model.diagnostics.map((value) => value.message),
  }
}

/** Projects a generic ontology class into the vocabulary compiler model. */
function toClass(value: Parameters<typeof classValue>[0]): ClassType {
  return classValue(value)
}

/** Adds the deterministic source symbol candidate used by vocabulary naming. */
function classValue(
  value: Awaited<ReturnType<typeof inspectOntology>>['classes'][number],
): ClassType {
  return { ...value, names: [localName(value.iri)] }
}

/** Projects a generic ontology property into the vocabulary compiler model and retains functional semantics. */
function toProperty(
  value: Awaited<ReturnType<typeof inspectOntology>>['properties'][number],
): PropertyType {
  return {
    ...value,
    names: [localName(value.iri)],
    functional: value.characteristics.includes('functional'),
  }
}

/** Derives a stable source-symbol candidate from an ontology IRI without changing the IRI itself. */
function localName(iri: string): string {
  const hash = iri.lastIndexOf('#')
  const slash = iri.lastIndexOf('/')
  const colon = iri.lastIndexOf(':')
  return iri.slice(Math.max(hash, slash, colon) + 1) || 'Term'
}
