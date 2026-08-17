/** Structural RDF/XML parser contracts used to hide the external stream implementation. @module */

import type { TransformParserType } from '../transform.ts'

/** RDF/XML parser stream shape required by the adapter. */
export type ParserType = TransformParserType

/** Constructor contract for an RDF/XML parser implementation. */
export interface ParserConstructorType {
  new (options: Readonly<Record<string, unknown>>): ParserType
}
