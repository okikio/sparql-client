/** RDF 1.2 TriG parser and conservative streaming-friendly serializer. @module */

import { type CompactEventType, type CompactOptionsType, parseCompact } from '../compact.ts'
import type { TextSourceType } from '../text.ts'
import type { Quad } from '../term.ts'
import { writeQuad, writeTerm } from '../write.ts'

export type {
  CompactDiagnosticType as DiagnosticType,
  CompactEventType as ParseEventType,
  CompactOptionsType as ParseOptionsType,
  CompactRangeType as SourceRangeType,
} from '../compact.ts'
export type { TextSourceType } from '../text.ts'

/** Emits TriG directives, semantic quads, and optional tolerant diagnostics. */
export function events(
  source: TextSourceType,
  options: CompactOptionsType = {},
): AsyncGenerator<CompactEventType> {
  return parseCompact(source, options, true)
}

/** Parses TriG incrementally and emits semantic RDF dataset quads. */
export async function* parse(
  source: TextSourceType,
  options: CompactOptionsType = {},
): AsyncGenerator<Quad> {
  for await (const event of events(source, options)) {
    if (event.kind === 'quad') yield event.quad
  }
}

/**
 * Serializes a dataset as valid TriG without grouping named graphs in memory.
 *
 * Repeated graph blocks are legal TriG and let the serializer retain an O(1)
 * working set for an arbitrary input iteration order.
 */
export function serialize(source: Iterable<Quad>, options: {
  /** Version marker retained by this syntax record. */
  readonly version?: boolean
} = {}): string {
  const lines: string[] = []
  if (options.version) lines.push('VERSION "1.2"')
  for (const value of source) {
    if (value.graph.termType === 'DefaultGraph') lines.push(writeQuad(value, false))
    else lines.push(`${writeTerm(value.graph)} { ${writeQuad(value, false)} }`)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
