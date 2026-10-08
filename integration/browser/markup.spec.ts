/** Browser host trees are independent oracles for the admitted native table profile. @module */
import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import type { parseMarkup as ReadMarkup } from '../../packages/rdf/markup.ts'
import type { MarkupNodeType } from '../../packages/rdf/markup/model.ts'

test.use({ entry: 'markup' })

const cases = [
  '<table><td>one<td>two<tr><th>three</table>',
  '<div><table>outside<p>before<tr><td>inside</table>after</div>',
  '<table><tr><td>A<table><tr><td>B</table>C<tbody><tr><td>D</table>',
  '<table><col><col><caption>title<tbody><tr><td>data</table>',
  '<table>\n<tr><td>one<td>two<tfoot><tr><th>sum</table>',
  '<div data-value=one\u00a0two data-name\u00a0suffix=three>text</div>',
] as const

for (const [index, source] of cases.entries()) {
  test(`table insertion ${index}: semantic ancestry matches the browser`, async ({ page }) => {
    const result = await page.evaluate(async (source) => {
      const uri = '/packages/rdf/markup.ts'
      const { parseMarkup } = await import(/* @vite-ignore */ uri) as {
        parseMarkup: typeof ReadMarkup
      }
      const native = await parseMarkup(source, { html: true })
      const browser = new DOMParser().parseFromString(source, 'text/html')
      const project = (node: MarkupNodeType): unknown =>
        node.kind === 'text' ? node.value : [
          node.name,
          node.attributes.map(({ name, value }) => [name, value]),
          node.children.map(project),
        ]
      const platform = (node: Node): unknown =>
        node.nodeType === Node.TEXT_NODE ? node.textContent : [
          (node as Element).localName,
          Array.from((node as Element).attributes).map(({ name, value }) => [name, value]),
          Array.from(node.childNodes).filter((child) =>
            child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE
          ).map(platform),
        ]
      return {
        project: native.children.map(project),
        platform: Array.from(browser.body.childNodes).map(platform),
      }
    }, source)
    expect(result.project).toEqual(result.platform)
  })
}
