/** Incremental UTF-8/text source helpers shared by RDF syntax parsers. @module */

import { consume, pending } from './iteration.ts'

const DIRECT_CHUNK_SIZE = 16 * 1024

/** Byte/text source accepted by streaming RDF parsers. */
export type TextSourceType =
  | string
  | Uint8Array
  | Iterable<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>
  | ReadableStream<Uint8Array>

/**
 * Iterates source chunks while borrowing the owning source resource.
 *
 * A signal interrupts pending iterable reads. Early exit, failure, and abort
 * call the acquired iterator return method once. Abort does not wait for borrowed
 * cleanup; ordinary early return awaits cooperative cleanup.
 *
 * A Web `ReadableStream` reader is cancelled when the consumer returns before
 * source completion. Cancellation is requested once and the acquired reader lock is released.
 * An uncooperative underlying cancellation promise cannot delay abort; arbitrary
 * producer work cannot be forcibly interrupted.
 */
export async function* chunks(
  source: TextSourceType,
  signal?: AbortSignal,
): AsyncGenerator<string | Uint8Array> {
  throwIfAborted(signal)
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
          signal?.aborted ? signal.reason : 'RDF parser consumer stopped before source completion',
        )
        void cleanup.catch(() => undefined)
        // A reader lock is ours; the underlying cancellation promise is borrowed.
        // Releasing the lock does not depend on that promise settling.
        reader.releaseLock()
        if (!signal?.aborted) await pending(() => cleanup, signal)
      } else {
        reader.releaseLock()
      }
    }
  }

  yield* consume(
    source as Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>,
    signal,
  )
}

/** Throws the caller's abort reason before additional parsing work is accepted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason
}
