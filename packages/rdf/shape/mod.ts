/**
 * SHACL shape and property-path infrastructure.
 *
 * This subpath reads shapes graphs into a loss-preserving, versioned IR. It is
 * intentionally separate from ontology interpretation and does not claim full
 * SHACL validation. SHACL 1.2 extension specifications can add evaluators over
 * the retained RDF term records without changing the Core model.
 *
 * @example
 * ```ts
 * import * as turtle from '@okikio/rdf/turtle'
 * import * as shape from '@okikio/rdf/shape'
 *
 * const graph = await shape.read(turtle.parse(source), { version: '1.2' })
 * const person = graph.shapes.find((value) => value.id.value.endsWith('PersonShape'))
 * ```
 *
 * @module
 */

export { read } from './read.ts'
export type { ReadOptions } from './read.ts'
export { readPath } from './path.ts'
export type { PathOptions } from './path.ts'
export type {
  AssertionType,
  BlankType,
  ConstraintType,
  DiagnosticType,
  GraphType,
  IdType,
  IriType,
  LiteralType,
  MetadataType,
  PathType,
  ShapeType,
  TargetType,
  TermType,
  TextType,
  TripleType,
  VersionType,
} from './model.ts'
