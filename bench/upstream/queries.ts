/** Literal upstream query scenarios with independent expected term records. @module */

/** Oxigraph ex/ex2 fixture plus Comunica repeated-variable and named-graph fixtures, with absolute urn IRIs. */
export const DATA = `<http://example.com> <http://example.com> <http://example.com> .
<http://example.com> <http://example.com> <http://example.com> <http://example.com> .
<http://example.com> <http://example.com> <http://example.com> <http://example.com/2> .
<urn:s1> <urn:p> <urn:s1> .
<urn:s2> <urn:p> <urn:o2> .
<urn:s1> <urn:p> <urn:o1> <urn:g1> .
<urn:s2> <urn:p> <urn:o2> <urn:g2> .
<urn:s3> <urn:px> <urn:o3> <urn:g3> .
`

/** Plain expected RDF/JS identity, independent of either engine or native term factory. */
export const named = (value: string): { readonly termType: string; readonly value: string } => ({
  termType: 'NamedNode',
  value,
})

/** Bounded query selection from Oxigraph store.test.ts and Comunica QuerySourceRdfJs-test.ts. */
export const QUERIES = [
  {
    id: 'oxigraph-select',
    query: 'SELECT ?s WHERE { ?s <http://example.com> ?o }',
    rows: [{ s: named('http://example.com') }],
  },
  {
    id: 'comunica-repeated-variable',
    query: 'SELECT ?s WHERE { ?s <urn:p> ?s }',
    rows: [{ s: named('urn:s1') }],
  },
  {
    id: 'comunica-named-graph',
    query: 'SELECT ?s ?o WHERE { GRAPH <urn:g1> { ?s <urn:p> ?o } }',
    rows: [{ s: named('urn:s1'), o: named('urn:o1') }],
  },
] as const
