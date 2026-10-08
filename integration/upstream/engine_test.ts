/** Real engine-adapter scenarios adapted from pinned Oxigraph/Comunica tests; see upstream provenance. @module */

import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { expectQuads, expectTerm } from '../../bench/oracle.ts'
import type { EngineType } from '../../bench/upstream/engines.ts'
import { openEngine } from '../../bench/upstream/engines.ts'
import { DATA, named, QUERIES } from '../../bench/upstream/queries.ts'

/** Keeps assertion/acquisition failures distinct from owned engine cleanup failures. */
async function use(
  kind: 'Oxigraph' | 'Comunica',
  body: (engine: EngineType) => Promise<void>,
): Promise<void> {
  const engine = openEngine(kind, DATA)
  const failures: unknown[] = []
  try {
    await body(engine)
  } catch (error) {
    failures.push(error)
  }
  try {
    engine.close()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Upstream engine scenario or cleanup failed')
  }
}

for (const kind of ['Oxigraph', 'Comunica'] as const) {
  describe(`upstream real ${kind} adapter scenarios`, () => {
    it('Oxigraph ASK true and ASK false preserve exact boolean results', async () => {
      await use(kind, async (engine) => {
        expect(await engine.client.queryBoolean('ASK { ?s ?s ?s }')).toBe(true)
        expect(await engine.client.queryBoolean('ASK { FILTER(false)}')).toBe(false)
      })
    })
    for (const scenario of QUERIES) {
      it(scenario.id, async () => {
        await use(kind, async (engine) => {
          const rows = []
          for await (const row of await engine.client.queryBindings(scenario.query)) rows.push(row)
          expect(rows).toHaveLength(scenario.rows.length)
          for (let index = 0; index < rows.length; index++) {
            const actual = rows[index]!
            const expected = scenario.rows[index]!
            expect([...actual.keys()].sort()).toEqual(Object.keys(expected).sort())
            for (const [key, term] of Object.entries(expected)) {
              expectTerm(actual.get(key), term, scenario.id)
            }
          }
        })
      })
    }
    it('Oxigraph CONSTRUCT emits only default graph triples without named graph leakage', async () => {
      await use(kind, async (engine) => {
        const output = []
        for await (
          const value of await engine.client.queryQuads('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')
        ) output.push(value)
        const graph = { termType: 'DefaultGraph', value: '' }
        expectQuads(output, [
          {
            subject: named('http://example.com'),
            predicate: named('http://example.com'),
            object: named('http://example.com'),
            graph,
          },
          { subject: named('urn:s1'), predicate: named('urn:p'), object: named('urn:s1'), graph },
          { subject: named('urn:s2'), predicate: named('urn:p'), object: named('urn:o2'), graph },
        ], 'default graph CONSTRUCT')
      })
    })
    it('Oxigraph INSERT DATA and DELETE WHERE mutate only the selected named graph', async () => {
      await use(kind, async (engine) => {
        await engine.client.update(
          'INSERT DATA { GRAPH <urn:added> { <urn:new> <urn:p> "added" } }',
        )
        expect(
          await engine.client.queryBoolean(
            'ASK { GRAPH <urn:added> { <urn:new> <urn:p> "added" } }',
          ),
        ).toBe(true)
        await engine.client.update('DELETE WHERE { GRAPH <urn:added> { ?s ?p ?o } }')
        expect(await engine.client.queryBoolean('ASK { GRAPH <urn:added> { ?s ?p ?o } }')).toBe(
          false,
        )
        expect(
          await engine.client.queryBoolean('ASK { GRAPH <urn:g1> { <urn:s1> <urn:p> <urn:o1> } }'),
        ).toBe(true)
      })
    })
  })
}
