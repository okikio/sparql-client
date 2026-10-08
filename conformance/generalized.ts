/** Localized generalized RDF oracle for JSON-LD blank-predicate fixtures. @module */
import { blankNode, literal, namedNode, type Quad, quad, type TermType } from '@okikio/rdf'
import { parse } from '@okikio/rdf/nquads'
import type { GeneralizedQuadType } from '@okikio/rdf/jsonld'
import { isomorphic } from './equal.ts'

/** Reads blank predicates without changing the standard N-Quads parser contract. */
export async function readGeneralized(source: string): Promise<GeneralizedQuadType[]> {
  let namespace = 'urn:jsonld-conformance:predicate:'
  while (source.includes(namespace)) namespace += 'x:'
  const predicates = new Map<string, string>()
  const adapted = source.replace(
    /^(\s*(?:<[^>]*>|_:\S+)\s+)_:(\S+)(?=\s)/gmu,
    (_match, prefix: string, label: string) => {
      const id = `${namespace}${predicates.size}`
      predicates.set(id, label)
      return `${prefix}<${id}>`
    },
  )
  const output: GeneralizedQuadType[] = []
  for await (const statement of parse(adapted)) {
    const label = predicates.get(statement.predicate.value)
    output.push(
      label === undefined ? statement : {
        ...statement,
        predicate: blankNode(label),
        equals(other) {
          return other === this
        },
      },
    )
  }
  return output
}

/** Compares generalized datasets through an injective statement reification. */
export function isomorphicGeneralized(
  actual: readonly GeneralizedQuadType[],
  expected: readonly GeneralizedQuadType[],
): boolean {
  return isomorphic(reify(actual), reify(expected))
}

/** Encodes every generalized term position into standard RDF object positions. */
function reify(statements: readonly GeneralizedQuadType[]): Quad[] {
  const unique = new Map(statements.map((statement) => [
    JSON.stringify([
      termKey(statement.subject),
      termKey(statement.predicate),
      termKey(statement.object),
      termKey(statement.graph),
    ]),
    statement,
  ]))
  const blanks = new Set<string>()
  for (const value of unique.values()) {
    for (const term of [value.subject, value.predicate, value.object, value.graph]) {
      if (term.termType === 'BlankNode') blanks.add(term.value)
    }
  }
  const output: Quad[] = []
  let index = 0
  for (const statement of unique.values()) {
    let label: string
    do label = `jsonld-oracle-${index++}`
    while (blanks.has(label))
    const subject = blankNode(label)
    output.push(quad(subject, namedNode('urn:jsonld-oracle:subject'), statement.subject))
    output.push(quad(subject, namedNode('urn:jsonld-oracle:predicate'), statement.predicate))
    output.push(quad(subject, namedNode('urn:jsonld-oracle:object'), statement.object))
    output.push(
      quad(
        subject,
        namedNode('urn:jsonld-oracle:graph'),
        statement.graph.termType === 'DefaultGraph'
          ? literal('', namedNode('urn:jsonld-oracle:default'))
          : statement.graph,
      ),
    )
  }
  return output
}

/** Preserves term kind, lexical value, literal metadata, and nested triple identity. */
function termKey(term: TermType): unknown {
  if (term.termType === 'Literal') {
    return [term.termType, term.value, term.language, term.direction, term.datatype.value]
  }
  if (term.termType === 'Quad') {
    return [
      term.termType,
      termKey(term.subject),
      termKey(term.predicate),
      termKey(term.object),
      termKey(term.graph),
    ]
  }
  return [term.termType, term.value]
}
