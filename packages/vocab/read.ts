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
  read as readOntology,
  type OntologySourceType,
  type ReadOptions as OntologyReadOptions,
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

/** Additional vocabulary conventions accepted by the generator reader. */
export interface ReadOptions extends Omit<OntologyReadOptions, 'domainPredicates' | 'rangePredicates'> {
  readonly domainPredicates?: readonly string[]
  readonly rangePredicates?: readonly string[]
}

/**
 * Reads ontology sources into the deterministic vocabulary compiler model.
 *
 * Schema.org domain/range aliases are enabled because generated Schema.org is a
 * first-class consumer. Callers can add equivalent vocabulary-specific aliases
 * without teaching the generic RDF ontology package about those vocabularies.
 */
export async function read(
  sources: readonly OntologySourceType[],
  options: ReadOptions = {},
): Promise<VocabularyModelType> {
  const model = await readOntology(sources, {
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
function classValue(value: Awaited<ReturnType<typeof readOntology>>['classes'][number]): ClassType {
  return { ...value, names: [localName(value.iri)] }
}

/** Projects a generic ontology property into the vocabulary compiler model and retains functional semantics. */
function toProperty(value: Awaited<ReturnType<typeof readOntology>>['properties'][number]): PropertyType {
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
