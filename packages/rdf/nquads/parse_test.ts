import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { analyze, parse, write } from './mod.ts'
import type { Quad } from '../mod.ts'

describe('@okikio/rdf/nquads', () => {
  it('round-trips RDF 1.2 directional literals and triple terms', async () => {
    const source = [
      'VERSION "1.2"',
      '<https://example/s> <https://example/p> "bonjour"@fr--ltr .',
      '<https://example/s> <https://example/says> <<( <https://example/a> <https://example/p> "x" )>> .',
      '',
    ].join('\n')

    const quads: Quad[] = []
    for await (const quad of parse(source)) quads.push(quad)
    expect(quads.length).toBe(2)
    expect(quads[0]?.object.termType).toBe('Literal')
    if (quads[0]?.object.termType === 'Literal') {
      expect(quads[0].object.language).toBe('fr')
      expect(quads[0].object.direction).toBe('ltr')
    }
    expect(quads[1]?.object.termType).toBe('Quad')

    const reparsed: Quad[] = []
    for await (const quad of parse(write(quads))) reparsed.push(quad)
    expect(quads.every((quad, index) => quad.equals(reparsed[index]!))).toBe(true)
  })

  it('emits a source-ranged diagnostic and resumes at the next record in tolerant mode', async () => {
    const source =
      '<https://example/a> <https://example/p> "ok" .\nnot rdf\n<https://example/b> <https://example/p> "ok" .\n'
    const events = []
    for await (const event of analyze(source, { tolerant: true })) events.push(event)
    expect(events.map((event) => event.kind)).toEqual(['quad', 'diagnostic', 'quad'])
    const problem = events[1]
    expect(problem?.kind).toBe('diagnostic')
    if (problem?.kind === 'diagnostic') expect(problem.diagnostic.range.line).toBe(2)
  })

  it('cancels a ReadableStream when the consumer returns early', async () => {
    let cancelled = false
    const bytes = new TextEncoder().encode(
      '<https://example/a> <https://example/p> "one" .\n<https://example/b> <https://example/p> "two" .\n',
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, bytes.length / 2))
        controller.enqueue(bytes.slice(bytes.length / 2))
      },
      cancel() {
        cancelled = true
      },
    })

    for await (const _quad of parse(stream)) break
    expect(cancelled).toBe(true)
  })

  it('accepts RDF 1.2 quad terms without separating whitespace', async () => {
    const source =
      '<http://example/s><http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies><<(<http://example/s2><http://example/p2><http://example/o2>)>><http://example/g>.\n'
    const quads: Quad[] = []
    for await (const value of parse(source)) quads.push(value)
    expect(quads).toHaveLength(1)
    expect(quads[0]?.graph.value).toBe('http://example/g')
  })
})
