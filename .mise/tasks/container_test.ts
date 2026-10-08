import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepare, run, tree } from './container.ts'
import { finish } from '../../integration/releases.ts'
import { admit } from './container-worker.mjs'
import type { ObservationType, OutputType } from './container.ts'

/** Aggregate nesting is not a contract; independent original reasons must all survive. */
function reasons(value: unknown): unknown[] {
  return value instanceof AggregateError ? value.errors.flatMap(reasons) : [value]
}

/** These host observations need POSIX modes and link privileges; Linux admission and portable byte controls are separate. */
const POSIX = {
  skip: Deno.build.os === 'windows'
    ? 'Host POSIX mode/link controls; Linux admission remains mandatory'
    : false,
}

/** Real filesystem controls exercise copy identity; Docker command ownership uses injected daemon outcomes. */
describe('private packed consumer copy', () => {
  it('copies portable binary bytes and independently declares Linux metadata without inventing host identity', () =>
    finish(async (release) => {
      const root = await Deno.makeTempDir({ prefix: 'consumer-copy-portable-' })
      release.push(() => Deno.remove(root, { recursive: true }))
      const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
      await Deno.mkdir(installed)
      const bytes = new Uint8Array([0, 255, 128, 254, 13, 10])
      await Deno.writeFile(join(installed, 'binary'), bytes)
      await Deno.writeTextFile(receipt, '{}')
      const before = await tree(installed)
      const payload = await prepare(installed, [], receipt, [], join(root, 'reports'))
      release.push(() => payload.close())
      expect(await Deno.readFile(join(payload.directory, 'consumer/binary'))).toEqual(bytes)
      expect(await tree(installed)).toEqual(before)
      const admitted = payload.entries.find((entry) => entry.path === 'consumer/binary')!
      expect(admitted.mode).toBe(0o444)
      expect(admitted.uid).toBe(0)
      expect(admitted.gid).toBe(0)
      expect(payload.inputs).toEqual(before)
      await payload.verify()
      expect(JSON.parse(await Deno.readTextFile(payload.receipt)).taskInputs).toHaveLength(3)
      await payload.record({
        command: ['fixture', 'exact-arguments'],
        timeoutMs: 30_000,
        outcome: 'complete',
        output: {
          code: 7,
          signal: null,
          success: false,
          stdout: '',
          stderr: '',
          streams: {
            stdout: {
              quotaBytes: 32 * 1024 * 1024,
              observedBytes: bytes.length,
              complete: true,
              bytes,
            },
            stderr: {
              quotaBytes: 32 * 1024 * 1024,
              observedBytes: 0,
              complete: true,
              bytes: new Uint8Array(),
            },
          },
          failures: [{ stage: 'deadline', reason: undefined }],
        },
      })
      const recorded = join(dirname(payload.receipt), 'cli-001')
      expect(await Deno.readFile(join(recorded, 'stdout.bin'))).toEqual(bytes)
      const observation = JSON.parse(await Deno.readTextFile(join(recorded, 'observation.json')))
      expect(observation).toMatchObject({
        command: ['fixture', 'exact-arguments'],
        outcome: 'complete',
        code: 7,
        signal: null,
        success: false,
        streams: { stdout: { saved: true, bytes: bytes.length, complete: true } },
        captureFailures: [{ stage: 'deadline', reason: { kind: 'undefined' } }],
      })
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      expect(observation.streams.stdout.sha256).toBe(
        Array.from(digest, (part) => part.toString(16).padStart(2, '0')).join(''),
      )
      await payload.verify()
    }))

  it(
    'retires Windows copies of readonly sources without changing the original bytes or readonly attribute',
    { skip: Deno.build.os !== 'windows' ? 'Windows readonly-attribute behavior' : false },
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-windows-readonly-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
        await Deno.mkdir(installed)
        const source = join(installed, 'readonly.bin'), bytes = new Uint8Array([0, 255, 128, 17])
        await Deno.writeFile(source, bytes)
        await Deno.chmod(source, 0o444)
        // The test owns the readonly source fixture and restores it only after copy/retirement assertions.
        release.push(() => Deno.chmod(source, 0o600))
        await Deno.writeTextFile(receipt, '{}')
        const writable = (path: string): Promise<void> =>
          finish(async (close) => {
            const file = await Deno.open(path, { write: true })
            close.push(() => file.close())
          })
        await expect(writable(source)).rejects.toBeInstanceOf(Deno.errors.PermissionDenied)
        const before = await tree(installed)
        const payload = await prepare(installed, [], receipt, [], join(root, 'reports'))
        release.push(() => payload.close())
        expect(await Deno.readFile(join(payload.directory, 'consumer/readonly.bin'))).toEqual(bytes)
        await writable(join(payload.directory, 'consumer/readonly.bin'))
        await writable(join(payload.directory, 'worker.mjs'))
        await payload.verify()
        await payload.close()
        await expect(Deno.lstat(payload.directory)).rejects.toBeInstanceOf(Deno.errors.NotFound)
        expect(await tree(installed)).toEqual(before)
        expect(await Deno.readFile(source)).toEqual(bytes)
        await expect(writable(source)).rejects.toBeInstanceOf(Deno.errors.PermissionDenied)
      }),
  )

  it(
    'copies exact binary/archive/receipt bytes, rebases contained links and protects only owned modes',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-test-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed')
        await Deno.mkdir(join(installed, 'nested'), { recursive: true })
        const bytes = new Uint8Array([0, 255, 128, 13, 10])
        await Deno.writeFile(join(installed, 'nested/data'), bytes, { mode: 0o644 })
        await Deno.writeTextFile(join(installed, 'behavior.ts'), 'export {}\n', { mode: 0o755 })
        await Deno.symlink(join(installed, 'nested/data'), join(installed, 'alias'))
        const archive = join(root, 'package.tgz'), receipt = join(root, 'artifacts.json')
        await Deno.writeFile(archive, bytes)
        await Deno.writeTextFile(receipt, '{"archives":["independent fixture"]}\n')
        const before = await tree(installed)
        const payload = await prepare(installed, [archive], receipt, [], join(root, 'reports'))
        release.push(() => payload.close())
        expect(await Deno.readFile(join(payload.directory, 'consumer/nested/data'))).toEqual(bytes)
        expect(await Deno.readFile(join(payload.directory, 'archives/0.tgz'))).toEqual(bytes)
        expect(await Deno.readTextFile(join(payload.directory, 'archives/artifacts.json'))).toBe(
          await Deno.readTextFile(receipt),
        )
        expect(await Deno.readLink(join(payload.directory, 'consumer/alias'))).toBe('nested/data')
        expect((await Deno.stat(join(payload.directory, 'consumer/nested/data'))).mode! & 0o777)
          .toBe(
            0o444,
          )
        expect((await Deno.stat(join(payload.directory, 'consumer/behavior.ts'))).mode! & 0o777)
          .toBe(
            0o555,
          )
        expect(await tree(installed)).toEqual(before)
        await payload.verify()
      }),
  )

  it(
    'accepts source hardlinks as byte inputs but creates independent copied files and detects original mutations',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-links-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'one'), 'value')
        await Deno.link(join(installed, 'one'), join(installed, 'two'))
        const receipt = join(root, 'receipt.json')
        await Deno.writeTextFile(receipt, '{}')
        const payload = await prepare(installed, [], receipt, [], join(root, 'reports'))
        release.push(() => payload.close())
        expect((await Deno.stat(join(payload.directory, 'consumer/one'))).nlink).toBe(1)
        expect((await Deno.stat(join(payload.directory, 'consumer/two'))).nlink).toBe(1)
        await Deno.writeTextFile(join(installed, 'one'), 'changed')
        await expect(payload.verify()).rejects.toThrow()
        expect(await Deno.readTextFile(join(payload.directory, 'consumer/two'))).toBe('value')
      }),
  )

  it(
    'rejects escaped or dangling aliases and Git metadata before granting copy authority',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-escape-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(root, 'outside'), 'outside')
        await Deno.symlink('../outside', join(installed, 'alias'))
        await expect(tree(installed)).rejects.toThrow(TypeError)
        await Deno.remove(join(installed, 'alias'))
        await Deno.symlink('missing', join(installed, 'alias'))
        await expect(tree(installed)).rejects.toThrow(Deno.errors.NotFound)
        await Deno.remove(join(installed, 'alias'))
        await Deno.mkdir(join(installed, '.git'))
        await expect(tree(installed)).rejects.toThrow(TypeError)
      }),
  )

  it(
    'rejects extra, missing, writable or substituted copied entries and changed borrowed receipts/tasks',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-mutations-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'data'), 'expected')
        const receipt = join(root, 'receipt.json'), authority = join(root, 'task.ts')
        await Deno.writeTextFile(receipt, '{}')
        await Deno.writeTextFile(authority, 'export {}')
        const payload = await prepare(
          installed,
          [],
          receipt,
          [pathToFileURL(authority)],
          join(root, 'reports'),
        )
        release.push(() => payload.close())
        const copied = join(payload.directory, 'consumer/data')
        const directoryMode = (await Deno.lstat(join(payload.directory, 'consumer'))).mode! & 0o777
        await Deno.chmod(copied, 0o644)
        await expect(payload.verify()).rejects.toThrow()
        await Deno.chmod(copied, 0o444)
        await Deno.chmod(join(payload.directory, 'consumer'), 0o755)
        await Deno.writeTextFile(join(payload.directory, 'consumer/extra'), 'extra')
        await expect(payload.verify()).rejects.toThrow()
        await Deno.remove(join(payload.directory, 'consumer/extra'))
        await Deno.remove(copied)
        await expect(payload.verify()).rejects.toThrow()
        await Deno.writeTextFile(copied, 'expected', { mode: 0o444 })
        await Deno.chmod(join(payload.directory, 'consumer'), directoryMode)
        await payload.verify()
        const retained = await Deno.readTextFile(payload.receipt)
        await Deno.writeTextFile(payload.receipt, '{"substituted":true}')
        await expect(payload.verify()).rejects.toThrow()
        await Deno.writeTextFile(payload.receipt, retained)
        await payload.verify()
        await Deno.writeTextFile(receipt, '{"changed":true}')
        await expect(payload.verify()).rejects.toThrow()
        await Deno.writeTextFile(receipt, '{}')
        await Deno.writeTextFile(authority, 'export const changed = true')
        await expect(payload.verify()).rejects.toThrow()
      }),
  )

  it(
    'rejects hardlink reuse in the owned destination even when bytes match',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-target-alias-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'data'), 'same')
        await Deno.writeTextFile(receipt, '{}')
        const payload = await prepare(installed, [], receipt, [], join(root, 'reports'))
        release.push(() => payload.close())
        await Deno.chmod(join(payload.directory, 'consumer'), 0o755)
        await Deno.link(
          join(payload.directory, 'consumer/data'),
          join(payload.directory, 'consumer/reuse'),
        )
        await expect(payload.verify()).rejects.toThrow(TypeError)
      }),
  )

  it('shares pending and settled cleanup authority instead of hiding an earlier rejection', () =>
    finish(async (release) => {
      const root = await Deno.makeTempDir({ prefix: 'consumer-copy-close-' })
      release.push(() => Deno.remove(root, { recursive: true }))
      const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
      await Deno.mkdir(installed)
      await Deno.writeTextFile(join(installed, 'data'), 'borrowed')
      await Deno.writeTextFile(receipt, '{}')
      const before = await tree(installed)
      const first = await prepare(installed, [], receipt, [], join(root, 'reports'))
      release.push(() => first.close())
      const closing = first.close()
      expect(first.close()).toBe(closing)
      await closing
      expect(first.close()).toBe(closing)
      await expect(Deno.stat(first.directory)).rejects.toBeInstanceOf(Deno.errors.NotFound)
      expect(await tree(installed)).toEqual(before)

      // Moving only the owned directory makes native retirement fail without a global API mock.
      const second = await prepare(installed, [], receipt, [], join(root, 'reports'))
      let location = second.directory
      release.push(() =>
        // Once renamed, the test owns that moved copy independently of failed original-path retirement.
        location === second.directory ? second.close() : Deno.remove(location, { recursive: true })
      )
      const moved = `${second.directory}-moved`
      await Deno.rename(second.directory, moved)
      location = moved
      const failed = second.close()
      expect(second.close()).toBe(failed)
      let failure: unknown
      try {
        await failed
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(second.close()).toBe(failed)
      await expect(second.close()).rejects.toBe(failure)
      expect(await tree(installed)).toEqual(before)
    }))

  it('retires actual fixture and payload paths after a throwing body while preserving independent cleanup failures', async () => {
    for (const primary of [undefined, new Error('fixture body')]) {
      const cleanup = new Error('independent retirement')
      let root: string | undefined, copied: string | undefined
      let failure: unknown
      try {
        await finish(async (release) => {
          root = await Deno.makeTempDir({ prefix: 'consumer-copy-scope-' })
          const fixture = root
          release.push(() => Deno.remove(fixture, { recursive: true }))
          const installed = join(fixture, 'installed'), receipt = join(fixture, 'receipt.json')
          await Deno.mkdir(installed)
          await Deno.writeTextFile(join(installed, 'data'), 'owned fixture')
          await Deno.writeTextFile(receipt, '{}')
          const payload = await prepare(installed, [], receipt, [], join(fixture, 'reports'))
          release.push(() => payload.close())
          copied = payload.directory
          release.push(() => {
            throw cleanup
          })
          throw primary
        })
      } catch (error) {
        failure = error
      }
      expect(reasons(failure)).toEqual([primary, cleanup])
      expect(root).toBeDefined()
      expect(copied).toBeDefined()
      await expect(Deno.stat(root!)).rejects.toBeInstanceOf(Deno.errors.NotFound)
      await expect(Deno.stat(copied!)).rejects.toBeInstanceOf(Deno.errors.NotFound)
    }
  })

  it(
    'refuses substituted root links, files and directories without changing outside modes or bytes',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-root-authority-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'data'), 'input')
        await Deno.writeTextFile(receipt, '{}')
        const outside = join(root, 'outside')
        await Deno.mkdir(outside, { mode: 0o750 })
        const sentinel = join(outside, 'sentinel')
        const bytes = new Uint8Array([19, 0, 255, 23])
        await Deno.writeFile(sentinel, bytes, { mode: 0o640 })
        const directoryMode = (await Deno.lstat(outside)).mode! & 0o777
        const fileMode = (await Deno.lstat(sentinel)).mode! & 0o777
        for (const kind of ['link', 'file', 'directory', 'marker'] as const) {
          const parent = join(root, `stage-${kind}`)
          await Deno.mkdir(parent)
          // This fixture owns the entire parent namespace, including copies deliberately refused by close.
          const payload = await prepare(installed, [], receipt, [], join(root, 'reports'), parent)
          const original = `${payload.directory}-original`
          if (kind === 'marker') {
            await Deno.remove(join(payload.directory, 'ownership.json'))
            await Deno.symlink(sentinel, join(payload.directory, 'ownership.json'))
          } else await Deno.rename(payload.directory, original)
          if (kind === 'link') await Deno.symlink(outside, payload.directory)
          else if (kind === 'file') await Deno.writeFile(payload.directory, bytes, { mode: 0o640 })
          else if (kind === 'directory') {
            await Deno.mkdir(payload.directory, { mode: 0o750 })
            await Deno.writeFile(join(payload.directory, 'replacement'), bytes, { mode: 0o640 })
          }
          await expect(payload.verify()).rejects.toBeInstanceOf(Error)
          const failed = payload.close()
          await expect(failed).rejects.toBeInstanceOf(Error)
          expect(payload.close()).toBe(failed)
          expect((await Deno.lstat(outside)).mode! & 0o777).toBe(directoryMode)
          expect((await Deno.lstat(sentinel)).mode! & 0o777).toBe(fileMode)
          expect(await Deno.readFile(sentinel)).toEqual(bytes)
          expect((await Deno.lstat(kind === 'marker' ? payload.directory : original)).isDirectory)
            .toBe(true)
          if (kind === 'link') expect((await Deno.lstat(payload.directory)).isSymlink).toBe(true)
          else if (kind === 'file') expect(await Deno.readFile(payload.directory)).toEqual(bytes)
          else if (kind === 'directory') {
            expect(await Deno.readFile(join(payload.directory, 'replacement'))).toEqual(bytes)
          } else {expect(await Deno.readTextFile(join(payload.directory, 'consumer/data'))).toBe(
              'input',
            )}
        }
      }),
  )

  it(
    'refuses changed canonical or physical parent authority even when the acquired root remains intact',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-parent-authority-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'data'), 'input')
        await Deno.writeTextFile(receipt, '{}')
        for (const kind of ['link', 'directory'] as const) {
          const parent = join(root, `stage-${kind}`),
            moved = `${parent}-original`,
            outside = `${parent}-outside`
          await Deno.mkdir(parent)
          await Deno.mkdir(outside, { mode: 0o750 })
          const sentinel = join(outside, 'sentinel'), bytes = new Uint8Array([29, 0, 255])
          await Deno.writeFile(sentinel, bytes, { mode: 0o640 })
          const mode = (await Deno.lstat(outside)).mode! & 0o777
          const payload = await prepare(installed, [], receipt, [], join(root, 'reports'), parent)
          const name = basename(payload.directory)
          await Deno.rename(parent, moved)
          if (kind === 'link') await Deno.symlink(outside, parent)
          else {
            await Deno.mkdir(parent, { mode: 0o750 })
            // Preserve the acquired root's own inode/canonical path; only its parent authority changes.
            await Deno.rename(join(moved, name), payload.directory)
          }
          await expect(payload.verify()).rejects.toBeInstanceOf(Error)
          const failed = payload.close()
          await expect(failed).rejects.toBeInstanceOf(Error)
          expect(payload.close()).toBe(failed)
          expect((await Deno.lstat(outside)).mode! & 0o777).toBe(mode)
          expect(await Deno.readFile(sentinel)).toEqual(bytes)
          const owned = kind === 'link' ? join(moved, name) : payload.directory
          expect(await Deno.readTextFile(join(owned, 'consumer/data'))).toBe('input')
        }
      }),
  )

  it(
    'refuses replaced retained report roots and parents before reading or writing borrowed namespaces',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-report-authority-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'), receipt = join(root, 'receipt.json')
        await Deno.mkdir(installed)
        await Deno.writeTextFile(join(installed, 'data'), 'input')
        await Deno.writeTextFile(receipt, '{}')
        const event: ObservationType = {
          command: ['fixture'],
          timeoutMs: 30_000,
          outcome: 'rejected',
          reason: null,
        }
        for (
          const kind of ['root-link', 'root-directory', 'parent-link', 'parent-directory'] as const
        ) {
          const reports = join(root, `reports-${kind}`), outside = join(root, `outside-${kind}`)
          await Deno.mkdir(outside, { mode: 0o750 })
          await Deno.writeFile(join(outside, 'sentinel'), new Uint8Array([0, 255, 17]), {
            mode: 0o640,
          })
          const before = await tree(outside)
          const payload = await prepare(installed, [], receipt, [], reports)
          release.push(() => payload.close())
          const report = dirname(payload.receipt)
          if (kind.startsWith('root-')) {
            const nonce = await Deno.readTextFile(join(report, 'ownership.json'))
            const admitted = await Deno.readTextFile(payload.receipt)
            await Deno.rename(report, `${report}-original`)
            if (kind === 'root-link') await Deno.symlink(outside, report)
            else {
              // Equal receipt/nonce bytes must not confer observable original physical identity.
              await Deno.mkdir(report, { mode: 0o750 })
              await Deno.writeTextFile(join(report, 'ownership.json'), nonce, { mode: 0o444 })
              await Deno.writeTextFile(payload.receipt, admitted)
            }
          } else {
            await Deno.rename(reports, `${reports}-original`)
            if (kind === 'parent-link') await Deno.symlink(outside, reports)
            else {
              await Deno.mkdir(reports, { mode: 0o750 })
              // Keep the report root itself intact and in the same canonical pathname.
              await Deno.rename(join(`${reports}-original`, basename(report)), report)
            }
          }
          const namespace = await tree(
            kind.endsWith('-link') ? outside : kind.startsWith('root-') ? report : reports,
          )
          await expect(payload.verify()).rejects.toBeInstanceOf(Error)
          await expect(payload.record(event)).rejects.toBeInstanceOf(Error)
          expect(await tree(outside)).toEqual(before)
          expect(
            await tree(
              kind.endsWith('-link') ? outside : kind.startsWith('root-') ? report : reports,
            ),
          ).toEqual(namespace)
        }
      }),
  )

  it(
    'retires the exact daemon even when real retained report admission fails after create',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-report-daemon-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'),
          receipt = join(root, 'receipt.json'),
          outside = join(root, 'outside')
        await Deno.mkdir(installed)
        await Deno.mkdir(outside, { mode: 0o750 })
        await Deno.writeFile(join(outside, 'sentinel'), new Uint8Array([0, 255]), { mode: 0o640 })
        await Deno.writeTextFile(join(installed, 'data'), 'input')
        await Deno.writeTextFile(receipt, '{}')
        const before = await tree(outside)
        const payload = await prepare(installed, [], receipt, [], join(root, 'reports'))
        release.push(() => payload.close())
        const calls: string[][] = []
        const invoke = async (_command: string, args: readonly string[]): Promise<OutputType> => {
          calls.push([...args])
          if (args[0] === 'create') {
            const report = dirname(payload.receipt)
            await Deno.rename(report, `${report}-original`)
            await Deno.symlink(outside, report)
          }
          return { code: 0, signal: null, success: true, stdout: '', stderr: '' }
        }
        await expect(run(payload, 'image', ['runtime', '../worker.mjs'], invoke)).rejects
          .toBeInstanceOf(AggregateError)
        const name = calls[0]![calls[0]!.indexOf('--name') + 1]!
        expect(calls.filter((args) => args[0] === 'rm')).toEqual([[
          'rm',
          '--force',
          '--volumes',
          name,
        ]])
        expect(calls.some((args) => args[0] === 'cp' || args[0] === 'start')).toBe(false)
        expect(await tree(outside)).toEqual(before)
      }),
  )

  it(
    'rechecks acquired private ownership after create before copying into the daemon',
    POSIX,
    () =>
      finish(async (release) => {
        const root = await Deno.makeTempDir({ prefix: 'consumer-copy-admission-' })
        release.push(() => Deno.remove(root, { recursive: true }))
        const installed = join(root, 'installed'),
          receipt = join(root, 'receipt.json'),
          parent = join(root, 'stage'),
          outside = join(root, 'outside')
        await Deno.mkdir(installed)
        await Deno.mkdir(parent)
        await Deno.mkdir(outside, { mode: 0o750 })
        await Deno.writeFile(join(outside, 'sentinel'), new Uint8Array([0, 255]), { mode: 0o640 })
        await Deno.writeTextFile(join(installed, 'data'), 'input')
        await Deno.writeTextFile(receipt, '{}')
        const before = await tree(outside)
        const payload = await prepare(installed, [], receipt, [], join(root, 'reports'), parent)
        // The fixture owns all refused originals/substitutes inside its stage parent.
        const calls: string[][] = []
        const invoke = async (_command: string, args: readonly string[]): Promise<OutputType> => {
          calls.push([...args])
          if (args[0] === 'create') {
            await Deno.rename(payload.directory, `${payload.directory}-original`)
            await Deno.symlink(outside, payload.directory)
          }
          return { code: 0, signal: null, success: true, stdout: '', stderr: '' }
        }
        await expect(run(payload, 'image', ['runtime', '../worker.mjs'], invoke)).rejects
          .toBeInstanceOf(AggregateError)
        expect(calls.some((args) => args[0] === 'cp' || args[0] === 'start')).toBe(false)
        const name = calls[0]![calls[0]!.indexOf('--name') + 1]!
        expect(calls.filter((args) => args[0] === 'rm')).toEqual([[
          'rm',
          '--force',
          '--volumes',
          name,
        ]])
        expect(await tree(outside)).toEqual(before)
        await expect(payload.close()).rejects.toBeInstanceOf(Error)
      }),
  )

  it(
    'acquires restrictive private directories before descent and checks aliases and bytes independently',
    POSIX,
    () =>
      finish(async (release) => {
        const fixture = await Deno.makeTempDir({ prefix: 'consumer-worker-admission-' })
        release.push(() => Deno.remove(fixture, { recursive: true }))
        const root = join(fixture, 'payload'),
          nested = join(root, 'nested'),
          child = join(nested, 'child')
        await Deno.mkdir(child, { recursive: true })
        // These exact physical fixture directories are owned by this test, not borrowed installed inputs.
        release.push(async () => {
          for (const path of [root, nested, child]) await Deno.chmod(path, 0o700)
        })
        const bytes = new Uint8Array([0, 255, 128, 17])
        await Deno.writeFile(join(child, 'data'), bytes, { mode: 0o600 })
        await Deno.symlink('nested/child/data', join(root, 'alias'))
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        const hash = Array.from(digest, (part) => part.toString(16).padStart(2, '0')).join('')
        const entries = [
          { path: 'nested', kind: 'directory', mode: 0o555, uid: 0, gid: 0 },
          { path: 'nested/child', kind: 'directory', mode: 0o555, uid: 0, gid: 0 },
          {
            path: 'nested/child/data',
            kind: 'file',
            mode: 0o444,
            uid: 0,
            gid: 0,
            bytes: bytes.length,
            sha256: hash,
          },
          {
            path: 'alias',
            kind: 'link',
            mode: 0o777,
            uid: 0,
            gid: 0,
            target: 'nested/child/data',
            resolved: 'nested/child/data',
          },
        ]
        await Deno.writeTextFile(
          join(root, 'admission.json'),
          JSON.stringify({ version: 1, entries }),
        )
        const info = await Deno.lstat(root)
        expect(info.uid).not.toBeNull()
        expect(info.gid).not.toBeNull()
        await Deno.chmod(child, 0)
        await Deno.chmod(nested, 0)
        await Deno.chmod(root, 0o700)
        // The private test seam acquires caller-owned entries; production CLI always requires owner0.
        await admit(root, { uid: info.uid!, gid: info.gid! })
        expect(await Deno.readFile(join(root, 'alias'))).toEqual(bytes)
        for (const path of [root, nested, child]) {
          expect((await Deno.lstat(path)).mode! & 0o777).toBe(0o555)
          expect((await Deno.lstat(path)).uid).toBe(info.uid)
          expect((await Deno.lstat(path)).gid).toBe(info.gid)
        }
        expect((await Deno.lstat(join(child, 'data'))).mode! & 0o777).toBe(0o444)
      }),
  )

  it(
    'refuses copied hardlinks or escaped aliases without changing borrowed target modes or bytes',
    POSIX,
    () =>
      finish(async (release) => {
        const fixture = await Deno.makeTempDir({ prefix: 'consumer-worker-alias-' })
        release.push(() => Deno.remove(fixture, { recursive: true }))
        const outside = join(fixture, 'outside'), bytes = new Uint8Array([23, 0, 255])
        await Deno.writeFile(outside, bytes, { mode: 0o640 })
        const mode = (await Deno.lstat(outside)).mode! & 0o777
        for (const kind of ['hardlink', 'symlink'] as const) {
          const root = join(fixture, kind)
          await Deno.mkdir(root)
          release.push(() => Deno.chmod(root, 0o700))
          if (kind === 'hardlink') await Deno.link(outside, join(root, 'alias'))
          else await Deno.symlink('../outside', join(root, 'alias'))
          const entries = kind === 'hardlink'
            ? [{
              path: 'alias',
              kind: 'file',
              mode: 0o444,
              uid: 0,
              gid: 0,
              bytes: bytes.length,
              sha256: 'deliberately-unadmitted-bytes',
            }]
            : [{
              path: 'alias',
              kind: 'link',
              mode: 0o777,
              uid: 0,
              gid: 0,
              target: '../outside',
              resolved: '../outside',
            }]
          await Deno.writeTextFile(
            join(root, 'admission.json'),
            JSON.stringify({ version: 1, entries }),
          )
          const owner = await Deno.lstat(root)
          await expect(admit(root, { uid: owner.uid!, gid: owner.gid! })).rejects.toBeInstanceOf(
            Error,
          )
          expect((await Deno.lstat(outside)).mode! & 0o777).toBe(mode)
          expect(await Deno.readFile(outside)).toEqual(bytes)
        }
      }),
  )

  it('rejects independently mismatched copied bootstrap hashes before worker dispatch and still removes the daemon', async () => {
    const calls: string[][] = []
    const payload = {
      directory: '/private-copy',
      inputs: [],
      entries: [],
      receipt: '/not-write-authority',
      bootstrap: { workerSha256: 'expected-worker', receiptSha256: 'expected-receipt' },
      record: (_event: ObservationType) => Promise.resolve(),
      verify: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }
    const invoke = (_command: string, args: readonly string[]): Promise<OutputType> => {
      calls.push([...args])
      return Promise.resolve({
        code: 0,
        signal: null,
        success: true,
        stdout: args.includes('sha256sum') ? 'wrong-bytes' : '',
        stderr: '',
      })
    }
    await expect(run(payload, 'image', ['runtime', '../worker.mjs'], invoke)).rejects
      .toBeInstanceOf(AggregateError)
    expect(calls.some((args) => args.at(-1) === '--admit')).toBe(false)
    expect(calls.some((args) => args[0] === 'wait')).toBe(false)
    const name = calls[0]![calls[0]!.indexOf('--name') + 1]!
    expect(calls.filter((args) => args[0] === 'rm')).toEqual([['rm', '--force', '--volumes', name]])
  })

  it('does not start a failed copy and independently preserves copy and owned-removal failures', async () => {
    const copied = new Error('copy'), removal = new Error('remove')
    const calls: string[][] = []
    const observations: ObservationType[] = []
    const payload = {
      directory: '/private-copy',
      inputs: [],
      entries: [],
      receipt: '/retained-copy-admission.json',
      bootstrap: { workerSha256: 'worker', receiptSha256: 'receipt' },
      record: (event: ObservationType) => {
        observations.push(event)
        return Promise.resolve()
      },
      verify: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }
    const invoke = (_command: string, args: readonly string[]): Promise<OutputType> => {
      calls.push([...args])
      if (args[0] === 'cp') return Promise.reject(copied)
      if (args[0] === 'rm') return Promise.reject(removal)
      return Promise.resolve({ code: 0, success: true, stdout: '', stderr: '' })
    }
    let failure: unknown
    try {
      await run(payload, 'image', ['runtime', '../worker.mjs'], invoke)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect(reasons(failure)).toEqual([copied, removal])
    expect(observations).toContainEqual(
      expect.objectContaining({ outcome: 'rejected', reason: copied }),
    )
    expect(observations).toContainEqual(
      expect.objectContaining({ outcome: 'rejected', reason: removal }),
    )
    expect(calls.some((args) => args[0] === 'start')).toBe(false)
    const name = calls[0]![calls[0]!.indexOf('--name') + 1]!
    expect(calls.find((args) => args[0] === 'cp')!.at(-1)).toBe(`${name}:/work`)
    expect(calls.find((args) => args[0] === 'rm')!.at(-1)).toBe(name)
    expect(calls[0]!.includes('-v') || calls[0]!.includes('--mount')).toBe(false)
  })

  it('retains unresolved create and unsuccessful behavior outcomes while still collecting logs and exact cleanup', async () => {
    const payload = {
      directory: '/private-copy',
      inputs: [],
      entries: [],
      receipt: '/retained-copy-admission.json',
      bootstrap: { workerSha256: 'worker', receiptSha256: 'receipt' },
      record: (_event: ObservationType) => Promise.resolve(),
      verify: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }
    for (const phase of ['create', 'wait'] as const) {
      const calls: string[][] = []
      const invoke = (_command: string, args: readonly string[]): Promise<OutputType> => {
        calls.push([...args])
        if (phase === 'create' && args[0] === phase) return Promise.reject(undefined)
        return Promise.resolve({
          code: 0,
          success: true,
          stdout: args.includes('sha256sum')
            ? 'worker  /work/worker.mjs\nreceipt  /work/admission.json\n'
            : args[0] === 'wait'
            ? '7\n'
            : '',
          stderr: '',
        })
      }
      await expect(run(payload, 'image', ['runtime', '../worker.mjs'], invoke)).rejects.toThrow(
        AggregateError,
      )
      expect(calls.filter((args) => args[0] === 'rm')).toHaveLength(1)
      expect(calls.some((args) => args[0] === 'logs')).toBe(phase === 'wait')
    }
  })

  it('retains primary and evidence failures while still attempting exact daemon removal', async () => {
    const evidence = new Error('retention'), primary = new Error('copy')
    const calls: string[][] = [], observations: ObservationType[] = []
    const payload = {
      directory: '/private-copy',
      inputs: [],
      entries: [],
      receipt: '/not-write-authority',
      bootstrap: { workerSha256: 'worker', receiptSha256: 'receipt' },
      verify: () => Promise.resolve(),
      close: () => Promise.resolve(),
      record: (event: ObservationType) => {
        observations.push(event)
        return event.command[1] === 'cp' ? Promise.reject(evidence) : Promise.resolve()
      },
    }
    const invoke = (_command: string, args: readonly string[]): Promise<OutputType> => {
      calls.push([...args])
      if (args[0] === 'cp') return Promise.reject(primary)
      return Promise.resolve({ code: 0, success: true, stdout: '', stderr: '', signal: null })
    }
    let failure: unknown
    try {
      await run(payload, 'image', ['runtime', '../worker.mjs'], invoke)
    } catch (error) {
      failure = error
    }
    expect(reasons(failure)).toEqual([primary, evidence])
    expect(calls.filter((args) => args[0] === 'rm')).toHaveLength(1)
    expect(observations.find((event) => event.command[1] === 'rm')).toMatchObject({
      outcome: 'complete',
      output: { code: 0 },
    })
  })
})
