/** RDF 1.2 N-Triples parser and serializer. @module */

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

/** Emits source-ranged semantic events. Tolerant mode reports malformed lines and continues. */
export async function* analyze(
  source: TextSourceType,
  options: ParseOptionsType = {},
): AsyncGenerator<ParseEventType> {
  for await (const record of lines(source, options)) {
    try {
      const event = parseLine(record, false, options)
      if (event) yield event
    } catch (error) {
      if (!options.tolerant) throw error
      yield { kind: 'diagnostic', diagnostic: diagnostic(error, record) }
    }
  }
}

/** Parses N-Triples incrementally and yields RDF quads in the default graph. */
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

/** Serializes RDF triples using canonical-layout-compatible line formatting. */
export function write(quads: Iterable<Quad>): string {
  const lines: string[] = []
  for (const quad of quads) {
    if (quad.graph.termType !== 'DefaultGraph') {
      throw new TypeError('N-Triples cannot serialize named graphs.')
    }
    lines.push(writeQuad(quad, false))
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

export type {
  DiagnosticType,
  ParseEventType,
  ParseOptionsType,
  SourceRangeType,
  TextSourceType,
} from '../line.ts'
