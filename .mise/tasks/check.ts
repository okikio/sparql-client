/** Runs semantic checking over repository-owned sources instead of recursive shell glob aliases. @module */

import { get } from './sources.ts'

const sources = await get()
if (sources.length === 0) throw new Error('Semantic check requires maintained source files.')
const status = await new Deno.Command(Deno.execPath(), {
  args: ['check', ...sources],
  stdin: 'null',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn().status
if (!status.success) throw new Error(`Semantic check failed with exit code ${status.code}.`)
console.log(`Semantic check passed for ${sources.length} repository source files.`)
