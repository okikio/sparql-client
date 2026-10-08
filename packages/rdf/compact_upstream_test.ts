/** Public syntax regressions exposed by licensed upstream implementation corpora. @module */

import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { parse as turtle } from '@okikio/rdf/turtle'
import { parse as trig } from '@okikio/rdf/trig'
import type { Quad } from '@okikio/rdf'

async function read(input: AsyncIterable<Quad>): Promise<Quad[]> {
  return await Array.fromAsync(input)
}

describe('upstream compact syntax boundaries', () => {
  it('separates adjacent boolean terminators while preserving keyword-shaped prefix names', async () => {
    const values = await read(turtle('PREFIX true: <urn:true:> <urn:s> true:p true; true:q false.'))
    expect(
      values.map((value) => [value.predicate.value, value.object.value, value.object.termType]),
    )
      .toEqual([['urn:true:p', 'true', 'Literal'], ['urn:true:q', 'false', 'Literal']])
    expect(
      values.map((value) => value.object.termType === 'Literal' && value.object.datatype.value),
    )
      .toEqual([
        'http://www.w3.org/2001/XMLSchema#boolean',
        'http://www.w3.org/2001/XMLSchema#boolean',
      ])
  })

  it('keeps escaped terminal dots in both empty and named prefixes under byte splits', async () => {
    const text = 'PREFIX ex: <urn:ex:> PREFIX : <urn:empty:> ex:s ex:p ex:o\\.; :q :o\\..'
    async function* bytes() {
      for (const byte of new TextEncoder().encode(text)) yield new Uint8Array([byte])
    }
    const values = await read(turtle(bytes()))
    expect(values.map((value) => [value.predicate.value, value.object.value]))
      .toEqual([['urn:ex:p', 'urn:ex:o.'], ['urn:empty:q', 'urn:empty:o.']])
  })

  it('recognizes directive spellings as language tags only after a quoted literal', async () => {
    const values = await read(turtle('<urn:s> <urn:p> "x"@base, "y"@prefix, "z"@version.'))
    expect(values.map((value) => value.object.termType === 'Literal' && value.object.language))
      .toEqual(['base', 'prefix', 'version'])
    await expect(read(turtle('@base .'))).rejects.toBeInstanceOf(Error)
  })

  it('checks Unicode PN grammar and keeps legal escapes, middle dots and astral names', async () => {
    const valid = 'PREFIX ex: <urn:ex:> ex:𐀀 ex:a·b ex:_%20\\..'
    const values = await read(turtle(valid))
    expect(values.map((value) => [value.subject.value, value.predicate.value, value.object.value]))
      .toEqual([['urn:ex:𐀀', 'urn:ex:a·b', 'urn:ex:_%20.']])
    for (const token of ['¿bad', 'a¿b', 'a\u200bb', 'a\u2190b', 'a\uFDD0b']) {
      await expect(read(turtle(`PREFIX ex: <urn:ex:> ex:${token} ex:p ex:o.`)))
        .rejects.toBeInstanceOf(Error)
    }
  })

  it('requires predicates for an empty anonymous subject and permits nonempty property lists', async () => {
    await expect(read(turtle('[].'))).rejects.toBeInstanceOf(Error)
    await expect(read(trig('<urn:g> { [] }'))).rejects.toBeInstanceOf(Error)
    expect((await read(turtle('[ <urn:p> <urn:o> ].'))).length).toBe(1)
    expect((await read(turtle('[] <urn:p> <urn:o>.'))).length).toBe(1)
    expect((await read(trig('[] { <urn:s> <urn:p> <urn:o> }'))).length).toBe(1)
  })

  it('preserves absolute RDF IRI spelling and resolves only relative references', async () => {
    const values = await read(turtle(
      'PREFIX ex: <http://ex.org/a/../> ex:s ex:p <http://ex.org/x/./o>. <relative> ex:p <./this:that>.',
      { baseIri: 'http://ex.org/base/' },
    ))
    expect(values.map((value) => [value.subject.value, value.predicate.value, value.object.value]))
      .toEqual([
        ['http://ex.org/a/../s', 'http://ex.org/a/../p', 'http://ex.org/x/./o'],
        ['http://ex.org/base/relative', 'http://ex.org/a/../p', 'http://ex.org/base/this:that'],
      ])
    for (const input of ['<bad_scheme:x> <urn:p> <urn:o>.', 'BASE <bad_scheme:x>']) {
      await expect(read(turtle(input, { baseIri: 'http://ex.org/' }))).rejects.toBeInstanceOf(Error)
    }
  })
})
