/** Child-process fixture for locale-independent vocabulary compilation. @module */

import { literal, namedNode, quad, RDF } from '../packages/rdf/mod.ts'
import { compile } from '../packages/vocab/compile.ts'

const types = ['urn:ä', 'urn:z', 'urn:a']
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const statements = types.flatMap((iri) => [
  quad(namedNode(iri), namedNode(RDF.type), namedNode(`${RDFS}Class`)),
  quad(namedNode(iri), namedNode(`${RDFS}label`), literal('Thing', 'en')),
])
for (const iri of ['urn:property:ä', 'urn:property:z']) {
  statements.push(
    quad(
      namedNode(iri),
      namedNode(RDF.type),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'),
    ),
    quad(namedNode(iri), namedNode(`${RDFS}domain`), namedNode('urn:a')),
    quad(
      namedNode(iri),
      namedNode(`${RDFS}range`),
      namedNode('http://www.w3.org/2001/XMLSchema#string'),
    ),
  )
}
const result = await compile([{ id: 'locale', quads: statements }], {
  vocabulary: 'Locale',
  namespace: 'urn:',
  prefix: 'locale',
})
console.log(JSON.stringify({ locale: new Intl.Collator().resolvedOptions().locale, result }))
