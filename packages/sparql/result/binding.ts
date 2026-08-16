/** SPARQL result bindings that preserve RDF terms. @module */

import type { TermType } from '@okikio/rdf'

/** One SPARQL solution mapping. Variable names do not include `?` or `$`. */
export type BindingType = ReadonlyMap<string, TermType>

/** Maps a stream of RDF-term bindings into application values without mutating the original rows. */
export async function* mapBindings<T>(
  bindings: AsyncIterable<BindingType>,
  map: (binding: BindingType) => T,
): AsyncGenerator<T> {
  for await (const binding of bindings) yield map(binding)
}
