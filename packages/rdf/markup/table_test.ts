/** Table insertion changes RDF property ancestry and text content. @module */
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parseMarkup, textContent } from '../markup.ts'
import type { MarkupElementType, MarkupNodeType } from './model.ts'

/** Behavioral tree projection excludes source offsets and private parser frames. */
function tree(node: MarkupNodeType): unknown {
  return node.kind === 'text' ? node.value : [node.name, node.children.map(tree)]
}

describe('bounded HTML table insertion', () => {
  it('inserts missing sections and rows and closes preceding cells', async () => {
    const document = await parseMarkup('<table><td>one<td>two<tr><th>three</table>', { html: true })
    expect(document.children.map(tree)).toEqual([
      ['table', [['tbody', [['tr', [['td', ['one']], ['td', ['two']]]], ['tr', [['th', [
        'three',
      ]]]]]]]],
    ])
  })

  it('foster-parents misplaced content before the table and preserves its descendants', async () => {
    const document = await parseMarkup(
      '<div><table>outside<p>before<tr><td>inside</table>after</div>',
      { html: true },
    )
    expect(document.children.map(tree)).toEqual([
      ['div', [
        'outside',
        ['p', ['before']],
        ['table', [['tbody', [['tr', [['td', ['inside']]]]]]]],
        'after',
      ]],
    ])
    const parent = document.children[0] as MarkupElementType
    const paragraph = parent.children[1] as MarkupElementType
    expect(paragraph.parent).toBe(parent)
    expect(textContent(parent)).toBe('outsidebeforeinsideafter')
  })

  it('keeps nested tables in their cell and recovers omitted cell/row/section ends', async () => {
    const document = await parseMarkup(
      '<table><tr><td>A<table><tr><td>B</table>C<tbody><tr><td>D</table>',
      { html: true },
    )
    expect(document.children.map(tree)).toEqual([
      ['table', [
        ['tbody', [['tr', [['td', [
          'A',
          ['table', [['tbody', [['tr', [['td', ['B']]]]]]]],
          'C',
        ]]]]]],
        ['tbody', [['tr', [['td', ['D']]]]]],
      ]],
    ])
  })

  it('keeps non-ASCII spaces in unquoted values and attribute names', async () => {
    const document = await parseMarkup(
      '<div data-value=one\u00a0two data-name\u00a0suffix=three>text</div>',
      { html: true },
    )
    const element = document.children[0] as MarkupElementType
    expect(element.attributes.map(({ name, value }) => [name, value])).toEqual([
      ['data-value', 'one\u00a0two'],
      ['data-name\u00a0suffix', 'three'],
    ])
  })

  it('uses the same node and depth admission for implied and authored elements', async () => {
    await expect(parseMarkup('<table><td>x', { html: true, maxDepth: 2 })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(parseMarkup('<table><td>x', { html: true, maxNodes: 2 })).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})
