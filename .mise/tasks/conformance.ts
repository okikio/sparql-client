/** Runs all claimed standards profiles and emits machine-readable release evidence. @module */

import { runRdf } from '../../conformance/rdf.ts'
import { runRdfc } from '../../conformance/rdfc.ts'
import { runJsonLd } from '../../conformance/jsonld.ts'
import { runFraming } from '../../conformance/framing.ts'
import { runRdfa } from '../../conformance/rdfa.ts'
import { runMicrodata } from '../../conformance/microdata.ts'
import { type CaseType, report } from '../../conformance/result.ts'
import { source, type SourceIdType } from '../../conformance/source.ts'

const cases = [
  ...await suite('rdf', 'rdf', runRdf),
  ...await suite('canon', 'rdfc', runRdfc),
  ...await suite('jsonld', 'jsonld', runJsonLd),
  ...await suite('framing', 'framing', runFraming),
  ...await suite('rdfa', 'rdfa', runRdfa),
  ...await suite('microdata', 'microdata', runMicrodata),
]
const value = report(cases)
await Deno.mkdir('.tmp/reports', { recursive: true })
await Deno.writeTextFile('.tmp/reports/conformance.json', `${JSON.stringify(value, null, 2)}\n`)
console.log(
  `conformance: ${value.totals.pass} pass, ${value.totals.fail} fail, ${value.totals.skip} skip`,
)
if (value.totals.fail > 0 || value.totals.skip > 0) Deno.exitCode = 1

/**
 * Converts a suite-level runner failure into release evidence instead of aborting the whole report.
 *
 * Individual case runners already normalize test failures. This guard handles failures that occur
 * before a runner can enumerate cases, such as an invalid upstream manifest or a missing pinned
 * checkout. The report therefore still records which suite failed and continues with later suites.
 *
 * This is not a CPU-time isolation mechanism. A synchronous parser loop can still block the realm;
 * true hostile-input deadlines require Worker/process isolation and remain a separate release task.
 */
async function suite(
  sourceId: SourceIdType,
  profile: string,
  run: () => Promise<CaseType[]>,
): Promise<CaseType[]> {
  const started = performance.now()
  try {
    return await run()
  } catch (error) {
    const spec = source(sourceId)
    return [{
      suite: profile,
      revision: spec.revision,
      profile: `${spec.standard} runner`,
      id: `${profile}:runner`,
      kind: 'runner',
      status: 'fail',
      reason: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - started,
    }]
  }
}
