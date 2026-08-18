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
        const item = await read(reader, signal)
        if (item.done) {
          complete = true
          return
        }
        yield item.value
      }
    } finally {
      if (!complete) {
        await reader.cancel('SPARQL syntax consumer stopped before source completion').catch(() =>
          undefined
        )
      }
      reader.releaseLock()
    }
  }

  if (Symbol.asyncIterator in Object(source)) {
    for await (const chunk of source as AsyncIterable<string | Uint8Array>) {
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
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Cancels a Web Stream read that is already pending when the operation aborts. */
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
