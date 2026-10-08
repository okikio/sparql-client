import { consume, pending } from '@okikio/rdf/stream'
/** Incremental source adapter used by the SPARQL lexical scanner. @module */

import type { SourceType } from './types.ts'

/** Window used to expose direct string/byte inputs through the same bounded streaming path as chunked sources. */
const DIRECT_CHUNK_SIZE = 16 * 1024

/**
 * Iterates source chunks without taking ownership of ordinary iterables.
 *
 * A Web stream reader is cancelled when the syntax consumer stops early. A
 * pending read is also cancelled when the operation signal aborts.
 */
export async function* chunks(
  source: SourceType,
  signal?: AbortSignal,
  onCleanup?: (cleanup: Promise<void>) => void,
): AsyncGenerator<string | Uint8Array> {
  if (typeof source === 'string') {
    for (let offset = 0; offset < source.length; offset += DIRECT_CHUNK_SIZE) {
      throwIfAborted(signal)
      yield source.slice(offset, offset + DIRECT_CHUNK_SIZE)
    }
    return
  }

  if (source instanceof Uint8Array) {
    for (let offset = 0; offset < source.byteLength; offset += DIRECT_CHUNK_SIZE) {
      throwIfAborted(signal)
      yield source.subarray(offset, offset + DIRECT_CHUNK_SIZE)
    }
    return
  }

  if (source instanceof ReadableStream) {
    const reader = source.getReader()
    let complete = false
    try {
      while (true) {
        throwIfAborted(signal)
        const item = await pending(() => reader.read(), signal)
        if (item.done) {
          complete = true
          return
        }
        yield item.value
      }
    } finally {
      if (!complete) {
        const cleanup = reader.cancel(
          signal?.aborted
            ? signal.reason
            : 'SPARQL syntax consumer stopped before source completion',
        )
        void cleanup.catch(() => undefined)
        reader.releaseLock()
        onCleanup?.(cleanup)
      } else reader.releaseLock()
    }
  }

  if (Symbol.asyncIterator in Object(source)) {
    for await (
      const chunk of consume(source as AsyncIterable<string | Uint8Array>, signal, onCleanup)
    ) {
      throwIfAborted(signal)
      yield chunk
    }
    return
  }

  for (const chunk of source as Iterable<string | Uint8Array>) {
    throwIfAborted(signal)
    yield chunk
  }
}

/** Throws the original abort reason before more input is accepted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason
}
