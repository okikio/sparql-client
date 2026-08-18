/** Runs all claimed standards profiles and emits machine-readable release evidence. @module */

import { runRdf } from '../../conformance/rdf.ts'
import { runRdfc } from '../../conformance/rdfc.ts'
import { runJsonLd } from '../../conformance/jsonld.ts'
import { runFraming } from '../../conformance/framing.ts'
import { runRdfa } from '../../conformance/rdfa.ts'
import { runMicrodata } from '../../conformance/microdata.ts'
import { report } from '../../conformance/result.ts'

const cases = [
  ...await runRdf(),
  ...await runRdfc(),
  ...await runJsonLd(),
  ...await runFraming(),
  ...await runRdfa(),
  ...await runMicrodata(),
]
const value = report(cases)
await Deno.mkdir('.tmp/reports', { recursive: true })
await Deno.writeTextFile('.tmp/reports/conformance.json', `${JSON.stringify(value, null, 2)}\n`)
console.log(
  `conformance: ${value.totals.pass} pass, ${value.totals.fail} fail, ${value.totals.skip} skip`,
)
if (value.totals.fail > 0 || value.totals.skip > 0) Deno.exitCode = 1
