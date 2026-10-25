/** JSON-LD 1.1 native processor contracts. @module */
import type { BlankNode, NamedNode, Quad } from '../term.ts'

/**
 * JSON-LD generalized RDF statement returned only when `produceGeneralizedRdf`
 * is enabled. A blank predicate cannot enter a standard RDF dataset or writer;
 * callers must use a generalized RDF consumer or convert it explicitly.
 */
export type GeneralizedQuadType = Omit<Quad, 'predicate'> & {
  /** Predicate IRI or generalized blank-node predicate. */
  readonly predicate: NamedNode | BlankNode
}
/** JSON-compatible JSON-LD input/output value. */
export type JsonLdValueType =
  | null
  | boolean
  | number
  | string
  | JsonLdValueType[]
  | {
    /** Allows arbitrary JSON object keys whose values remain JSON-LD-compatible values. */
    [key: string]: JsonLdValueType
  }
/** JSON-LD processing mode. */
export type ProcessingModeType = 'json-ld-1.0' | 'json-ld-1.1'
/** RDF direction mapping accepted by RDF conversion. */
export type RdfDirectionType =
  | 'i18n-datatype'
  | 'compound-literal'
/** JSON-LD framing embed mode. */
export type EmbedType = '@always' | '@once' | '@never' | '@last' | '@link' | boolean
/** Remote document returned by a JSON-LD loader. */
export interface RemoteDocumentType {
  /** External JSON-LD context URL obtained from HTTP metadata, or null when absent. */
  readonly contextUrl: string | null
  /** Final document URL. */ readonly documentUrl: string
  /** Parsed JSON or HTML source text. */ readonly document: JsonLdValueType
}
/** Caller-provided remote document loader. */
export type DocumentLoaderType = (
  url: string,
  options?: Readonly<Record<string, unknown>>,
) => Promise<RemoteDocumentType>
