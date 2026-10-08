import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { platform } from 'node:process'
import { collect } from './command.ts'
import { fileURLToPath } from 'node:url'
import { approval } from './attest.mjs'
import { finish } from '../../integration/releases.ts'

/** Real gate controls are host POSIX observations, not Docker runtime/capability claims. */
const POSIX = {
  skip: platform === 'win32'
    ? 'POSIX gate mode and alias observations require a supporting host.'
    : false,
}
async function fixture(action: (root: string) => Promise<void>): Promise<void> {
  await finish(async (leases) => {
    const temporary = await Deno.makeTempDir({ prefix: 'attest-control-' })
    leases.push(() => rm(temporary, { recursive: true, force: true }))
    const root = await Deno.realPath(temporary)
    await action(root)
  })
}

/** Expected process identity is independently authored; private approval accepts real fixture owner metadata. */
async function gate(root: string) {
  const directory = join(root, 'gate')
  await mkdir(directory, { mode: 0o700 })
  // Required gate permissions are established on this owned fixture, not inferred from mkdir and umask.
  await chmod(directory, 0o700)
  const identity = await lstat(directory)
  const expected = {
    pid: 123,
    nonce: '01234567-89ab-cdef-0123-456789abcdef',
    role: 'ordinary',
    uid: identity.uid,
    gid: identity.gid,
  }
  return { directory, identity, expected, bytes: `123 ${expected.nonce} ordinary\n` }
}

describe('independent native runtime attestation gate', () => {
  it(
    'retains actual early child failure and retires its private gate without certifying behavior',
    {
      skip: platform !== 'linux'
        ? 'Actual proc supervisor executes only in Linux; portable gate controls remain separate.'
        : false,
    },
    async () => {
      const directory = `/tmp/library-attest-${crypto.randomUUID()}`
      const output = await collect(
        '/bin/sh',
        [
          fileURLToPath(new URL('./attest.sh', import.meta.url)),
          'ordinary',
          directory,
          crypto.randomUUID(),
          '/bin/sh',
          '-c',
          'exit 9',
        ],
        { timeoutMs: 45_000, quotaBytes: 65536 },
      )
      expect(output.code).toBe(76)
      expect(output.signal).toBeNull()
      expect(output.failures).toEqual([])
      expect(output.streams.stdout.complete).toBe(true)
      expect(output.streams.stderr.complete).toBe(true)
      const events = output.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) =>
        JSON.parse(line)
      )
      expect(events).toContainEqual(
        expect.objectContaining({ phase: 'attestation-child', exit: 9 }),
      )
      await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it(
    'admits exact real approval and rejects wrong identity, trailing bytes and oversized data',
    POSIX,
    () =>
      fixture(async (root) => {
        const value = await gate(root)
        for (
          const bytes of [
            value.bytes,
            value.bytes.replace('123 ', '124 '),
            value.bytes.replace('01234567-89ab', '11234567-89ab'),
            value.bytes.replace('ordinary', 'root'),
            value.bytes + '\n',
            'x'.repeat(65536),
          ]
        ) {
          await writeFile(join(value.directory, 'approval'), bytes, { mode: 0o400 })
          await chmod(join(value.directory, 'approval'), 0o400)
          if (bytes === value.bytes) await approval(value.directory, value.identity, value.expected)
          else {await expect(approval(value.directory, value.identity, value.expected)).rejects
              .toThrow()}
          await chmod(join(value.directory, 'approval'), 0o600)
        }
      }),
  )

  it(
    'refuses alias approval without reading or changing its outside byte and mode sentinel',
    POSIX,
    () =>
      fixture(async (root) => {
        const value = await gate(root), outside = join(root, 'outside')
        const bytes = new Uint8Array([0, 255, 128, 13, 10])
        await writeFile(outside, bytes, { mode: 0o640 })
        await chmod(outside, 0o640)
        await symlink(outside, join(value.directory, 'approval'))
        await expect(approval(value.directory, value.identity, value.expected)).rejects.toThrow()
        expect(new Uint8Array(await readFile(outside))).toEqual(bytes)
        expect((await lstat(outside)).mode & 0o777).toBe(0o640)
      }),
  )

  it(
    'refuses a substituted physical gate even when replacement owner and modes match',
    POSIX,
    () =>
      fixture(async (root) => {
        const value = await gate(root)
        await rename(value.directory, join(root, 'acquired'))
        await mkdir(value.directory, { mode: 0o700 })
        await chmod(value.directory, 0o700)
        await writeFile(join(value.directory, 'approval'), value.bytes, { mode: 0o400 })
        await expect(approval(value.directory, value.identity, value.expected)).rejects.toThrow()
        expect(await readFile(join(value.directory, 'approval'), 'utf8')).toBe(value.bytes)
        expect((await lstat(value.directory)).mode & 0o777).toBe(0o700)
      }),
  )
})
