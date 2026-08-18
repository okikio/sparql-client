/** Decision benchmark for the format-neutral ontology compiler pipeline. @module */

import { bench, do_not_optimize } from 'mitata'
import { report } from '../../bench/report.ts'
import { namedNode, type Quad, quad } from '@okikio/rdf'
import { compile } from './compile.ts'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class')
const RDF_PROPERTY = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')
const RDFS_DOMAIN = namedNode('http://www.w3.org/2000/01/rdf-schema#domain')
const RDFS_RANGE = namedNode('http://www.w3.org/2000/01/rdf-schema#range')
const XSD_STRING = namedNode('http://www.w3.org/2001/XMLSchema#string')

const CLASS_COUNT = 500
const PROPERTY_COUNT = 250
const quads: Quad[] = []
for (let index = 0; index < CLASS_COUNT; index++) {
  quads.push(quad(namedNode(`https://example.test/Class${index}`), RDF_TYPE, RDFS_CLASS))
}
for (let index = 0; index < PROPERTY_COUNT; index++) {
  const property = namedNode(`https://example.test/property${index}`)
  quads.push(quad(property, RDF_TYPE, RDF_PROPERTY))
  quads.push(
    quad(property, RDFS_DOMAIN, namedNode(`https://example.test/Class${index % CLASS_COUNT}`)),
  )
  quads.push(quad(property, RDFS_RANGE, XSD_STRING))
}

const options = {
  vocabulary: 'Benchmark',
  namespace: 'https://example.test/',
  prefix: 'bench',
} as const

const compileFixture = () => compile([{ id: 'benchmark', quads }], options)
const oracle = await compileFixture()
if (!oracle.source.includes('export const Class499 =')) {
  throw new Error('Vocabulary compiler benchmark oracle failed.')
}

bench('vocab compile: 500 classes + 250 properties', async () => {
  do_not_optimize((await compileFixture()).source.length)
})

await report()
