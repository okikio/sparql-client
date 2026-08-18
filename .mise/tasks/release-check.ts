/** Runs the complete release-readiness DAG in an explicit, reviewable order. @module */

const tasks = [
  'verify',
  'conformance:sync',
  'conformance',
  'support',
  'integration',
  'package',
  'distribution',
  'consumer',
  'bench:report',
  'bench:types',
] as const
for (const task of tasks) {
  console.log(`\n## deno task ${task}`)
  const child = new Deno.Command(Deno.execPath(), {
    args: ['task', task],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  if (!status.success) {
    throw new Error(`Release gate '${task}' failed with exit code ${status.code}.`)
  }
}
console.log('\nAll release gates passed.')
export {}
