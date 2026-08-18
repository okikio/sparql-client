/** Selects human or machine-readable Mitata output without changing benchmark definitions. @module */

import { run } from 'mitata'

/** Runs registered benchmarks and emits JSON when `BENCH_FORMAT=json`. */
export async function report(): Promise<void> {
  if (Deno.env.get('BENCH_FORMAT') === 'json') await run({ format: 'json' })
  else await run()
}
