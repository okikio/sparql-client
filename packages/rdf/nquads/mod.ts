/** RDF 1.2 N-Quads parser and serializer. @module */

import {
  diagnostic,
  lines,
  type ParseEventType,
  parseLine,
  type ParseOptionsType,
  type TextSourceType,
} from '../line.ts'
import type { Quad } from '../term.ts'
import { writeQuad } from '../write.ts'

/** Emits source-ranged N-Quads semantic events. */
export async function* analyze(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<ParseEventType> {
  for await (const record of lines(source, options)) {
    try {
      const event = parseLine(record, true, options)
      if (event) yield event
    } catch (error) {
      if (!options.tolerant) throw error
      yield { kind: 'diagnostic', diagnostic: diagnostic(error, record) }
    }
  }
}

/** Parses N-Quads incrementally. */
export async function* parse(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<Quad> {
  for await (const event of analyze(source, options)) {
    if (event.kind === 'quad') {
      yield event.quad
    }
  }
}

/** Serializes RDF quads using canonical-layout-compatible line formatting. */
export function write(quads: Iterable<Quad>): string {
  const output = [...quads].map((quad) => writeQuad(quad, true))
  return output.length === 0 ? '' : `${output.join('\n')}\n`
}

export type {
  DiagnosticType,
  ParseEventType,
  ParseOptionsType,
  SourceRangeType,
  TextSourceType,
} from '../line.ts'
