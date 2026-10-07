/** Independent collision-free RDF identity checks used only before benchmark timing. @module */

/** Reads RDF/JS-shaped values without importing a parser or dataset implementation. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) throw new Error('Expected an RDF term/quad.')
  return value as Readonly<Record<string, unknown>>
}

/** Encodes every RDF identity field, including language/datatype and nested RDF-star quads. */
function term(value: unknown): unknown[] {
  const item = record(value)
  if (typeof item.termType !== 'string' || typeof item.value !== 'string') {
    throw new Error('Malformed RDF term in benchmark oracle.')
  }
  if (item.termType === 'Literal') {
    return [
      'Literal',
      item.value,
      typeof item.language === 'string' ? item.language.toLowerCase() : '',
      item.direction ?? '',
      term(item.datatype),
    ]
  }
  if (item.termType === 'Quad') return ['Quad', ...quadTerms(item)]
  return [item.termType, item.value]
}

/** Keeps graph identity and tuple boundaries distinct even for whitespace/control-containing literals. */
function quadTerms(value: Readonly<Record<string, unknown>>): unknown[] {
  return [term(value.subject), term(value.predicate), term(value.object), term(value.graph)]
}

/** Compares the complete result multiset; sorting preserves multiplicity rather than hiding duplicates. */
export function expectQuads(
  actual: Iterable<unknown>,
  expected: Iterable<unknown>,
  lane: string,
): void {
  const keys = (values: Iterable<unknown>): string[] =>
    [...values].map((value) => JSON.stringify(quadTerms(record(value)))).sort()
  if (JSON.stringify(keys(actual)) !== JSON.stringify(keys(expected))) {
    throw new Error(`${lane}: exact RDF identity oracle differs.`)
  }
}
