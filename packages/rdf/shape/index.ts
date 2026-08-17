/** Indexed view over one materialized SHACL shapes graph. @module */

import { key } from '../term.ts'
import type { ObjectTerm, Quad, Subject, Term } from '../term.ts'

/** Subject/predicate index used by the SHACL reader and property-path parser. */
export class ShapeIndex {
  readonly #subjects = new Map<string, Subject>()
  readonly #values = new Map<string, Map<string, ObjectTerm[]>>()
  readonly #quads = new Map<string, Quad[]>()

  /** Adds one quad to the index. */
  add(quad: Quad): void {
    const subjectKey = key(quad.subject)
    this.#subjects.set(subjectKey, quad.subject)

    let predicates = this.#values.get(subjectKey)
    if (!predicates) {
      predicates = new Map()
      this.#values.set(subjectKey, predicates)
    }
    let values = predicates.get(quad.predicate.value)
    if (!values) {
      values = []
      predicates.set(quad.predicate.value, values)
    }
    values.push(quad.object)

    let quads = this.#quads.get(subjectKey)
    if (!quads) {
      quads = []
      this.#quads.set(subjectKey, quads)
    }
    quads.push(quad)
  }

  /** Returns each indexed subject. */
  subjects(): Iterable<Subject> {
    return this.#subjects.values()
  }

  /** Returns predicate values for one RDF subject. */
  get(subject: Subject, predicate: string): readonly ObjectTerm[] {
    return this.#values.get(key(subject))?.get(predicate) ?? []
  }

  /** Returns all quads for one RDF subject. */
  quads(subject: Subject): readonly Quad[] {
    return this.#quads.get(key(subject)) ?? []
  }

  /** Returns whether a node is an RDF list cell. */
  isList(term: Term): boolean {
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') return false
    const subject = term as Subject
    return this.get(subject, RDF_FIRST).length > 0 || this.get(subject, RDF_REST).length > 0
  }
}

/** RDF collection predicate that points at the current list member. */
export const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
/** RDF collection predicate that points at the remaining list cell. */
export const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
/** RDF collection terminator used by list and SHACL-path traversal. */
export const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
