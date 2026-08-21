/** Shared RDF 1.2 N-Triples/N-Quads term serialization. @module */

import type { Literal, Quad, Term } from './term.ts'
import { XSD } from './term.ts'

/** Serializes one quad in line RDF syntax. */
export function writeQuad(quad: Quad, includeGraph: boolean): string {
  const values = [writeTerm(quad.subject), writeTerm(quad.predicate), writeTerm(quad.object)]
  if (includeGraph && quad.graph.termType !== 'DefaultGraph') values.push(writeTerm(quad.graph))
  return `${values.join(' ')} .`
}

/** Serializes one RDF term in RDF 1.2 line syntax. */
export function writeTerm(term: Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${escapeIri(term.value)}>`
    case 'BlankNode':
      return `_:${term.value}`
    case 'DefaultGraph':
      return ''
    case 'Variable':
      return `?${term.value}`
    case 'Literal':
      return writeLiteral(term as Literal)
    case 'Quad': {
      const quad = term as Quad
      if (quad.graph.termType !== 'DefaultGraph') {
        throw new TypeError('Embedded RDF triple term must use the default graph.')
      }
      return `<<( ${writeTerm(quad.subject)} ${writeTerm(quad.predicate)} ${
        writeTerm(quad.object)
      } )>>`
    }
  }
}

/** Write literal deterministically to the caller-owned output. */
function writeLiteral(literal: Literal): string {
  const lexical = `"${escapeString(literal.value)}"`
  if (literal.language) {
    return `${lexical}@${literal.language}${literal.direction ? `--${literal.direction}` : ''}`
  }
  if (literal.datatype.value === XSD.string) return lexical
  return `${lexical}^^${writeTerm(literal.datatype)}`
}

/**
 * Escapes RDF line-syntax string literals in canonical-safe form.
 *
 * Canonical N-Triples/N-Quads uses the short `ECHAR` forms for backspace,
 * tab, newline, form feed, carriage return, quote, and backslash. Other C0
 * controls and U+007F use uppercase `\uXXXX`. U+0080 through U+009F stay
 * as native Unicode because the canonical grammar does not require escaping
 * them.
 */
function escapeString(value: string): string {
  let output = ''
  for (const char of value) {
    const point = char.codePointAt(0)!
    switch (char) {
      case '\\': output += '\\\\'; break
      case '"': output += '\"'; break
      case '\b': output += '\\b'; break
      case '\t': output += '\\t'; break
      case '\n': output += '\\n'; break
      case '\f': output += '\\f'; break
      case '\r': output += '\\r'; break
      default:
        output += point <= 0x1f || point === 0x7f
          ? `\\u${point.toString(16).padStart(4, '0').toUpperCase()}`
          : char
    }
  }
  return output
}

/** Escapes characters forbidden directly inside N-Triples/N-Quads IRI references. */
function escapeIri(value: string): string {
  let output = ''
  for (const char of value) {
    const point = char.codePointAt(0)!
    if (point <= 0x20 || '<>\"{}|^`\\'.includes(char)) {
      output += point <= 0xffff
        ? `\\u${point.toString(16).padStart(4, '0').toUpperCase()}`
        : `\\U${point.toString(16).padStart(8, '0').toUpperCase()}`
    } else output += char
  }
  return output
}
