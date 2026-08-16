/**
 * Incremental SPARQL syntax inspection.
 *
 * This subpath exposes a source-ranged token and event stream. It deliberately
 * does not claim to be a complete query AST: SPARQL 1.2 is still evolving, and
 * callers such as formatters, diagnostics, editors, and future grammar parsers
 * can consume the stable lexical/event layer without forcing tree materialization.
 *
 * @example Inspect version-sensitive syntax
 * ```ts
 * import * as syntax from '@okikio/sparql/syntax'
 *
 * const result = await syntax.inspect(`
 *   VERSION "1.2"
 *   SELECT ?s WHERE { BIND( <<( ?s :p :o )>> AS ?triple ) }
 * `)
 *
 * console.log(result.version) // "1.2"
 * console.log(result.features[0]?.feature) // "triple-term"
 * ```
 *
 * @module
 */

export { events, inspect, SyntaxScanError, tokens } from './scan.ts'
export type {
  DiagnosticType,
  DocumentType,
  EventType,
  FeatureEventType,
  FeatureType,
  OptionsType,
  RangeType,
  SeverityType,
  SourceType,
  TokenKindType,
  TokenType,
  VersionEventType,
  VersionType,
} from './types.ts'
