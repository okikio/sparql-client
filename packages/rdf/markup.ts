/** Bounded native host parsing, with independent XML and HTML authorities. @module */
import type { TextSourceType } from './text.ts'
import type { MarkupDocumentType } from './markup/model.ts'
import { collect } from './markup/input.ts'
import { parseHtml } from './markup/html.ts'
import { parseXml } from './markup/xml.ts'
export { attr, elements, hasAttr, textContent } from './markup/model.ts'
export type {
  MarkupAttributeType,
  MarkupDocumentType,
  MarkupElementType,
  MarkupNodeType,
  MarkupTextType,
} from './markup/model.ts'
/** Shared resource admission; host semantics belong to the selected processor. */
export interface MarkupOptionsType {
  /** Selects the focused HTML host profile; the default uses XML syntax rules. */
  readonly html?: boolean
  /** Maximum UTF-8 input size admitted before host parsing, defaulting to 16 MiB. */
  readonly maxBytes?: number
  /** Maximum retained tree nodes, defaulting to 250,000. Exceeding the limit rejects the document. */
  readonly maxNodes?: number
  /** Maximum nested element depth, defaulting to 512. Exceeding the limit rejects the document. */
  readonly maxDepth?: number
  /** Caller-owned cancellation checked while collecting input and parsing the host document. */
  readonly signal?: AbortSignal
}
/** Parses one bounded host document. XML excludes DTD processing; HTML is a focused native profile. */
export async function parseMarkup(
  source: TextSourceType,
  options: MarkupOptionsType = {},
): Promise<MarkupDocumentType> {
  const maxBytes = positive(options.maxBytes ?? 16 * 1024 * 1024, 'maxBytes')
  const maxNodes = positive(options.maxNodes ?? 250_000, 'maxNodes')
  const maxDepth = positive(options.maxDepth ?? 512, 'maxDepth')
  const text = await collect(source, maxBytes, options.signal)
  const config = { maxNodes, maxDepth, ...(options.signal ? { signal: options.signal } : {}) }
  return options.html ? parseHtml(text, config) : parseXml(text, config)
}
/** Rejects invalid limits before acquiring input. */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`)
  }
  return value
}
