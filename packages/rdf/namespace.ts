/** Namespace helpers for building RDF named nodes without global registration. @module */

import { namedNode } from './factory.ts'
import type { NamedNode } from './term.ts'

/** A callable namespace that expands local names into RDF named nodes. */
export interface Namespace {
  /** Creates a named node by resolving the supplied suffix against this namespace base IRI. */
  (local: string): NamedNode
  /** Absolute IRI represented by this record. */
  readonly iri: string
}

/** Creates an import-safe namespace expansion function. */
export function namespace(iri: string): Namespace {
  const expand = ((local: string) => namedNode(`${iri}${local}`)) as Namespace
  Object.defineProperty(expand, 'iri', { value: iri, enumerable: true })
  return expand
}
