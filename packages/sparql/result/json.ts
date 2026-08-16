/** SPARQL 1.1/1.2 Query Results JSON decoding. @module */

import { blankNode, literal, namedNode, quad, type ObjectTerm, type Predicate, type Subject, type TermType } from '@okikio/rdf'
import type { BindingType } from './binding.ts'

/** Raw SPARQL JSON term, including SPARQL 1.2 triple terms and text direction. */
export type JsonTermType =
  | { readonly type: 'uri'; readonly value: string }
  | { readonly type: 'bnode'; readonly value: string }
  | {
      readonly type: 'literal'
      readonly value: string
      readonly datatype?: string
      readonly 'xml:lang'?: string
      readonly 'its:dir'?: 'ltr' | 'rtl'
    }
  | {
      readonly type: 'triple'
      readonly value: {
        readonly subject: JsonTermType
        readonly predicate: JsonTermType
        readonly object: JsonTermType
      }
    }

/** Raw SELECT results object. */
export interface JsonBindingsType {
  readonly head: {
    readonly vars: readonly string[]
    readonly version?: string
    readonly link?: readonly string[]
  }
  readonly results: {
    readonly bindings: readonly Readonly<Record<string, JsonTermType>>[]
  }
}

/** Raw ASK results object. */
export interface JsonBooleanType {
  readonly head?: { readonly version?: string; readonly link?: readonly string[] }
  readonly boolean: boolean
}

/** Decodes one SPARQL JSON RDF term without JavaScript datatype coercion. */
export function readTerm(value: JsonTermType): TermType {
  switch (value.type) {
    case 'uri':
      return namedNode(value.value)
    case 'bnode':
      return blankNode(value.value)
    case 'literal': {
      const language = value['xml:lang']
      const direction = value['its:dir']
      if (language) return literal(value.value, direction ? { language, direction } : language)
      return literal(value.value, value.datatype ? namedNode(value.datatype) : undefined)
    }
    case 'triple': {
      const subject = readTerm(value.value.subject)
      const predicate = readTerm(value.value.predicate)
      const object = readTerm(value.value.object)
      if (subject.termType !== 'NamedNode' && subject.termType !== 'BlankNode') {
        throw new TypeError(`SPARQL JSON triple subject cannot be ${subject.termType}.`)
      }
      if (predicate.termType !== 'NamedNode') {
        throw new TypeError(`SPARQL JSON triple predicate cannot be ${predicate.termType}.`)
      }
      if (!isObjectTerm(object)) throw new TypeError(`SPARQL JSON triple object cannot be ${object.termType}.`)
      return quad(subject as Subject, predicate as Predicate, object)
    }
  }
}

/** Decodes a complete SELECT result into immutable-by-contract Maps. */
export function readBindings(value: unknown): readonly BindingType[] {
  if (!isBindingsResult(value)) throw new TypeError('Response is not a SPARQL bindings JSON result.')
  return value.results.bindings.map((row) => {
    const binding = new Map<string, TermType>()
    for (const [name, term] of Object.entries(row)) binding.set(name, readTerm(term))
    return binding
  })
}

/** Decodes an ASK result. */
export function readBoolean(value: unknown): boolean {
  if (!isBooleanResult(value)) throw new TypeError('Response is not a SPARQL boolean JSON result.')
  return value.boolean
}

/** Returns whether the supplied value satisfies the bindings result contract. */
function isBindingsResult(value: unknown): value is JsonBindingsType {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.head !== 'object' || record.head === null) return false
  if (typeof record.results !== 'object' || record.results === null) return false
  return Array.isArray((record.head as Record<string, unknown>).vars) &&
    Array.isArray((record.results as Record<string, unknown>).bindings)
}

/** Returns whether the supplied value satisfies the boolean result contract. */
function isBooleanResult(value: unknown): value is JsonBooleanType {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).boolean === 'boolean'
}

/** Returns whether the supplied value satisfies the object term contract. */
function isObjectTerm(term: TermType): term is ObjectTerm {
  return term.termType === 'NamedNode' || term.termType === 'BlankNode' || term.termType === 'Literal' || term.termType === 'Quad'
}
