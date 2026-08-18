/** Synchronizes immutable upstream conformance suite revisions into `.tmp`. @module */

import { dirname } from '@std/path'
import { sourceDir, sources } from '../../conformance/source.ts'

for (const value of sources) await sync(value.id, value.repository, value.revision)

async function sync(
  id: typeof sources[number]['id'],
  repository: string,
  revision: string,
): Promise<void> {
  const dir = sourceDir(id)
  const marker = `${dir}/.revision`
  if (await text(marker) === `${revision}\n`) return
  await Deno.remove(dir, { recursive: true }).catch(() => undefined)
  await Deno.mkdir(dirname(dir), { recursive: true })
  await run(['git', 'init', '--quiet', dir])
  await run(['git', '-C', dir, 'remote', 'add', 'origin', repository])
  await run(['git', '-C', dir, 'fetch', '--quiet', '--depth=1', 'origin', revision])
  await run(['git', '-C', dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'])
  const head = (await command(['git', '-C', dir, 'rev-parse', 'HEAD'])).trim()
  if (head !== revision) {
    throw new Error(`Conformance source ${id} resolved ${head}, expected ${revision}.`)
  }
  await Deno.writeTextFile(marker, `${revision}\n`)
}

async function run(args: readonly string[]): Promise<void> {
  const result = await new Deno.Command(args[0]!, {
    args: [...args.slice(1)],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (!result.success) throw new Error(`Command failed (${result.code}): ${args.join(' ')}`)
}

async function command(args: readonly string[]): Promise<string> {
  const result = await new Deno.Command(args[0]!, {
    args: [...args.slice(1)],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!result.success) throw new Error(`Command failed (${result.code}): ${args.join(' ')}`)
  return new TextDecoder().decode(result.stdout)
}

async function text(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}
