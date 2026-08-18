/** Streaming adapter primitives shared by external RDF parser packages. @module */

import { fromQuad } from './factory.ts'
import type { Quad } from './term.ts'
import { chunks, type TextSourceType, throwIfAborted } from './text.ts'

export type { TextSourceType } from './text.ts'

/**
 * Minimal writable async parser used by external streaming RDF adapters.
 *
 * The interface models only the operations required to connect a Node-style
 * parser to the repository's Web-oriented source contract. Implementations
 * remain owned by the adapter operation that creates them.
 */
export interface Parser extends AsyncIterable<Quad> {
  /** Writes one text or byte chunk and reports whether more input can be accepted immediately. */
  write(chunk: string | Uint8Array): boolean
  /** Signals that no more source chunks will arrive. */
  end(): void
  /** Adds a one-shot lifecycle listener used for backpressure and failure propagation. */
  once(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): this
  /** Removes a lifecycle listener after the wait settles or cancellation wins. */
  off(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): this
  /** Releases parser resources and optionally forwards the terminal source failure. */
  destroy(error?: Error): void
}

/** Controls one external parser stream adaptation. */
export interface ParseOptionsType {
  /** Human-readable parser name included in lifecycle errors. */
  readonly label: string
  /** Caller-owned cancellation signal. Cancellation destroys unfinished parser work. */
  readonly signal?: AbortSignal
}

/**
 * Adapts an external writable parser to the repository's async RDF stream.
 *
 * The parser is owned by this operation. The input source is borrowed.
 * Returning from iteration early cancels the source pump and destroys the
 * parser so upstream network, file, or Web Stream work cannot outlive its
 * consumer.
 *
 * @example
 * ```ts
 * import * as stream from '@okikio/rdf/stream'
 *
 * for await (const quad of stream.parse(parser, source, { label: 'RDF/XML' })) {
 *   console.log(quad)
 * }
 * ```
 */
export async function* parse(
  parser: Parser,
  source: TextSourceType,
  options: ParseOptionsType,
): AsyncGenerator<Quad> {
  throwIfAborted(options.signal)
  const lifecycle = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, lifecycle.signal])
    : lifecycle.signal
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
      lifecycle.abort(
        new DOMException(
          `${options.label} consumer stopped before source completion`,
          'AbortError',
        ),
      )
      parser.destroy()
    }
    await pumping.catch(() => undefined)
  }
}

/** Feeds source chunks into one parser while preserving writable backpressure. */
async function pump(
  parser: Parser,
  source: TextSourceType,
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

/** Waits for parser write capacity while cancellation and parser failure remain observable. */
function drain(parser: Parser, signal: AbortSignal, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    /** Removes every listener installed by this single backpressure wait. */
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      parser.off('drain', onDrain)
      parser.off('close', onClose)
      parser.off('error', onError)
    }
    /** Completes the wait when the parser can accept another source chunk. */
    const onDrain = () => {
      cleanup()
      resolve()
    }
    /** Fails the wait when the parser closes before writable capacity returns. */
    const onClose = () => {
      cleanup()
      reject(new Error(`${label} closed while waiting for writable capacity.`))
    }
    /** Preserves the parser failure as the terminal backpressure error. */
    const onError = (value: unknown) => {
      cleanup()
      reject(toError(value))
    }
    /** Stops the wait when the caller or enclosing parser lifecycle is cancelled. */
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    parser.once('drain', onDrain)
    parser.once('close', onClose)
    parser.once('error', onError)
  })
}

/** Converts a non-Error thrown value without replacing an existing Error identity. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
