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
 * To inspect a path directly, populate a caller-owned index with a bounded
 * shapes graph. This example reads the sequence `urn:name / ^urn:label`:
 *
 * @example
 * ```ts
 * import { blankNode, namedNode, quad, RDF } from '@okikio/rdf'
 * import type { DiagnosticType } from '@okikio/rdf/shape'
 * import { getPath, ShapeIndex } from '@okikio/rdf/shape'
 *
 * const head = blankNode()
 * const tail = blankNode()
 * const inverse = blankNode()
 * const index = new ShapeIndex()
 * for (const value of [
 *   quad(head, namedNode(RDF.first), namedNode('urn:name')),
 *   quad(head, namedNode(RDF.rest), tail),
 *   quad(tail, namedNode(RDF.first), inverse),
 *   quad(tail, namedNode(RDF.rest), namedNode(RDF.nil)),
 *   quad(inverse, namedNode('http://www.w3.org/ns/shacl#inversePath'), namedNode('urn:label')),
 * ]) index.add(value)
 *
 * const diagnostics: DiagnosticType[] = []
 * const path = getPath(index, head, { maxDepth: 4, maxListItems: 2, diagnostics })
 * console.log(path.kind) // sequence
 * console.log(diagnostics.length) // 0
 * ```
 *
 * The index combines statements from the graphs supplied by the caller. Select
 * one shapes graph or an intentional union before ingestion. Traversal bounds
 * do not bound index construction. Neither operation validates a data graph or
 * evaluates the resulting path against data.
 *
 * @module
 */

export { inspect } from './inspect.ts'
export type { InspectOptionsType } from './inspect.ts'
export { ShapeIndex } from './index.ts'
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
