/** Incremental RDF source and sink contracts. @module */

import type { Quad } from './term.ts'
import { consume } from './iteration.ts'

/** Synchronous RDF quad source. */
export interface Source extends Iterable<Quad> {}

/** Asynchronous RDF quad source. */
export interface AsyncSource extends AsyncIterable<Quad> {}

/** A sink that consumes an RDF quad sequence without taking source ownership. */
export interface Sink<Result = void> {
  /** Consumes quads from the supplied source and returns the sink-specific terminal result. */
  import(source: Iterable<Quad> | AsyncIterable<Quad>, options?: {
    /** Abort signal checked before and during this operation. */
    readonly signal?: AbortSignal
  }): Promise<Result>
}

/**
 * Converts quad input into one incremental, cancellable iteration contract.
 *
 * Abort also rejects a pending `next()` call. Early return, input failure and
 * abort call the source iterator's `return()` once. Abort does not wait for uncooperative cleanup. Normal early return awaits
 * cleanup unless onCleanup separates it from the terminal result. This cannot
 * interrupt arbitrary synchronous JavaScript.
 * The iterator is scoped to this consumption, while its owning resource remains
 * borrowed. A cleanup failure retains an earlier failure as its cause.
 */
export async function* iterate(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: {
    /** Cancellation for pending reads and the next admitted quad. */ readonly signal?: AbortSignal
    /** Observes iterator cleanup separately from the terminal result. With this option early return does not wait for borrowed cleanup. */
    readonly onCleanup?: (cleanup: Promise<void>) => void
  } = {},
): AsyncGenerator<Quad> {
  yield* consume(source, options.signal, options.onCleanup)
}
