/** Selects human or machine-readable Mitata output without changing benchmark definitions. @module */

import { run } from 'mitata'

/** Run measured cases, or return after their real fixture oracles in explicit preflight mode. */
export async function report(): Promise<void> {
  if (Deno.env.get('BENCH_PREFLIGHT_ONLY') === '1') {
    console.log('Benchmark correctness preflight passed; no timings collected.')
    return
  }
  if (Deno.env.get('BENCH_FORMAT') === 'json') await run({ format: 'json', throw: true })
  else await run({ throw: true })
}
