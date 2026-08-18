/** Format-neutral RDF ontology to TypeScript vocabulary compiler. @module */

import type { OntologySourceType } from '@okikio/rdf/ontology'
import { emit, type EmitOptionsType, type EmitResultType } from './emit.ts'
import { inspect, type InspectOptionsType } from './inspect.ts'

/** Options for one ontology compilation. */
export interface CompileOptionsType extends EmitOptionsType {
  /** Ontology-inspection limits and vocabulary-specific relationship aliases. */
  readonly inspect?: InspectOptionsType
}

/**
 * Compiles RDF quad sources into one deterministic TypeScript vocabulary module.
 *
 * Parsing is deliberately outside this function. Turtle, TriG, N-Quads,
 * JSON-LD, RDF/XML, a triplestore cursor, or any future source can participate
 * as long as it exposes RDF quads. This is the reusable replacement for the old
 * format-specific `ttl-to-ts` script.
 *
 * @example
 * ```ts
 * import * as vocab from '@okikio/vocab'
 *
 * const result = await vocab.compile([{ id: 'example', quads }], {
 *   vocabulary: 'Example',
 *   namespace: 'https://example.test/',
 *   prefix: 'ex',
 * })
 * console.log(result.source)
 * ```
 */
export async function compile(
  sources: readonly OntologySourceType[],
  options: CompileOptionsType,
): Promise<EmitResultType> {
  const model = await inspect(sources, options.inspect)
  return emit(model, options)
}
