/** Structural RDFa parser contracts used to isolate the external implementation. @module */

import type { TransformParserType } from '../transform.ts'

/** RDFa parser stream shape required by the adapter. */
export type ParserType = TransformParserType

/** Constructor contract for an RDFa parser implementation. */
export interface ParserConstructorType {
  new (options: Readonly<Record<string, unknown>>): ParserType
}
