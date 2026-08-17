/** RDF 1.2 TriG parser and conservative streaming-friendly serializer. @module */

import { parseCompact, type CompactEvent, type CompactOptions } from '../compact.ts'
import type { TextSource } from '../text.ts'
import type { Quad } from '../term.ts'
import { writeQuad, writeTerm } from '../write.ts'

export type { CompactDiagnostic as Diagnostic, CompactEvent as ParseEvent, CompactOptions as ParseOptions, CompactRange as SourceRange } from '../compact.ts'
export type { TextSource } from '../text.ts'

/** Emits TriG directives, semantic quads, and optional tolerant diagnostics. */
export function events(source: TextSource, options: CompactOptions = {}): AsyncGenerator<CompactEvent> {
  return parseCompact(source, options, true)
}

/** Parses TriG incrementally and emits semantic RDF dataset quads. */
export async function* parse(source: TextSource, options: CompactOptions = {}): AsyncGenerator<Quad> {
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
export function serialize(source: Iterable<Quad>, options: { readonly version?: boolean } = {}): string {
  const lines: string[] = []
  if (options.version) lines.push('VERSION "1.2"')
  for (const value of source) {
    if (value.graph.termType === 'DefaultGraph') lines.push(writeQuad(value, false))
    else lines.push(`${writeTerm(value.graph)} { ${writeQuad(value, false)} }`)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
