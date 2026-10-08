/** Explicitly owned engines for upstream query fixtures; no production compatibility shim. @module */

import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { Store as OxigraphStore } from 'oxigraph'
import { Parser, Store as N3Store } from 'n3'
import { create as createOxigraph } from '@okikio/oxigraph'
import { create as createComunica } from '@okikio/comunica'
import type { Queryable } from '@okikio/sparql'

/** One fixture owns its engine; callers must retire operation wrappers and close the fixture. */
export interface EngineType {
  readonly client: Queryable
  retire(): void
  close(): void
}

/**
 * Creates the actual pinned engine over identical N-Quads fixture bytes.
 *
 * Oxigraph result wrappers and getter-created term wrappers belong to this
 * fixture, never the production adapter. Retirement is included in query timing.
 * Comunica reads/writes the caller-owned in-memory N3 source; no network is used.
 */
export function openEngine(kind: 'Oxigraph' | 'Comunica', data: string): EngineType {
  if (kind === 'Comunica') {
    const source = new N3Store(new Parser({ format: 'N-Quads' }).parse(data))
    const engine = new QueryEngine()
    return {
      client: createComunica(engine, { context: () => ({ sources: [source] }) }),
      retire() {},
      close() {
        source.removeQuads([...source])
      },
    }
  }
  const store = new OxigraphStore()
  const pending = new Set<{ free(): void }>()
  let closed = false
  /** Tracks exact engine-owned wrappers, including child term access during adapter conversion. */
  function track<T extends object>(value: T): T {
    if (typeof Reflect.get(value, 'free') === 'function') pending.add(value as T & { free(): void })
    return new Proxy(value, {
      get(target, property) {
        const child: unknown = Reflect.get(target, property, target)
        return typeof child === 'object' && child !== null &&
            typeof Reflect.get(child, 'free') === 'function'
          ? track(child)
          : child
      },
    })
  }
  /** Attempts every wrapper retirement rather than masking the first failure with later cleanup. */
  function retire(): void {
    const failures: unknown[] = []
    for (const value of [...pending].reverse()) {
      pending.delete(value)
      try {
        value.free()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Engine result retirement failed')
  }
  const view = {
    query(query: string): ReturnType<OxigraphStore['query']> {
      const result = store.query(query)
      if (Array.isArray(result)) {
        for (let index = 0; index < result.length; index++) {
          const row = result[index]
          if (row instanceof Map) { for (const [key, term] of row) row.set(key, track(term)) }
          else if (typeof row === 'object' && row !== null) result[index] = track(row)
        }
      }
      return result
    },
    update(query: string): void {
      store.update(query)
    },
  }
  try {
    store.load(data, { format: 'application/n-quads' })
  } catch (primary) {
    try {
      release(store)
    } catch (secondary) {
      throw new AggregateError([primary, secondary], 'Engine load/release failed')
    }
    throw primary
  }
  return {
    client: createOxigraph(view),
    retire,
    close() {
      if (closed) return
      closed = true
      const failures: unknown[] = []
      try {
        retire()
      } catch (error) {
        failures.push(error)
      }
      try {
        release(store)
      } catch (error) {
        failures.push(error)
      }
      if (failures.length) throw new AggregateError(failures, 'Engine close failed')
    },
  }
}

/** Pinned Wasm types omit free(); require its actual callable shape rather than silently relying on finalizers. */
function release(value: object): void {
  const free: unknown = Reflect.get(value, 'free')
  if (typeof free !== 'function') throw new TypeError('Pinned engine has no explicit free()')
  Reflect.apply(free, value, [])
}
