import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { attr, parseMarkup, textContent } from '../markup.ts'
import { html } from '../jsonld/html.ts'
import type { MarkupElementType } from './model.ts'

async function root(source: string, html = false): Promise<MarkupElementType> {
  const document = await parseMarkup(source, { html })
  return document.children.find((node) => node.kind === 'element') as MarkupElementType
}

describe('native XML and HTML host authorities', () => {
  it('normalizes XML line endings and literal attribute whitespace before references', async () => {
    const element = await root('<a x="A\r\nB&#x9;C">A\r\nB&#xD;C<![CDATA[\rD]]></a>')
    expect(attr(element, 'x')).toBe('A B\tC')
    expect(textContent(element)).toBe('A\nB\rC\nD')
  })
  it('rejects XML syntax, characters and namespaces outside well-formed no-DTD input', async () => {
    for (
      const source of [
        '<a x=1/>',
        '<a>&undefined;</a>',
        '<a>&AMP;</a>',
        '<a>&#0;</a>',
        '<a>\u0000</a>',
        '<a/><b/>',
        '<a x="1" x="2"/>',
        '<a>]]></a>',
        '<a><!--a--b--></a>',
        '<a xmlns:p="urn:x" xmlns:q="urn:x" p:x="1" q:x="2"/>',
        '<p:a/>',
        '<!DOCTYPE a [<!ENTITY b "B">]><a>&b;</a>',
      ]
    ) {
      await expect(root(source)).rejects.toBeInstanceOf(SyntaxError)
    }
    expect((await root('<?xml version="1.0"?><a/>')).name).toBe('a')
  })
  it('decodes the normative HTML references by context and preserves case', async () => {
    const element = await root(
      '<p x="&notit; &copy= &eacute; &AMP;">&eacute; &NotEqualTilde; &notit; &#x80; &#0;</p>',
      true,
    )
    expect(attr(element, 'x')).toBe('&notit; &copy= é &')
    expect(textContent(element)).toBe('é ≂̸ ¬it; € �')
  })
  it('keeps raw-text and RCDATA host states distinct and ignores duplicate attributes', async () => {
    const element = await root(
      '<div><script type="one" TYPE="two">"<base href=evil> &eacute;"</script><textarea>&eacute;<b>text</b></textarea></div>',
      true,
    )
    const script = element.children[0] as MarkupElementType
    expect(attr(script, 'type')).toBe('one')
    expect(textContent(script)).toBe('"<base href=evil> &eacute;"')
    expect(textContent(element.children[1] as MarkupElementType)).toBe('é<b>text</b>')
  })
  it('extracts actual JSON-LD script elements and host-decoded ids/base attributes', () => {
    const source =
      '<!--<base href="https://evil/"><script type="application/ld+json">{"fake":true}</script>--><base href="/a?x=1&amp;y=2"><script id="caf&eacute;" type="application/ld+json">{"real":"&eacute;<base href=evil>"}</script>'
    expect(html(source, 'https://example.test/doc#café', false)).toEqual({
      document: { real: '&eacute;<base href=evil>' },
      base: 'https://example.test/a?x=1&y=2',
    })
  })
  it('rejects unimplemented HTML tree profiles and bounds both hosts', async () => {
    for (
      const source of [
        '<template><p>x</p></template>',
        '<svg/>',
        '<b><i>x</b></i>',
      ]
    ) await expect(root(source, true)).rejects.toBeInstanceOf(SyntaxError)
    for (const html of [true, false]) {
      await expect(parseMarkup('<a><b/></a>', { html, maxDepth: 1 })).rejects.toBeInstanceOf(
        RangeError,
      )
      await expect(parseMarkup('<a>x</a>', { html, maxNodes: 1 })).rejects.toBeInstanceOf(
        RangeError,
      )
      await expect(parseMarkup('<a/>', { html, maxBytes: 3 })).rejects.toBeInstanceOf(RangeError)
    }
  })
})
