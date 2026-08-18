/**
 * Dependency-free RDF programming model and native syntax capabilities for TypeScript runtimes.
 *
 * The root keeps the core term, dataset, namespace, and source contracts light.
 * Concrete syntaxes live on explicit subpaths so importing `@okikio/rdf` does
 * not initialize parser-specific state.
 *
 * @example
 * ```ts
 * import * as rdf from '@okikio/rdf'
 *
 * const subject = rdf.namedNode('https://example.com/product/1')
 * const predicate = rdf.namedNode('https://schema.org/name')
 * const graph = rdf.dataset([
 *   rdf.quad(subject, predicate, rdf.literal('Widget')),
 * ])
 * ```
 *
 * @module
 */

export { Dataset, dataset, datasetEquals, datasetKey } from './dataset.ts'
export type { MatchOptionsType } from './dataset.ts'
export {
  blankNode,
  defaultGraph,
  factory,
  fromQuad,
  fromTerm,
  literal,
  namedNode,
  quad,
  triple,
  variable,
} from './factory.ts'
export { namespace } from './namespace.ts'
export type { Namespace } from './namespace.ts'
export { equals, isTerm, key, RDF, XSD } from './term.ts'
export type {
  BlankNode,
  DefaultGraph,
  DirectionalLanguageType,
  DirectionType,
  GraphTermType,
  Literal,
  NamedNode,
  ObjectTermType,
  PredicateTermType,
  Quad,
  SubjectTermType,
  Term,
  TermType,
  Variable,
} from './term.ts'
export { iterate } from './source.ts'
export type { AsyncSource, Sink, Source } from './source.ts'
