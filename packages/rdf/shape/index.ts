/** Indexed view over one materialized SHACL shapes graph. @module */

import { key } from '../term.ts'
import type { ObjectTermType, Quad, SubjectTermType, Term } from '../term.ts'

/**
 * Mutable, caller-owned index for one materialized SHACL shapes graph.
 *
 * Add a bounded collection of quads before calling `getPath`. The index retains
 * the supplied term and quad objects; it does not consume a source, copy terms,
 * acquire resources, or require disposal. Do not mutate supplied RDF objects or
 * the readonly lookup results. Further `add` calls affect subsequent lookups.
 * Duplicate additions remain duplicate statements, so add each quad once.
 *
 * Lookups combine all supplied graph names by subject and predicate. Graph
 * names remain on returned quads, but do not partition the index. Select the
 * intended shapes graph, or intentional union, before adding statements.
 *
 * Construction has no implicit quad cap. Bound ingestion yourself, or use
 * `inspect` for bounded whole-graph inspection. `getPath` bounds only list and
 * recursive traversal of the already-materialized index. This index performs
 * no SHACL validation, entailment, or path evaluation against a data graph.
 */
export class ShapeIndex {
  /** SHACL index of materialized subject terms discovered in the shapes graph. */
  readonly #subjects = new Map<string, SubjectTermType>()
  /** SHACL predicate/value index used for repeated direct lookups during shape inspection. */
  readonly #values = new Map<string, Map<string, ObjectTermType[]>>()
  /** Primary semantic-key map containing the quads currently owned by this dataset. */
  readonly #quads = new Map<string, Quad[]>()

  /** Retains one quad in the caller-owned index, including repeated additions. */
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
  subjects(): Iterable<SubjectTermType> {
    return this.#subjects.values()
  }

  /** Returns predicate values for one RDF subject. */
  get(subject: SubjectTermType, predicate: string): readonly ObjectTermType[] {
    return this.#values.get(key(subject))?.get(predicate) ?? []
  }

  /** Returns all quads for one RDF subject. */
  quads(subject: SubjectTermType): readonly Quad[] {
    return this.#quads.get(key(subject)) ?? []
  }

  /** Returns whether a node is an RDF list cell. */
  isList(term: Term): boolean {
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') return false
    const subject = term as SubjectTermType
    return this.get(subject, RDF_FIRST).length > 0 || this.get(subject, RDF_REST).length > 0
  }
}

/** RDF collection predicate that points at the current list member. */
export const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
/** RDF collection predicate that points at the remaining list cell. */
export const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
/** RDF collection terminator used by list and SHACL-path traversal. */
export const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
