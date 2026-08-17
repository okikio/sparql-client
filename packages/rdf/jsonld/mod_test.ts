import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { namedNode, quad } from '../mod.ts'
import { compact, createDocumentLoader, fromRdf, toRdf, type ProcessorType } from './mod.ts'

const processor: ProcessorType = {
  async expand(input) { return [input as never] },
  async compact(input, _context, options) {
    expect(typeof options?.documentLoader).toBe('function')
    return input as never
  },
  async flatten(input) { return input as never },
  async frame(input) { return input as never },
  async toRDF() { return '<https://example.com/s> <https://example.com/p> <https://example.com/o> .\n' },
  async fromRDF(input) {
    expect(typeof input).toBe('string')
    return { '@id': 'https://example.com/s' }
  },
}

describe('@okikio/rdf/jsonld', () => {
  it('keeps remote document loading disabled unless the caller explicitly supplies or enables it', async () => {
    const load = createDocumentLoader()
    await expect(load('https://schema.org/')).rejects.toThrow('disabled')
  })

  it('deduplicates concurrent caller-owned remote document loads', async () => {
    let loads = 0
    const load = createDocumentLoader({
      async loadDocument(url) {
        loads++
        await Promise.resolve()
        return { contextUrl: null, documentUrl: url, document: { '@context': {} } }
      },
    })
    const [left, right] = await Promise.all([load('https://example.com/context'), load('https://example.com/context')])
    expect(loads).toBe(1)
    expect(left).toBe(right)
  })

  it('owns JSON-LD/RDF conversion while preserving native RDF terms', async () => {
    const values = await toRdf({ '@id': 'https://example.com/s' }, { processor })
    expect(values).toHaveLength(1)
    expect(values[0]?.subject.value).toBe('https://example.com/s')

    const json = await fromRdf([
      quad(namedNode('https://example.com/s'), namedNode('https://example.com/p'), namedNode('https://example.com/o')),
    ], { processor })
    expect(json).toEqual({ '@id': 'https://example.com/s' })
  })

  it('passes the bounded loader to non-RDF JSON-LD operations too', async () => {
    const value = { '@context': { name: 'https://schema.org/name' }, name: 'Widget' }
    expect(await compact(value, {}, { processor })).toBe(value)
  })
})
