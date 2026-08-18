/** RDF 1.2 Turtle parser and conservative serializer. @module */

import { type CompactEventType, type CompactOptionsType, parseCompact } from '../compact.ts'
import type { TextSourceType } from '../text.ts'
import type { Quad } from '../term.ts'
import { writeQuad } from '../write.ts'

export type {
  CompactDiagnosticType as DiagnosticType,
  CompactEventType as ParseEventType,
  CompactOptionsType as ParseOptionsType,
  CompactRangeType as SourceRangeType,
} from '../compact.ts'
export type { TextSourceType } from '../text.ts'

/** Emits Turtle directives, semantic quads, and optional tolerant diagnostics. */
export function events(
  source: TextSourceType,
  options: CompactOptionsType = {},
): AsyncGenerator<CompactEventType> {
  return parseCompact(source, options, false)
}

/** Parses Turtle incrementally and emits semantic RDF quads. */
export async function* parse(
  source: TextSourceType,
  options: CompactOptionsType = {},
): AsyncGenerator<Quad> {
  for await (const event of events(source, options)) {
    if (event.kind === 'quad') yield event.quad
  }
}

/**
 * Serializes an RDF graph using the explicit-IRI subset of Turtle.
 *
 * This intentionally optimizes for deterministic correctness rather than pretty
 * prefix compaction. Named-graph quads are rejected because Turtle represents a
 * graph, while TriG represents a dataset.
 */
export function serialize(source: Iterable<Quad>, options: {
  /** Version marker retained by this syntax record. */
  readonly version?: boolean
} = {}): string {
  const lines: string[] = []
  if (options.version) lines.push('VERSION "1.2"')
  for (const value of source) {
    if (value.graph.termType !== 'DefaultGraph') {
      throw new TypeError('Turtle serialization cannot contain named-graph quads.')
    }
    lines.push(writeQuad(value, false))
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
