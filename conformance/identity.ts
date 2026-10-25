/** Content identity of the implementation, oracle, claims, and pinned configuration. @module */

/**
 * Hashes inputs whose changes require fresh conformance evidence. Tests and benchmarks do not
 * implement the standard and are excluded; runner/oracle files and package configuration remain
 * included. File paths enter the digest as well, so adding or removing source invalidates evidence.
 */
export async function identity(root = '.'): Promise<string> {
  const paths = [
    ...await files(root, 'packages'),
    ...await files(root, 'conformance'),
    'deno.json',
    'deno.lock',
    'package.json',
    'support.json',
    '.mise/tasks/conformance.ts',
    '.mise/tasks/conformance-sync.ts',
    '.mise/tasks/support.ts',
  ].sort()
  const inputs: Array<readonly [string, string]> = []
  for (const path of paths) {
    inputs.push([path, await digest(await Deno.readFile(`${root}/${path}`))])
  }
  return digest(new TextEncoder().encode(JSON.stringify(inputs)))
}

async function files(root: string, directory: string): Promise<string[]> {
  const result: string[] = []
  for await (const entry of Deno.readDir(`${root}/${directory}`)) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory) result.push(...await files(root, path))
    else if (
      entry.isFile && (
        entry.name.endsWith('.ts') && !entry.name.endsWith('_test.ts') &&
          !entry.name.endsWith('_bench.ts') || ['deno.json', 'package.json'].includes(entry.name)
      )
    ) result.push(path)
  }
  return result
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
