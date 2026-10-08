/** Native benchmark provenance excludes unrelated tests and the separately measured compiler lane. @module */
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { references } from '../../conformance/modules.ts'
import { get } from './sources.ts'

/** Fixed runtime/configuration and conservative preparation inputs; fixtures acquire this authority without a second list. */
export const INPUTS = Object.freeze(
  [
    'deno.json',
    'deno.lock',
    'package.json',
    '.mise/tasks/bench-report.ts',
    '.mise/tasks/benchmarks.ts',
    '.mise/tasks/bench.ts',
    '.mise/tasks/bench-identity.ts',
    '.mise/tasks/bench-command.ts',
    // Copied Linux preparation authority is conservative support, not a native operation workload.
    '.mise/tasks/attest.sh',
    '.mise/tasks/attest.mjs',
    '.mise/tasks/sources.ts',
    'conformance/query.ts',
    'conformance/modules.ts',
    'conformance/ownership.ts',
  ] as const,
)

/** Hash runtime source, native workload definitions and their command/configuration authority. */
export async function identity(root = '.'): Promise<Readonly<Record<string, string>>> {
  const paths: string[] = [...INPUTS]
  // Store recovery executes the test-only memory fixture. Other test files and
  // the independently measured compiler lane do not enter native runtime evidence.
  paths.push(
    ...(await get(root, 'benchmark')).filter((path) =>
      !path.endsWith('_test.ts') &&
      path !== 'bench/vocab/types.ts' && path !== 'bench/vocab/diagnostics.ts' &&
      path !== 'bench/vocab/compiler.ts' &&
      path !== 'bench/vocab/workload.ts'
    ),
  )
  // Follow actual relative runtime imports from selected native programs and task authority.
  // This admits imported test fixtures while leaving unrelated test programs out of provenance.
  const admitted = new Set([...(await get(root, 'check')), ...paths])
  const measured = new Set(paths)
  const queue = paths.filter((path) =>
    path.startsWith('.mise/tasks/') || path.endsWith('_bench.ts')
  )
  const inspected = new Set<string>()
  while (queue.length) {
    const path = queue.pop()!
    if (inspected.has(path) || !path.endsWith('.ts')) continue
    inspected.add(path)
    for (const reference of references(await Deno.readTextFile(join(root, path)), path)) {
      if (reference.kind === 'type') continue
      if (!reference.specifier) {
        // The generated-vocabulary probe imports its freshly emitted owned data URI.
        // Its generator source and probe authority are hashed, and its semantic oracle validates output.
        if (path === 'bench/vocab/consumer.ts') continue
        throw new TypeError(`Unresolved runtime import in measured source: ${path}`)
      }
      if (!reference.specifier.startsWith('./') && !reference.specifier.startsWith('../')) continue
      const target = fileURLToPath(new URL(reference.specifier, pathToFileURL(resolve(root, path))))
      const local = relative(resolve(root), target).split(sep).join('/')
      if (!admitted.has(local)) {
        throw new TypeError(
          `Measured runtime import is outside owned source admission: ${path} -> ${local}`,
        )
      }
      measured.add(local)
      queue.push(local)
    }
  }
  const result: Record<string, string> = {}
  for (const path of [...measured].sort()) {
    const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(join(root, path)))
    result[path] = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  return result
}

/** A changed measured dependency/configuration invalidates collected timings. */
export function assertStable(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): void {
  const keys = Object.keys(before).sort()
  const current = Object.keys(after).sort()
  if (
    keys.length !== current.length ||
    keys.some((key, index) => key !== current[index] || before[key] !== after[key])
  ) {
    throw new Error('Source or dependency inputs changed during measurement. Discard timings.')
  }
}
