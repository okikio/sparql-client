import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { blankNode, literal, namedNode, quad, RDF, XSD } from '../mod.ts'
import { parse } from '../turtle/mod.ts'
import { inspect } from './mod.ts'

const SH = 'http://www.w3.org/ns/shacl#'

function getShape(graph: Awaited<ReturnType<typeof inspect>>, suffix: string) {
  return graph.shapes.find((shape) => shape.id.value.endsWith(suffix))
}

describe('@okikio/rdf/shape', () => {
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
    expect(person?.constraints.some((value) => value.kind === 'closed' && value.mode === 'byTypes'))
      .toBe(true)
    expect(
      person?.constraints.some((value) =>
        value.kind === 'uniqueValuesFor' && value.paths.length === 2
      ),
    ).toBe(true)

    const property = graph.shapes.find((shape) =>
      shape.kind === 'property' && shape.id.kind === 'blank'
    )
    expect(property?.path?.kind).toBe('alternative')
    if (property?.path?.kind === 'alternative') {
      expect(property.path.items).toHaveLength(2)
      expect(property.path.items[1]?.kind).toBe('inverse')
    }
    expect(
      property?.constraints.some((value) => value.kind === 'class' && value.choices.length === 2),
    ).toBe(true)
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
