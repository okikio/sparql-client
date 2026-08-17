/** JSON-LD processor and remote-document contracts. @module */

/** JSON-compatible JSON-LD input/output value. */
export type JsonLdValueType = null | boolean | number | string | JsonLdValueType[] | { [key: string]: JsonLdValueType }

/** Remote document shape required by the JSON-LD processing algorithms. */
export interface RemoteDocumentType {
  readonly contextUrl: string | null
  readonly documentUrl: string
  readonly document: JsonLdValueType
}

/** JSON-LD document loader compatible with jsonld.js. */
export type DocumentLoaderType = (
  url: string,
  options?: Readonly<Record<string, unknown>>,
) => Promise<RemoteDocumentType>

/** Minimal processing API used by `@okikio/rdf/jsonld`. */
export interface ProcessorType {
  expand(input: unknown, options?: Readonly<Record<string, unknown>>): Promise<JsonLdValueType[]>
  compact(input: unknown, context: unknown, options?: Readonly<Record<string, unknown>>): Promise<JsonLdValueType>
  flatten(input: unknown, context?: unknown, options?: Readonly<Record<string, unknown>>): Promise<JsonLdValueType>
  frame(input: unknown, frame: unknown, options?: Readonly<Record<string, unknown>>): Promise<JsonLdValueType>
  toRDF(input: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>
  fromRDF(input: unknown, options?: Readonly<Record<string, unknown>>): Promise<JsonLdValueType>
}
