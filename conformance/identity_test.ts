import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { identity } from './identity.ts'

describe('conformance input identity', () => {
  it('tracks implementation, oracle, claims and sync config, excluding test and benchmark edits', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'conformance-identity-control-' })
    try {
      for (const path of ['packages/example', 'conformance', '.mise/tasks']) {
        await Deno.mkdir(`${directory}/${path}`, { recursive: true })
      }
      const files = [
        'packages/example/mod.ts',
        'packages/example/deno.json',
        'packages/example/package.json',
        'conformance/source.ts',
        'conformance/equal.ts',
        'deno.json',
        'deno.lock',
        'package.json',
        'support.json',
        '.mise/tasks/conformance.ts',
        '.mise/tasks/conformance-sync.ts',
        '.mise/tasks/support.ts',
        '.mise/tasks/sources.ts',
      ]
      for (const path of files) await Deno.writeTextFile(`${directory}/${path}`, '{}')
      const baseline = await identity(directory)
      expect(baseline).toMatch(/^[0-9a-f]{64}$/)
      for (
        const path of [
          'packages/example/mod_test.ts',
          'packages/example/parse_bench.ts',
          'conformance/oracle_test.ts',
          'packages/example/node_modules/foreign/mod.ts',
          'conformance/.tmp/generated.ts',
          'conformance/upstream/raw.ts',
        ]
      ) {
        await Deno.mkdir(`${directory}/${path.slice(0, path.lastIndexOf('/'))}`, {
          recursive: true,
        })
        await Deno.writeTextFile(`${directory}/${path}`, 'changed test or benchmark')
      }
      expect(await identity(directory)).toBe(baseline)
      for (const path of files) {
        await Deno.writeTextFile(`${directory}/${path}`, 'changed contract')
        expect(await identity(directory)).not.toBe(baseline)
        await Deno.writeTextFile(`${directory}/${path}`, '{}')
        expect(await identity(directory)).toBe(baseline)
      }
      await Deno.writeTextFile(`${directory}/packages/example/new.ts`, 'new contract')
      expect(await identity(directory)).not.toBe(baseline)
      await Deno.remove(`${directory}/packages/example/new.ts`)
      expect(await identity(directory)).toBe(baseline)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
