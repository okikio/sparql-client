import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join, toFileUrl } from '@std/path'
import type { EntryType } from './manifest.ts'
import { runRdfCase } from './rdf.ts'
import { runMicrodataCase } from './microdata.ts'

describe('negative conformance vectors', () => {
  for (const profile of ['ntriples-1.2', 'nquads-1.2']) {
    it(`${profile}: canonical syntax requires exact writer bytes and an existing result`, async () => {
      const directory = await Deno.makeTempDir({ prefix: 'conformance-canonical-syntax-' })
      try {
        const input = join(directory, 'input.nt')
        const expected = join(directory, 'expected.nt')
        const graph = profile.startsWith('nquads') ? ' <urn:g>' : ''
        const canonical = `<urn:s> <urn:p> "value"${graph} .\n`
        // The reader accepts whitespace differences; the writer must normalize
        // them to the exact independently supplied expected line layout.
        await Deno.writeTextFile(input, ` <urn:s>  <urn:p> "value"${graph}  . # comment\n`)
        const entry: EntryType = {
          id: 'urn:canonical-syntax',
          name: 'canonical syntax',
          manifest: toFileUrl(join(directory, 'manifest.ttl')).href,
          action: toFileUrl(input).href,
          types: [
            profile.startsWith('nquads')
              ? 'http://www.w3.org/ns/rdftest#TestNQuadsPositiveC14N'
              : 'http://www.w3.org/ns/rdftest#TestNTriplesPositiveC14N',
          ],
        }
        expect(await runRdfCase(entry, profile, 'fixture')).toMatchObject({ status: 'fail' })
        const vector = { ...entry, result: toFileUrl(expected).href }
        expect(await runRdfCase(vector, profile, 'fixture')).toMatchObject({ status: 'fail' })
        await Deno.writeTextFile(expected, canonical)
        expect(await runRdfCase(vector, profile, 'fixture')).toMatchObject({ status: 'pass' })
        await Deno.writeTextFile(expected, canonical.replace('<urn:p>', '<urn:wrong>'))
        expect(await runRdfCase(vector, profile, 'fixture')).toMatchObject({ status: 'fail' })
        // Equal RDF semantics remain insufficient for a canonical-byte vector.
        await Deno.writeTextFile(expected, canonical.replace('> <', '>  <'))
        expect(await runRdfCase(vector, profile, 'fixture')).toMatchObject({ status: 'fail' })
      } finally {
        await Deno.remove(directory, { recursive: true })
      }
    })
  }
  for (const format of ['rdf', 'microdata'] as const) {
    it(`${format}: missing input fails setup, rejection passes, accepted syntax fails`, async () => {
      const directory = await Deno.makeTempDir({ prefix: 'conformance-vector-' })
      try {
        const path = join(directory, 'input')
        const entry: EntryType = {
          id: 'urn:fixture',
          name: 'negative vector',
          manifest: toFileUrl(join(directory, 'manifest.ttl')).href,
          action: toFileUrl(path).href,
          types: [
            format === 'rdf'
              ? 'http://www.w3.org/ns/rdftest#TestNTriplesNegativeSyntax'
              : 'test:TestMicrodataNegativeSyntax',
          ],
        }
        const run = () =>
          format === 'rdf'
            ? runRdfCase(entry, 'ntriples-1.2', 'fixture')
            : runMicrodataCase(entry, 'fixture')
        expect(await run()).toMatchObject({ status: 'fail' })
        await Deno.writeTextFile(
          path,
          format === 'rdf'
            ? 'not RDF'
            : '<div itemscope itemref="a"><div id="a" itemprop="friend" itemscope itemref="a"></div></div>',
        )
        expect(await run()).toMatchObject({ status: 'pass' })
        await Deno.writeTextFile(path, format === 'rdf' ? '<urn:s> <urn:p> <urn:o> .' : '<div/>')
        expect(await run()).toMatchObject({
          status: 'fail',
          id: entry.id,
          kind: entry.types.join(' '),
        })
      } finally {
        await Deno.remove(directory, { recursive: true })
      }
    })
  }
  it('evaluation requires an existing expected dataset and rejects a wrong term', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'conformance-evaluation-' })
    try {
      const input = join(directory, 'input.nt')
      const expected = join(directory, 'expected.nt')
      await Deno.writeTextFile(input, '<urn:s> <urn:p> <urn:o> .')
      const entry: EntryType = {
        id: 'urn:evaluation',
        name: 'evaluation',
        manifest: toFileUrl(join(directory, 'manifest.ttl')).href,
        action: toFileUrl(input).href,
        types: ['http://www.w3.org/ns/rdftest#TestNTriplesEval'],
      }
      expect(await runRdfCase(entry, 'ntriples-1.2', 'fixture')).toMatchObject({ status: 'fail' })
      const vector = { ...entry, result: toFileUrl(expected).href }
      expect(await runRdfCase(vector, 'ntriples-1.2', 'fixture')).toMatchObject({ status: 'fail' })
      await Deno.writeTextFile(expected, '<urn:s> <urn:wrong> <urn:o> .')
      expect(await runRdfCase(vector, 'ntriples-1.2', 'fixture')).toMatchObject({ status: 'fail' })
      await Deno.writeTextFile(expected, '<urn:s> <urn:p> <urn:o> .')
      expect(await runRdfCase(vector, 'ntriples-1.2', 'fixture')).toMatchObject({ status: 'pass' })
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
  it('rejects unknown or mismatched RDF vector kinds instead of counting parse acceptance', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'conformance-unknown-kind-' })
    try {
      const input = join(directory, 'input.nt')
      await Deno.writeTextFile(input, '<urn:s> <urn:p> <urn:o> .')
      const entry: EntryType = {
        id: 'urn:kind',
        name: 'test kind',
        manifest: toFileUrl(join(directory, 'manifest.ttl')).href,
        action: toFileUrl(input).href,
        types: ['http://www.w3.org/ns/rdftest#TestNTriplesPositiveSyntax'],
      }
      expect(await runRdfCase(entry, 'ntriples-1.2', 'fixture')).toMatchObject({ status: 'pass' })
      for (
        const types of [
          ['http://www.w3.org/ns/rdftest#TestNTriplesUnknownAssertion'],
          ['http://www.w3.org/ns/rdftest#TestTurtlePositiveSyntax'],
          [...entry.types, 'urn:additional-unsupported-kind'],
        ]
      ) {
        expect(await runRdfCase({ ...entry, types }, 'ntriples-1.2', 'fixture'))
          .toMatchObject({ status: 'fail' })
      }
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
