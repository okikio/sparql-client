import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { checkCache } from '../conformance/cache.ts'

/** Commands operate only on a newly created disposable checkout, never a workspace Git index. */
async function git(directory: string, args: readonly string[]): Promise<string> {
  const result = await new Deno.Command('git', {
    args: ['-C', directory, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

describe('pinned conformance checkout', () => {
  it('compares actual pinned blobs, including hidden index edits and symlink targets', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'upstream-cache-control-' })
    try {
      await git(directory, ['init', '--quiet'])
      await Deno.writeTextFile(`${directory}/fixture.ttl`, '<urn:s> <urn:p> <urn:o> .')
      await Deno.symlink('fixture.ttl', `${directory}/alias.ttl`)
      await git(directory, ['add', 'fixture.ttl', 'alias.ttl'])
      await git(directory, [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ])
      const revision = await git(directory, ['rev-parse', 'HEAD'])
      await Deno.writeTextFile(`${directory}/.revision`, `${revision}\n`)
      await checkCache(directory, revision)
      await expect(checkCache(directory, '0'.repeat(40))).rejects.toBeInstanceOf(Error)
      await Deno.writeTextFile(`${directory}/fixture.ttl`, '<urn:s> <urn:wrong> <urn:o> .')
      await expect(checkCache(directory, revision)).rejects.toBeInstanceOf(Error)
      await git(directory, ['restore', 'fixture.ttl'])
      await Deno.writeTextFile(`${directory}/extra.jsonld`, '{}')
      await expect(checkCache(directory, revision)).rejects.toBeInstanceOf(Error)
      await Deno.remove(`${directory}/extra.jsonld`)
      await checkCache(directory, revision)
      await git(directory, ['update-index', '--assume-unchanged', 'fixture.ttl'])
      const changed = '<urn:s> <urn:wrong> <urn:o> .'
      await Deno.writeTextFile(`${directory}/fixture.ttl`, changed)
      expect(await git(directory, ['diff', '--name-only'])).toBe('')
      await expect(checkCache(directory, revision)).rejects.toBeInstanceOf(AggregateError)
      expect(await Deno.readTextFile(`${directory}/fixture.ttl`)).toBe(changed)
      await git(directory, ['update-index', '--no-assume-unchanged', 'fixture.ttl'])
      await git(directory, ['restore', 'fixture.ttl'])
      await checkCache(directory, revision)
      await git(directory, ['update-index', '--assume-unchanged', 'alias.ttl'])
      await Deno.remove(`${directory}/alias.ttl`)
      await Deno.symlink('wrong.ttl', `${directory}/alias.ttl`)
      await expect(checkCache(directory, revision)).rejects.toBeInstanceOf(AggregateError)
      expect(await Deno.readLink(`${directory}/alias.ttl`)).toBe('wrong.ttl')
      await git(directory, ['update-index', '--no-assume-unchanged', 'alias.ttl'])
      await git(directory, ['restore', 'alias.ttl'])
      await checkCache(directory, revision)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
