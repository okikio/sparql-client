/** Incremental RDF source and sink contracts. @module */

import type { Quad } from './term.ts'

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

/** Converts sync or async quad input into one async iteration contract. */
export async function* iterate(source: Iterable<Quad> | AsyncIterable<Quad>): AsyncGenerator<Quad> {
  if (Symbol.asyncIterator in Object(source)) {
    for await (const quad of source as AsyncIterable<Quad>) yield quad
    return
  }
  for (const quad of source as Iterable<Quad>) yield quad
}
