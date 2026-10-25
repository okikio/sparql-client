/** Incremental UTF-8/text source helpers shared by RDF syntax parsers. @module */

import { consume } from './iteration.ts'

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
 * call the acquired iterator return method once; cooperative upstream cleanup
 * must settle for the parser operation to finish.
 *
 * A Web `ReadableStream` reader is cancelled when the consumer returns before
 * source completion. This prevents an upstream producer from continuing work
 * after a parser or its caller has stopped reading.
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
        const item = await read(reader, signal)
        if (item.done) {
          complete = true
          return
        }
        yield item.value
      }
    } finally {
      if (!complete) {
        await reader.cancel('RDF parser consumer stopped before source completion').catch(() =>
          undefined
        )
      }
      reader.releaseLock()
    }
  }

  yield* consume(
    source as Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>,
    signal,
  )
}

/** Read from the supplied source while preserving caller ownership. */
function read(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read()
  if (signal.aborted) {
    void reader.cancel(signal.reason).catch(() => undefined)
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      finish()
      void reader.cancel(signal.reason).catch(() => undefined)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (value) => {
        if (settled) return
        settled = true
        finish()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
  })
}

/** Throws the caller's abort reason before additional parsing work is accepted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
