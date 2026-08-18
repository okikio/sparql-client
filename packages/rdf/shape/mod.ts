/**
 * SHACL shape and property-path infrastructure.
 *
 * This subpath inspects shapes graphs into a loss-preserving, versioned IR. It is
 * intentionally separate from ontology interpretation and does not claim full
 * SHACL validation. SHACL 1.2 extension specifications can add evaluators over
 * the retained RDF term records without changing the Core model.
 *
 * @example
 * ```ts
 * import * as turtle from '@okikio/rdf/turtle'
 * import * as shape from '@okikio/rdf/shape'
 *
 * const graph = await shape.inspect(turtle.parse(source), { version: '1.2' })
 * const person = graph.shapes.find((value) => value.id.value.endsWith('PersonShape'))
 * ```
 *
 * @module
 */

export { inspect } from './inspect.ts'
export type { InspectOptionsType } from './inspect.ts'
export { getPath } from './path.ts'
export type { PathOptionsType } from './path.ts'
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
