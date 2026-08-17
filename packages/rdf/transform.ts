/** Internal bridge from Node-style streaming RDF parsers to Web-oriented RDF sources. @module */

import { fromQuad } from './factory.ts'
import type { Quad } from './term.ts'
import { chunks, throwIfAborted, type TextSource } from './text.ts'

/** Minimal stream surface required from an external streaming RDF parser. */
export interface TransformParserType extends AsyncIterable<Quad> {
  write(chunk: string | Uint8Array): boolean
  end(): void
  once(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): this
  off(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): this
  destroy(error?: Error): void
}

/**
 * Reads an external Transform parser through the project's async-iterable RDF contract.
 *
 * The parser resource is owned by this operation. The source is borrowed. Returning
 * from iteration early aborts the source pump and destroys the parser so upstream
 * network, file, or Web Stream work cannot continue without a consumer.
 */
export async function* parseTransform(
  parser: TransformParserType,
  source: TextSource,
  options: { readonly label: string; readonly signal?: AbortSignal },
): AsyncGenerator<Quad> {
  throwIfAborted(options.signal)
  const lifecycle = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, lifecycle.signal]) : lifecycle.signal
  let complete = false
  const pumping = pump(parser, source, signal, options.label)

  try {
    for await (const value of parser) {
      throwIfAborted(signal)
      yield fromQuad(value)
    }
    await pumping
    complete = true
  } finally {
    if (!complete) {
      lifecycle.abort(new DOMException(`${options.label} consumer stopped before source completion`, 'AbortError'))
      parser.destroy()
    }
    await pumping.catch(() => undefined)
  }
}

/** Feeds source chunks into the parser while respecting writable backpressure. */
async function pump(
  parser: TransformParserType,
  source: TextSource,
  signal: AbortSignal,
  label: string,
): Promise<void> {
  try {
    for await (const value of chunks(source, signal)) {
      throwIfAborted(signal)
      if (!parser.write(value)) await drain(parser, signal, label)
    }
    throwIfAborted(signal)
    parser.end()
  } catch (error) {
    parser.destroy(toError(error))
    throw error
  }
}

/** Waits for parser capacity while remaining interruptible by caller cancellation. */
function drain(parser: TransformParserType, signal: AbortSignal, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      parser.off('drain', onDrain)
      parser.off('close', onClose)
      parser.off('error', onError)
    }
    const onDrain = () => { cleanup(); resolve() }
    const onClose = () => { cleanup(); reject(new Error(`${label} closed while waiting for writable capacity.`)) }
    const onError = (value: unknown) => { cleanup(); reject(toError(value)) }
    const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }

    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    parser.once('drain', onDrain)
    parser.once('close', onClose)
    parser.once('error', onError)
  })
}

/** Converts the supplied value to error without changing semantic identity. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
