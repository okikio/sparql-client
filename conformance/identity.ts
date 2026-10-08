/** Content identity of the implementation, oracle, claims, and pinned configuration. @module */

import { get } from '../.mise/tasks/sources.ts'

/**
 * Hashes inputs whose changes require fresh conformance evidence. Tests and benchmarks do not
 * implement the standard and are excluded; runner/oracle files and package configuration remain
 * included. File paths enter the digest as well, so adding or removing source invalidates evidence.
 */
export async function identity(root = '.'): Promise<string> {
  const paths = [
    ...(await get(root, 'conformance')).filter((path) => !/_(?:test|bench)\.ts$/u.test(path)),
    'deno.json',
    'deno.lock',
    'package.json',
    'support.json',
    '.mise/tasks/conformance.ts',
    '.mise/tasks/conformance-sync.ts',
    '.mise/tasks/support.ts',
    '.mise/tasks/sources.ts',
  ].sort()
  const inputs: Array<readonly [string, string]> = []
  for (const path of paths) {
    inputs.push([path, await digest(await Deno.readFile(`${root}/${path}`))])
  }
  return digest(new TextEncoder().encode(JSON.stringify(inputs)))
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
