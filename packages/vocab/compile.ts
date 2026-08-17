/** Format-neutral RDF ontology to TypeScript vocabulary compiler. @module */

import type { OntologySourceType } from '@okikio/rdf/ontology'
import { emit, type EmitOptionsType, type EmitResultType } from './emit.ts'
import { read, type ReadOptions } from './read.ts'

/** Options for one ontology compilation. */
export interface CompileOptionsType extends EmitOptionsType {
  /** Ontology-reading limits and vocabulary-specific relationship aliases. */
  readonly read?: ReadOptions
}

/**
 * Compiles RDF quad sources into one deterministic TypeScript vocabulary module.
 *
 * Parsing is deliberately outside this function. Turtle, TriG, N-Quads,
 * JSON-LD, RDF/XML, a triplestore cursor, or any future source can participate
 * as long as it exposes RDF quads. This is the reusable replacement for the old
 * format-specific `ttl-to-ts` script.
 */
export async function compile(
  sources: readonly OntologySourceType[],
  options: CompileOptionsType,
): Promise<EmitResultType> {
  const model = await read(sources, options.read)
  return emit(model, options)
}
