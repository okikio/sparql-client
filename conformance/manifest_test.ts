import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join } from '@std/path'
import { readTree } from './manifest.ts'

const prefixes = '@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n' +
  '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n'

describe('official manifest acquisition', () => {
  it('keeps empty entry lists empty and resolves direct entries and recursive includes once', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'manifest-fixture-' })
    try {
      const root = join(directory, 'manifest.ttl')
      await Deno.writeTextFile(
        root,
        `${prefixes}<> a mf:Manifest; mf:entries (); mf:include (<child.ttl> <child.ttl>) .`,
      )
      await Deno.writeTextFile(
        join(directory, 'child.ttl'),
        `${prefixes}<> a mf:Manifest; mf:include (<manifest.ttl>); mf:entries <urn:case> .\n<urn:case> a <urn:PositiveSyntax>; mf:name "direct"; mf:action <input.nt> .`,
      )
      const entries = await readTree(root)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        id: 'urn:case',
        name: 'direct',
        types: ['urn:PositiveSyntax'],
      })
      expect(entries[0]?.action).toBe(new URL('input.nt', entries[0]?.manifest).href)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })

  it('rejects cyclic and incomplete RDF list structure instead of reducing corpus coverage', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'manifest-invalid-' })
    try {
      const root = join(directory, 'manifest.ttl')
      for (const rest of ['; rdf:rest _:head', '']) {
        await Deno.writeTextFile(
          root,
          `${prefixes}<> a mf:Manifest; mf:entries _:head .\n_:head rdf:first <urn:case> ${rest} .`,
        )
        await expect(readTree(root)).rejects.toThrow(TypeError)
      }
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
