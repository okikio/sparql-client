/** SPARQL 1.1/1.2 Query Results JSON decoding. @module */

import {
  blankNode,
  literal,
  namedNode,
  type ObjectTermType,
  type PredicateTermType,
  quad,
  type SubjectTermType,
  type TermType,
} from '@okikio/rdf'
import type { BindingType } from './binding.ts'

/** Raw SPARQL JSON term, including SPARQL 1.2 triple terms and text direction. */
export type JsonTermType =
  | {
    /** SPARQL Results JSON term discriminator. */
    readonly type: 'uri'
    /** Lexical RDF term value supplied by SPARQL Results JSON. */
    readonly value: string
  }
  | {
    /** SPARQL Results JSON term discriminator. */
    readonly type: 'bnode'
    /** Lexical RDF term value supplied by SPARQL Results JSON. */
    readonly value: string
  }
  | {
    /** SPARQL Results JSON term discriminator. */
    readonly type: 'literal'
    /** Lexical RDF term value supplied by SPARQL Results JSON. */
    readonly value: string
    /** Datatype IRI associated with this RDF literal value. */
    readonly datatype?: string
    /** BCP 47 language tag supplied by SPARQL Results JSON. */
    readonly 'xml:lang'?: string
    /** RDF 1.2 base text direction supplied by SPARQL Results JSON. */
    readonly 'its:dir'?: 'ltr' | 'rtl'
  }
  | {
    /** SPARQL Results JSON term discriminator. */
    readonly type: 'triple'
    /** Lexical RDF term value supplied by SPARQL Results JSON. */
    readonly value: {
      /** RDF subject term represented by this statement or operation filter. */
      readonly subject: JsonTermType
      /** RDF predicate IRI represented by this statement or operation filter. */
      readonly predicate: JsonTermType
      /** RDF object term represented by this statement or operation filter. */
      readonly object: JsonTermType
    }
  }

/** Raw SELECT results object. */
export interface JsonBindingsType {
  /** Requests Graph Store metadata without downloading a graph response body. */
  readonly head: {
    /** Ordered SELECT variable names declared by the SPARQL Results JSON header. */
    readonly vars: readonly string[]
    /** Version marker retained by this syntax record. */
    readonly version?: string
    /** Hypermedia links reported by the SPARQL Results JSON header. */
    readonly link?: readonly string[]
  }
  /** SPARQL JSON bindings result rows. */
  readonly results: {
    /** Raw SPARQL Results JSON binding rows before RDF term decoding. */
    readonly bindings: readonly Readonly<Record<string, JsonTermType>>[]
  }
}

/** Raw ASK results object. */
export interface JsonBooleanType {
  /** Requests Graph Store metadata without downloading a graph response body. */
  readonly head?: {
    /** Version marker retained by this syntax record. */
    readonly version?: string
    /** Hypermedia links reported by the SPARQL Results JSON header. */
    readonly link?: readonly string[]
  }
  /** SPARQL ASK boolean result. */
  readonly boolean: boolean
}

/** Decodes one SPARQL JSON RDF term without JavaScript datatype coercion. */
export function decodeTerm(value: JsonTermType): TermType {
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
      const subject = decodeTerm(value.value.subject)
      const predicate = decodeTerm(value.value.predicate)
      const object = decodeTerm(value.value.object)
      if (subject.termType !== 'NamedNode' && subject.termType !== 'BlankNode') {
        throw new TypeError(`SPARQL JSON triple subject cannot be ${subject.termType}.`)
      }
      if (predicate.termType !== 'NamedNode') {
        throw new TypeError(`SPARQL JSON triple predicate cannot be ${predicate.termType}.`)
      }
      if (!isObjectTerm(object)) {
        throw new TypeError(`SPARQL JSON triple object cannot be ${object.termType}.`)
      }
      return quad(subject as SubjectTermType, predicate as PredicateTermType, object)
    }
  }
}

/** Decodes a complete SELECT result into immutable-by-contract Maps. */
export function decodeBindings(value: unknown): readonly BindingType[] {
  if (!isBindingsResult(value)) {
    throw new TypeError('Response is not a SPARQL bindings JSON result.')
  }
  return value.results.bindings.map((row) => {
    const binding = new Map<string, TermType>()
    for (const [name, term] of Object.entries(row)) binding.set(name, decodeTerm(term))
    return binding
  })
}

/** Decodes an ASK result. */
export function decodeBoolean(value: unknown): boolean {
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
  return typeof value === 'object' && value !== null &&
    typeof (value as Record<string, unknown>).boolean === 'boolean'
}

/** Returns whether the supplied value satisfies the object term contract. */
function isObjectTerm(term: TermType): term is ObjectTermType {
  return term.termType === 'NamedNode' || term.termType === 'BlankNode' ||
    term.termType === 'Literal' || term.termType === 'Quad'
}
