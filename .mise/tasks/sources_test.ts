import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join } from 'node:path'
import { get } from './sources.ts'
import { finish } from '../../integration/releases.ts'

/** Actual directory admission tests do not launch a compiler or inspect command strings. */
describe('maintained source inventory', () => {
  it('admits maintained files once and excludes installed aliases, generated trees and raw snapshots', () =>
    finish(async (release) => {
      const root = await Deno.makeTempDir({ prefix: 'source-admission-' })
      release.push(() => Deno.remove(root, { recursive: true }))
      const owned = [
        'packages/rdf/mod.ts',
        'packages/rdf/.hidden.ts',
        'packages/rdf/mod_test.ts',
        'packages/rdf/parse_bench.ts',
        'conformance/upstream_test.ts',
        'integration/own.ts',
        'bench/upstream/store_bench.ts',
        'examples/own.ts',
        '.mise/tasks/own.ts',
      ]
      const excluded = [
        'packages/rdf/node_modules/dependency/index.ts',
        'packages/rdf/node_modules/dependency/broken_test.ts',
        'packages/rdf/.tmp/generated.ts',
        'integration/dist/generated.ts',
        'bench/upstream/sources/copied.ts',
        'conformance/upstream/copied_test.ts',
        '.tmp/generated.ts',
        'node_modules/dependency/index.ts',
      ]
      for (const file of [...owned, ...excluded]) {
        const path = join(root, file)
        await Deno.mkdir(join(path, '..'), { recursive: true })
        await Deno.writeTextFile(
          path,
          excluded.includes(file) ? 'this is invalid TypeScript' : 'export {}',
        )
      }
      // A workspace alias to the same source and a foreign source both stay outside admission.
      // Windows junctions exercise directory aliases without requiring symlink creation rights.
      await Deno.symlink(join(root, 'packages/rdf'), join(root, 'integration/alias'), {
        type: 'junction',
      })
      await Deno.symlink(
        join(root, 'node_modules/dependency'),
        join(root, 'packages/rdf/foreign'),
        {
          type: 'junction',
        },
      )
      expect(await get(root)).toEqual([...owned].sort())
      expect(await get(root, 'production')).toEqual([
        'packages/rdf/.hidden.ts',
        'packages/rdf/mod.ts',
      ])
      expect(await get(root, 'benchmark')).toEqual(
        owned.filter((path) => path.startsWith('packages/') || path.startsWith('bench/')).sort(),
      )
      expect(await get(root, 'conformance')).toEqual(
        owned.filter((path) => path.startsWith('packages/') || path.startsWith('conformance/'))
          .sort(),
      )
      await Deno.writeTextFile(join(root, 'packages/rdf/package.json'), '{}')
      expect(await get(root, 'production')).not.toContain('packages/rdf/package.json')
      expect(await get(root, 'benchmark')).toContain('packages/rdf/package.json')
      expect(await get(root, 'conformance')).toContain('packages/rdf/package.json')
      await Deno.writeTextFile(join(root, 'packages/rdf/new.ts'), 'export const value = 1')
      expect(await get(root, 'production')).toEqual([
        'packages/rdf/.hidden.ts',
        'packages/rdf/mod.ts',
        'packages/rdf/new.ts',
      ])
    }))
  it('rejects missing or aliased maintained roots instead of accepting a partial check', () =>
    finish(async (release) => {
      const root = await Deno.makeTempDir({ prefix: 'source-admission-root-' })
      release.push(() => Deno.remove(root, { recursive: true }))
      await expect(get(root, 'production')).rejects.toThrow(Deno.errors.NotFound)
      await Deno.mkdir(join(root, 'installed'))
      await Deno.writeTextFile(join(root, 'installed/mod.ts'), 'export {}')
      await Deno.symlink(join(root, 'installed'), join(root, 'packages'), { type: 'junction' })
      await expect(get(root, 'production')).rejects.toThrow(TypeError)
    }))
})
