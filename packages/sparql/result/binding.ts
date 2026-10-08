/** SPARQL result bindings that preserve RDF terms. @module */

import { result } from './stream.ts'
import type { ResultType } from './stream.ts'

import type { TermType } from '@okikio/rdf'

/** One SPARQL solution mapping. Variable names do not include `?` or `$`. */
export type BindingType = ReadonlyMap<string, TermType>

/** Maps a stream of RDF-term bindings into application values without mutating the original rows. */
export function mapBindings<T>(
  bindings: AsyncIterable<BindingType>,
  map: (binding: BindingType) => T,
): ResultType<T> {
  const owned = bindings as Partial<ResultType<BindingType>>
  const release = typeof owned.cancel === 'function' && owned.cleanup instanceof Promise
    ? (reason: unknown): Promise<void> => {
      owned.cancel!(reason)
      return owned.cleanup!
    }
    : undefined
  return result(bindings, release ? { release } : {}, map)
}
