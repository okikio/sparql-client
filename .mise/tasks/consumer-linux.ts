/** Executes clean packed-package behavior with bounded, owned Linux container lifetimes. @module */
import * as artifacts from './artifacts.ts'
import * as container from './container.ts'
import { collect } from './command.ts'
import type { OutputType } from './command.ts'
import { resolve } from 'node:path'

const directory = await Deno.realPath('.tmp/consumer')
await artifacts.installed(directory)
// The installed behavior depends on its release scope. Compare both executed
// inputs before Linux runs so a stale helper cannot certify current cleanup.
for (
  const [source, target] of [
    ['integration/consumer.ts', 'behavior.ts'],
    ['integration/releases.ts', 'releases.ts'],
  ] as const
) {
  const current = await Deno.readFile(source)
  const installed = await Deno.readFile(`${directory}/${target}`)
  if (
    current.length !== installed.length ||
    current.some((value, index) => value !== installed[index])
  ) {
    throw new Error(
      `Installed consumer fixture is stale: ${target}. Run deno task consumer before the Linux lane.`,
    )
  }
}
await Deno.stat(`${directory}/behavior.ts`)
const payload = await container.prepare(
  directory,
  (await artifacts.get()).map((path) => resolve(path)),
  '.tmp/packages/artifacts.json',
  [new URL('./consumer-linux.ts', import.meta.url)],
)
/** Independent runtime cases continue after a failure; shared copy ownership is retired afterward. */
const failures: unknown[] = []
try {
  for (
    const [image, command] of [
      ['node:22.18.0-bookworm-slim', ['node', '../worker.mjs']],
      ['node:24.21.0-slim', ['node', '../worker.mjs']],
      ['oven/bun:1.3.14', ['bun', '../worker.mjs']],
      ['denoland/deno:debian-2.9.7', [
        'deno',
        'run',
        '--no-config',
        '--allow-read=/work',
        '--allow-net=127.0.0.1',
        '--node-modules-dir=manual',
        '../worker.mjs',
      ]],
    ] as const
  ) {
    try {
      await container.run(payload, image, command, invoke)
    } catch (error) {
      failures.push(error)
    }
  }
} finally {
  try {
    await payload.verify()
  } catch (error) {
    failures.push(error)
  }
  try {
    await payload.close()
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) {
  throw new AggregateError(failures, 'Packed Linux consumer validation or owned cleanup failed.')
}
console.log('Copied packed Linux behavior passed in Node 22.18, Node 24, Bun 1.3.14, and Deno 2.9.')

/** Shared finite byte capture keeps actual status distinct from deadline/output failures. */
async function invoke(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<OutputType> {
  return await collect(command, args, { cwd: directory, timeoutMs })
}

export {}
