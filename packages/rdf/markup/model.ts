/** Bounded host document records and semantic traversal. @module */
/** One decoded markup attribute plus its source range. */
export interface MarkupAttributeType {
  /** Attribute name as exposed to host-language processing. */ readonly name: string
  /** Decoded attribute value. Boolean HTML attributes use an empty string. */ readonly value:
    string
  /** Inclusive UTF-16 source offset where the attribute begins. */ readonly start: number
  /** Exclusive UTF-16 source offset after the attribute. */ readonly end: number
}
/** Text node in the bounded markup tree. */
export interface MarkupTextType {
  /** Stable node discriminator. */ readonly kind: 'text'
  /** Decoded character data. */ readonly value: string
  /** Inclusive source offset. */ readonly start: number
  /** Exclusive source offset. */ readonly end: number
}
/** Element node in the bounded markup tree. */
export interface MarkupElementType {
  /** Stable node discriminator. */ readonly kind: 'element'
  /** Element qualified name, lower-cased only in HTML mode. */ readonly name: string
  /** Decoded attributes in source order. */ readonly attributes: readonly MarkupAttributeType[]
  /** Child nodes in document order. */ readonly children: readonly MarkupNodeType[]
  /** Inclusive start-tag offset. */ readonly start: number
  /** Exclusive matching-end-tag or recovered document offset. */ readonly end: number
  /** Parent element when one exists. */ readonly parent?: MarkupElementType
}
/** Any node represented by the internal markup tree. */
export type MarkupNodeType = MarkupElementType | MarkupTextType
/** Result of bounded markup parsing. */
export interface MarkupDocumentType {
  /** Top-level nodes in source order. */ readonly children: readonly MarkupNodeType[]
  /** Decoded source retained for ranges and XML literals. */ readonly text: string
}
/** Returns the first attribute value. */
export function attr(element: MarkupElementType, name: string, html = false): string | undefined {
  const target = html ? name.toLowerCase() : name
  return element.attributes.find((v) => (html ? v.name.toLowerCase() : v.name) === target)?.value
}
/** Returns whether an attribute exists even when its value is empty. */
export function hasAttr(element: MarkupElementType, name: string, html = false): boolean {
  const target = html ? name.toLowerCase() : name
  return element.attributes.some((v) => (html ? v.name.toLowerCase() : v.name) === target)
}
/** Concatenates descendant character data in document order. */
export function textContent(element: MarkupElementType): string {
  return element.children.map((v) => v.kind === 'text' ? v.value : textContent(v)).join('')
}
/** Yields descendant elements in source order. */
export function* elements(
  root: MarkupElementType,
  includeRoot = false,
): Generator<MarkupElementType> {
  if (includeRoot) yield root
  for (const child of root.children) {
    if (child.kind === 'element') {
      yield child
      yield* elements(child)
    }
  }
}
