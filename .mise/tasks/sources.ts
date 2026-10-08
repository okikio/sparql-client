/** Repository source admission for semantic checks, documentation and dependency policy. @module */

import { join } from 'node:path'

/** Maintained source roots. Generated delivery trees and dependency caches are not roots. */
const ROOTS = [
  'packages',
  'conformance',
  'integration',
  'bench',
  'examples',
  '.mise/tasks',
] as const
/** These directory names always denote installed dependencies or task-owned output. */
const OUTPUTS = new Set([
  'node_modules',
  '.git',
  '.tmp',
  '.agents',
  '.deno',
  '.npm',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
  '.coverage',
  '.nyc_output',
  'test-results',
  'playwright-report',
])
/** Copied upstream source is inert data; adapted harnesses outside these roots remain checked. */
const SNAPSHOTS = new Set(['conformance/upstream', 'bench/upstream/sources'])

/**
 * Lists actual maintained TypeScript files once, without following directory or file symlinks.
 *
 * check admits tests, task sources, benchmarks and examples. production admits only package
 * implementation sources for docs and dependency policy. benchmark and conformance admit their
 * owned source roots plus local package metadata; consumers select their measured programs or
 * evidence inputs without a second dependency/output traversal policy. This filters compiler inputs;
 * it does not hide dependencies imported by an admitted source from Deno's semantic checker.
 * Missing maintained roots and unreadable entries fail instead of yielding a partial inventory.
 */
export async function get(
  directory = '.',
  mode: 'check' | 'production' | 'benchmark' | 'conformance' = 'check',
): Promise<string[]> {
  const files: string[] = []
  async function visit(relative: string): Promise<void> {
    if (SNAPSHOTS.has(relative)) return
    const entries = []
    for await (const entry of Deno.readDir(join(directory, relative))) entries.push(entry)
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      if (OUTPUTS.has(entry.name)) continue
      const path = `${relative}/${entry.name}`
      // Installed workspace aliases are symlinks. Never recurse into their targets, and never
      // admit a symlinked compiler entrypoint that can escape the maintained source roots.
      if (entry.isSymlink) continue
      if (entry.isDirectory) await visit(path)
      else if (
        entry.isFile && (
          entry.name.endsWith('.ts') &&
            (mode !== 'production' || !/_(?:test|bench)\.ts$/u.test(entry.name)) ||
          (mode === 'benchmark' || mode === 'conformance') &&
            (entry.name === 'deno.json' || entry.name === 'package.json')
        )
      ) files.push(path)
    }
  }
  const roots = mode === 'production'
    ? ['packages']
    : mode === 'benchmark'
    ? ['packages', 'bench']
    : mode === 'conformance'
    ? ['packages', 'conformance']
    : ROOTS
  for (const root of roots) {
    const info = await Deno.lstat(join(directory, root))
    if (!info.isDirectory || info.isSymlink) {
      throw new TypeError(`Maintained source root must be an owned directory: ${root}`)
    }
    await visit(root)
  }
  return files.sort()
}
