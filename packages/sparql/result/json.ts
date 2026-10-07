/** SPARQL 1.1/1.2 Query Results JSON decoding. @module */

import {
  type BlankNode,
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
  /** SELECT variables and optional protocol metadata supplied by the endpoint. */
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
  /** Optional protocol metadata supplied with an ASK result. */
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
export function decodeTerm(value: unknown): TermType {
  return term(value, 0)
}

/** Validates each hostile JSON term before recursive conversion; depth bounds nested triple work. */
function term(input: unknown, depth: number, blanks?: Map<string, BlankNode>): TermType {
  if (depth > 128) throw new TypeError('SPARQL JSON triple nesting exceeds 128 levels.')
  if (!record(input)) throw new TypeError('SPARQL JSON term must be an object.')
  const value = input
  if (value.type !== 'triple' && typeof value.value !== 'string') {
    throw new TypeError('SPARQL JSON term value must be a string.')
  }
  switch (value.type) {
    case 'uri':
      return namedNode(value.value as string)
    case 'bnode': {
      const label = value.value as string
      if (!blanks) return blankNode(label)
      let node = blanks.get(label)
      if (!node) {
        node = blankNode()
        blanks.set(label, node)
      }
      return node
    }
    case 'literal': {
      const language = value['xml:lang']
      const direction = value['its:dir']
      const datatype = value.datatype
      if (language !== undefined && (typeof language !== 'string' || language.length === 0)) {
        throw new TypeError('SPARQL JSON literal language must be a nonempty string.')
      }
      if (direction !== undefined && (direction !== 'ltr' && direction !== 'rtl')) {
        throw new TypeError('SPARQL JSON literal direction must be ltr or rtl.')
      }
      if (direction !== undefined && language === undefined) {
        throw new TypeError('SPARQL JSON literal direction requires a language.')
      }
      if (datatype !== undefined && typeof datatype !== 'string') {
        throw new TypeError('SPARQL JSON literal datatype must be an IRI string.')
      }
      if (language !== undefined) {
        return literal(value.value as string, direction ? { language, direction } : language)
      }
      return literal(value.value as string, datatype ? namedNode(datatype) : undefined)
    }
    case 'triple': {
      if (!record(value.value)) throw new TypeError('SPARQL JSON triple value must be an object.')
      const subject = term(value.value.subject, depth + 1, blanks)
      const predicate = term(value.value.predicate, depth + 1, blanks)
      const object = term(value.value.object, depth + 1, blanks)
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
    default:
      throw new TypeError(`Unknown SPARQL JSON term type '${String(value.type)}'.`)
  }
}

/** Decodes a complete SELECT result into immutable-by-contract Maps. */
export function decodeBindings(value: unknown): readonly BindingType[] {
  if (!isBindingsResult(value)) {
    throw new TypeError('Response is not a SPARQL bindings JSON result.')
  }
  // SPARQL result labels have authority only within this one results object.
  const blanks = new Map<string, BlankNode>()
  const variables = new Set(value.head.vars)
  if (variables.size !== value.head.vars.length) {
    throw new TypeError('Duplicate SPARQL result variable.')
  }
  return value.results.bindings.map((row) => {
    if (!record(row)) throw new TypeError('SPARQL bindings row must be an object.')
    const binding = new Map<string, TermType>()
    for (const [name, input] of Object.entries(row)) {
      if (!variables.has(name)) throw new TypeError(`Undeclared SPARQL result variable '${name}'.`)
      binding.set(name, term(input, 0, blanks))
    }
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
    ((record.head as Record<string, unknown>).vars as unknown[]).every((name) =>
      typeof name === 'string'
    ) &&
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

/** Recognizes plain JSON objects without accepting arrays as records. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
