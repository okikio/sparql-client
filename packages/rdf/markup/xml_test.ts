import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parseMarkup } from '../markup.ts'
import { parse as parseRdfa } from '../rdfa/mod.ts'

describe('XML standalone document-type declaration admission', () => {
  it('parses bounded standalone, SYSTEM and PUBLIC declaration grammar without external access', async () => {
    for (
      const declaration of [
        '<!DOCTYPE html>',
        '<!DOCTYPE html SYSTEM "https://example.invalid/document.dtd">',
        "<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML+RDFa 1.1//EN' 'https://example.invalid/xhtml-rdfa.dtd'>",
      ]
    ) {
      const source =
        `<?xml version="1.0"?>${declaration}<html xmlns="http://www.w3.org/1999/xhtml"><body about="urn:person"><span property="http://schema.org/name">Ada</span></body></html>`
      const document = await parseMarkup(source)
      expect(document.children.filter((node) => node.kind === 'element')).toHaveLength(1)
      const values = []
      for await (const value of parseRdfa(source, { contentType: 'application/xhtml+xml' })) {
        values.push(value)
      }
      expect(
        values.find((value) => value.predicate.value === 'http://schema.org/name')?.object.value,
      ).toBe('Ada')
    }
  })
  it('rejects malformed, repeated, misplaced and unsupported declaration classes', async () => {
    for (
      const source of [
        '<!DOCTYPEhtml><html/>',
        '<!DOCTYPE html SYSTEM urn:x><html/>',
        '<!DOCTYPE html PUBLIC "<invalid>" "urn:x"><html/>',
        '<!DOCTYPE html PUBLIC "id"><html/>',
        '<!DOCTYPE html SYSTEM "urn:x#fragment"><html/>',
        '<!DOCTYPE html><!DOCTYPE html><html/>',
        '<html/><!DOCTYPE html>',
        '<html><!DOCTYPE html></html>',
        '<!DOCTYPE other><html/>',
        '<!DOCTYPE html [<!ENTITY a "A">]><html/>',
        '<!DOCTYPE html SYSTEM "urn:x"><html>&undeclared;</html>',
      ]
    ) await expect(parseMarkup(source)).rejects.toBeInstanceOf(SyntaxError)
  })
})
