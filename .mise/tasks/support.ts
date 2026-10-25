/** Checks claims against validated, current conformance source and pinned revisions. @module */
import { identity } from '../../conformance/identity.ts'
import { sources } from '../../conformance/source.ts'
import { validateSupport } from '../../conformance/support.ts'

const support: unknown = JSON.parse(await Deno.readTextFile('support.json'))
const report: unknown = JSON.parse(await Deno.readTextFile('.tmp/reports/conformance.json'))
const errors = validateSupport(support, report, {
  inputs: await identity(),
  revisions: Object.fromEntries(sources.map(({ id, revision }) => [id, revision])),
  profiles: {
    'ntriples-1.2': 'rdf',
    'nquads-1.2': 'rdf',
    'turtle-1.2': 'rdf',
    'trig-1.2': 'rdf',
    'rdfxml-1.2': 'rdf',
    'RDFC-1.0': 'canon',
    'JSON-LD 1.1 expand': 'jsonld',
    'JSON-LD 1.1 compact': 'jsonld',
    'JSON-LD 1.1 flatten': 'jsonld',
    'JSON-LD 1.1 toRdf': 'jsonld',
    'JSON-LD 1.1 fromRdf': 'jsonld',
    'JSON-LD 1.1 Framing': 'framing',
    'RDFa 1.1 html5': 'rdfa',
    'RDFa 1.1 xhtml5': 'rdfa',
    'RDFa 1.1 svg': 'rdfa',
    'RDFa 1.1 xml': 'rdfa',
    'Microdata to RDF': 'microdata',
  },
})
if (errors.length) {
  throw new Error(
    `Support evidence is incomplete:\n${errors.map((value) => `- ${value}`).join('\n')}`,
  )
}
console.log('Verified support profiles against current conformance evidence.')
