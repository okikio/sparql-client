import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, type Quad, quad, RDF, XSD } from '../mod.ts'
import { parse } from '../turtle/mod.ts'
import { getPath, inspect, ShapeIndex } from './mod.ts'
import type { DiagnosticType } from './mod.ts'

const SH = 'http://www.w3.org/ns/shacl#'

function getShape(graph: Awaited<ReturnType<typeof inspect>>, suffix: string) {
  return graph.shapes.find((shape) => shape.id.value.endsWith(suffix))
}

describe('@okikio/rdf/shape', () => {
  it('keeps IRI paths as predicates despite unrelated list and constructor assertions', () => {
    const index = new ShapeIndex()
    const iri = namedNode('urn:predicate')
    index.add(quad(iri, namedNode(RDF.first), namedNode('urn:first')))
    index.add(quad(iri, namedNode(RDF.rest), namedNode(RDF.nil)))
    index.add(quad(iri, namedNode(`${SH}inversePath`), namedNode('urn:other')))
    const diagnostics: DiagnosticType[] = []
    expect(getPath(index, iri, { maxDepth: 4, maxListItems: 4, diagnostics }))
      .toEqual({ kind: 'predicate', iri: iri.value })
    expect(diagnostics).toEqual([])
  })

  it('retains malformed compound paths rather than accepting competing or extra triples', () => {
    for (const sequence of [false, true]) {
      const index = new ShapeIndex()
      const head = blankNode()
      index.add(quad(head, namedNode(`${SH}inversePath`), namedNode('urn:predicate')))
      index.add(quad(head, namedNode(sequence ? RDF.first : 'urn:annotation'), namedNode('urn:p')))
      if (sequence) index.add(quad(head, namedNode(RDF.rest), namedNode(RDF.nil)))
      const diagnostics: DiagnosticType[] = []
      expect(getPath(index, head, { maxDepth: 4, maxListItems: 4, diagnostics }))
        .toEqual({ kind: 'unknown', value: { kind: 'blank', value: head.value } })
      expect(diagnostics).toMatchObject([{ code: 'invalid-path' }])
      expect(index.quads(head)).toHaveLength(sequence ? 3 : 2)
    }
  })

  it('rejects SHACL lists whose rdf:nil terminator has list properties', async () => {
    for (const predicate of ['first', 'rest']) {
      const graph = await inspect(parse(`
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        <urn:Shape> a sh:NodeShape ; sh:in ( <urn:allowed> ) .
        rdf:nil rdf:${predicate} <urn:illegal> .
      `))
      expect(graph.diagnostics.some((value) => value.code === 'invalid-list')).toBe(true)
    }
  })
  it('constructs a direct compound path and diagnoses a cycle through the public API', () => {
    const index = new ShapeIndex()
    const head = blankNode()
    const tail = blankNode()
    const inverse = blankNode()
    for (
      const value of [
        quad(head, namedNode(RDF.first), namedNode('urn:name')),
        quad(head, namedNode(RDF.rest), tail),
        quad(tail, namedNode(RDF.first), inverse),
        quad(tail, namedNode(RDF.rest), namedNode(RDF.nil)),
        quad(inverse, namedNode(`${SH}inversePath`), namedNode('urn:label')),
      ]
    ) index.add(value)
    const options = { maxDepth: 4, maxListItems: 2, diagnostics: [] }
    const expected = {
      kind: 'sequence',
      items: [
        { kind: 'predicate', iri: 'urn:name' },
        { kind: 'inverse', path: { kind: 'predicate', iri: 'urn:label' } },
      ],
    }
    expect(getPath(index, head, options)).toEqual(expected)
    expect(options.diagnostics).toHaveLength(0)

    // A different predicate must change the semantic result, independently of
    // blank-label spelling and RDF statement ingestion order.
    const changed = new ShapeIndex()
    for (const value of index.subjects()) {
      for (const statement of index.quads(value)) {
        changed.add(
          statement.object.equals(namedNode('urn:label'))
            ? quad(statement.subject, statement.predicate, namedNode('urn:wrong'))
            : statement,
        )
      }
    }
    expect(getPath(changed, head, { ...options, diagnostics: [] })).not.toEqual(expected)

    const cycle = blankNode()
    index.add(quad(cycle, namedNode(`${SH}inversePath`), cycle))
    const diagnostics: DiagnosticType[] = []
    const result = getPath(index, cycle, { ...options, diagnostics })
    expect(result).toEqual({
      kind: 'inverse',
      path: { kind: 'unknown', value: { kind: 'blank', value: cycle.value } },
    })
    expect(diagnostics.map((value) => value.code)).toEqual(['path-cycle'])
    // Adding another node affects only subsequent reads; the earlier path is stable.
    expect(getPath(index, head, { ...options, diagnostics: [] })).toEqual(expected)
  })
  it('validates bounds supplied directly to the public path operation', () => {
    const index = new ShapeIndex()
    const value = namedNode('urn:p')
    for (const name of ['maxDepth', 'maxListItems'] as const) {
      for (const bound of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() =>
          getPath(index, value, { maxDepth: 1, maxListItems: 1, diagnostics: [], [name]: bound })
        )
          .toThrow(RangeError)
      }
    }
    expect(getPath(index, value, { maxDepth: 1, maxListItems: 1, diagnostics: [] }))
      .toEqual({ kind: 'predicate', iri: 'urn:p' })
  })
  it('rejects invalid resource bounds before acquiring a shapes source', async () => {
    let acquired = 0
    const source = {
      [Symbol.iterator]() {
        acquired++
        return [][Symbol.iterator]()
      },
    }
    for (const name of ['maxQuads', 'maxListItems', 'maxPathDepth'] as const) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(inspect(source, { [name]: value })).rejects.toBeInstanceOf(RangeError)
      }
      expect((await inspect([], { [name]: 1 })).shapes).toHaveLength(0)
    }
    expect(acquired).toBe(0)
  })

  it('cancels a pending shapes read and closes its iterator once', { timeout: 2_000 }, async () => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    let returned = 0
    const source: AsyncIterable<Quad> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            started.resolve()
            return new Promise<IteratorResult<Quad>>(() => {})
          },
          return() {
            returned++
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }
    const reason = new Error('cancel borrowed shapes source')
    const pending = inspect(source, { signal: controller.signal })
    await started.promise
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(returned).toBe(1)
  })

  it('does not acquire a pre-aborted shapes source', async () => {
    let acquired = 0
    const reason = new Error('cancel before shapes acquisition')
    const source = {
      [Symbol.iterator]() {
        acquired++
        return [][Symbol.iterator]()
      },
    }
    await expect(inspect(source, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    expect(acquired).toBe(0)
  })

  it('admits the quad boundary and returns upstream on the first extra quad', async () => {
    const value = quad(namedNode('urn:Shape'), namedNode(RDF.type), namedNode(`${SH}NodeShape`))
    expect((await inspect([value], { maxQuads: 1 })).shapes).toHaveLength(1)
    let returned = 0
    let pulled = 0
    const source = {
      [Symbol.iterator]() {
        return {
          next() {
            pulled++
            return { done: false as const, value }
          },
          return() {
            returned++
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    await expect(inspect(source, { maxQuads: 1 })).rejects.toBeInstanceOf(RangeError)
    expect(pulled).toBe(2)
    expect(returned).toBe(1)
  })

  it('bounds list traversal without inventing an incomplete membership constraint', async () => {
    const source = `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      <urn:Shape> a sh:NodeShape ; sh:in ( <urn:a> <urn:b> ) .
    `
    const admitted = await inspect(parse(source), { maxListItems: 2 })
    expect(admitted.diagnostics).toHaveLength(0)
    expect(admitted.shapes[0]?.constraints).toContainEqual({
      kind: 'in',
      values: [{ kind: 'iri', value: 'urn:a' }, { kind: 'iri', value: 'urn:b' }],
    })
    const bounded = await inspect(parse(source), { maxListItems: 1 })
    expect(bounded.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid-list',
      predicate: `${SH}in`,
    }))
    expect(bounded.shapes[0]?.constraints.some((value) => value.kind === 'in')).toBe(false)
    expect(bounded.shapes[0]?.assertions.some((value) => value.predicate === `${SH}in`)).toBe(true)
  })

  it('retains an over-depth path as unknown instead of truncating its semantics', async () => {
    const source = `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      <urn:Shape> a sh:PropertyShape ; sh:path [ sh:inversePath [ sh:inversePath <urn:p> ] ] .
    `
    const admitted = await inspect(parse(source), { maxPathDepth: 2 })
    expect(admitted.diagnostics).toHaveLength(0)
    expect(admitted.shapes[0]?.path).toEqual({
      kind: 'inverse',
      path: { kind: 'inverse', path: { kind: 'predicate', iri: 'urn:p' } },
    })
    const bounded = await inspect(parse(source), { maxPathDepth: 1 })
    expect(bounded.diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid-path',
      predicate: `${SH}path`,
    }))
    expect(bounded.shapes[0]?.path).toMatchObject({ kind: 'inverse', path: { kind: 'unknown' } })
  })

  it('inspects SHACL 1.2 Core paths, constraints, metadata, and extension assertions', async () => {
    const source = `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <https://example.com/> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

      ex:PersonShape a sh:NodeShape, ex:Profile ;
        sh:targetClass ex:Person ;
        sh:closed sh:ByTypes ;
        sh:ignoredProperties ( rdf:type ) ;
        sh:uniqueValuesFor ( ex:id ex:tenant ) ;
        sh:property [
          a sh:PropertyShape ;
          sh:path [ sh:alternativePath ( ex:name [ sh:inversePath ex:label ] ) ] ;
          sh:class ( ex:Person ex:Organization ) ;
          sh:minCount 1 ;
          sh:pattern "^[a-z]+$" ;
          sh:flags "i" ;
          sh:name "Display name"@en ;
          ex:customConstraint "retained"
        ] .
    `

    const graph = await inspect(parse(source), { version: '1.2' })
    expect(graph.diagnostics).toHaveLength(0)

    const person = getShape(graph, 'PersonShape')
    expect(person?.types.includes('https://example.com/Profile')).toBe(true)
    expect(person?.constraints).toContainEqual({
      kind: 'closed',
      mode: 'byTypes',
      ignoredProperties: [RDF.type],
    })
    expect(person?.constraints).toContainEqual({
      kind: 'uniqueValuesFor',
      paths: [
        { kind: 'predicate', iri: 'https://example.com/id' },
        { kind: 'predicate', iri: 'https://example.com/tenant' },
      ],
    })

    const property = graph.shapes.find((shape) =>
      shape.kind === 'property' && shape.id.kind === 'blank'
    )
    expect(property?.path).toEqual({
      kind: 'alternative',
      items: [
        { kind: 'predicate', iri: 'https://example.com/name' },
        { kind: 'inverse', path: { kind: 'predicate', iri: 'https://example.com/label' } },
      ],
    })
    expect(property?.constraints).toContainEqual({
      kind: 'class',
      choices: ['https://example.com/Person', 'https://example.com/Organization'],
    })
    expect(property?.metadata.names[0]?.value).toBe('Display name')
    expect(
      property?.assertions.some((value) =>
        value.predicate === 'https://example.com/customConstraint'
      ),
    ).toBe(true)
  })

  it('reports cyclic property paths without recursive overflow', async () => {
    const shape = namedNode('https://example.com/Shape')
    const path = blankNode('path')
    const values = [
      quad(shape, namedNode(RDF.type), namedNode(`${SH}PropertyShape`)),
      quad(shape, namedNode(`${SH}path`), path),
      quad(path, namedNode(`${SH}inversePath`), path),
    ]

    const graph = await inspect(values)
    expect(graph.diagnostics.some((value) => value.code === 'path-cycle')).toBe(true)
    expect(graph.shapes[0]?.path?.kind).toBe('inverse')
  })

  it('retains malformed known values as diagnostics instead of weakening them silently', async () => {
    const shape = namedNode('https://example.com/Shape')
    const values = [
      quad(shape, namedNode(RDF.type), namedNode(`${SH}NodeShape`)),
      quad(shape, namedNode(`${SH}minCount`), literal('-1', namedNode(XSD.integer))),
      quad(shape, namedNode(`${SH}closed`), literal('not-a-boolean', namedNode(XSD.boolean))),
    ]

    const graph = await inspect(values)
    expect(graph.shapes[0]?.constraints).toHaveLength(0)
    expect(graph.diagnostics.filter((value) => value.code === 'invalid-value')).toHaveLength(2)
    expect(graph.shapes[0]?.assertions.some((value) => value.predicate === `${SH}minCount`)).toBe(
      true,
    )
    expect(graph.shapes[0]?.assertions.some((value) => value.predicate === `${SH}closed`)).toBe(
      true,
    )
  })

  it('warns when 1.2-only Core terms are inspected through the 1.0 interpretation mode', async () => {
    const shape = namedNode('https://example.com/Shape')
    const graph = await inspect([
      quad(shape, namedNode(RDF.type), namedNode(`${SH}NodeShape`)),
      quad(shape, namedNode(`${SH}singleLine`), literal('true', namedNode(XSD.boolean))),
    ], { version: '1.0' })
    expect(graph.diagnostics.some((value) => value.code === 'unsupported-version')).toBe(true)
    expect(graph.shapes[0]?.constraints.some((value) => value.kind === 'singleLine')).toBe(true)
  })
})
