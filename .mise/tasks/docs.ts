/** Runs Deno's built-in documentation diagnostics across every production package source file. @module */

import { get } from './sources.ts'

/** Maintained production entrypoints; imported dependencies remain visible to Deno diagnostics. */
const sources = await get('.', 'production')

const child = new Deno.Command(Deno.execPath(), {
  args: ['doc', '--private', '--lint', ...sources],
  stdin: 'null',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()
const status = await child.status
if (!status.success) throw new Error(`Documentation lint failed with exit code ${status.code}.`)
console.log(`Documentation lint passed for ${sources.length} production source files.`)
