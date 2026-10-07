import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import { expect } from '@std/expect'
import { basename, join } from 'node:path'
import * as artifacts from './artifacts.ts'

/** Small byte fixtures test receipt authority; real pack/install remains a separate CI lane. */
async function fixture(context: TestContext): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'artifact-receipt-' })
  context.after(() => Deno.remove(root, { recursive: true }))
  await Deno.mkdir(join(root, '.tmp/packages'), { recursive: true })
  await Deno.mkdir(join(root, '.mise/tasks'), { recursive: true })
  await Deno.mkdir(join(root, 'conformance'))
  await Deno.writeTextFile(
    join(root, 'deno.json'),
    JSON.stringify({ workspace: ['./packages/*'], tasks: { test: 'original' } }),
  )
  for (
    const path of [
      'deno.lock',
      '.mise/tasks/package.ts',
      '.mise/tasks/files.ts',
      '.mise/tasks/workspace.ts',
      '.mise/tasks/artifacts.ts',
      'conformance/exports.ts',
    ]
  ) {
    await Deno.writeTextFile(join(root, path), 'fixture build input')
  }
  for (const name of ['one', 'two']) {
    const directory = join(root, 'packages', name)
    await Deno.mkdir(directory, { recursive: true })
    const metadata = JSON.stringify({ name: `@fixture/${name}`, version: '1.0.0' })
    await Deno.writeTextFile(join(directory, 'deno.json'), metadata)
    await Deno.writeTextFile(join(directory, 'package.json'), metadata)
    await Deno.writeTextFile(join(directory, 'mod.ts'), `export const value = '${name}'`)
    await Deno.writeTextFile(
      join(root, '.tmp/packages', `fixture-${name}-1.0.0.tgz`),
      `archive ${name}`,
    )
  }
  await artifacts.save(await artifacts.identity(root), root)
  return root
}

describe('packed artifact receipts', () => {
  it('accepts current bytes regardless of receipt order or unrelated test task edits', async (t) => {
    const root = await fixture(t)
    const path = join(root, '.tmp/packages/artifacts.json')
    const receipt = JSON.parse(await Deno.readTextFile(path))
    receipt.archives.reverse()
    receipt.inputs = Object.fromEntries(Object.entries(receipt.inputs).reverse())
    await Deno.writeTextFile(path, JSON.stringify(receipt))
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ tasks: { test: 'changed' }, workspace: ['./packages/*'] }),
    )
    await Deno.writeTextFile(join(root, 'packages/one/mod_test.ts'), 'unrelated runtime test')
    expect((await artifacts.get(root)).map((file) => basename(file))).toEqual([
      'fixture-one-1.0.0.tgz',
      'fixture-two-1.0.0.tgz',
    ])
  })

  it('rejects implementation changes even when versions and export names stay the same', async (t) => {
    const root = await fixture(t)
    await Deno.writeTextFile(join(root, 'packages/one/mod.ts'), 'export const value = "changed"')
    await expect(artifacts.get(root)).rejects.toThrow(Error)
  })

  it('tracks hidden runtime source and the build cleanup authority', async (t) => {
    for (const path of ['packages/one/.hidden.ts', '.mise/tasks/files.ts']) {
      const root = await fixture(t)
      await Deno.writeTextFile(join(root, path), 'initial content')
      await artifacts.save(await artifacts.identity(root), root)
      await Deno.writeTextFile(join(root, path), 'changed content')
      await expect(artifacts.get(root)).rejects.toThrow(Error)
    }
  })

  it('rejects changed source versions before installing old archives', async (t) => {
    const root = await fixture(t)
    for (const file of ['deno.json', 'package.json']) {
      await Deno.writeTextFile(
        join(root, 'packages/one', file),
        JSON.stringify({ name: '@fixture/one', version: '2.0.0' }),
      )
    }
    await expect(artifacts.get(root)).rejects.toThrow(Error)
  })

  it('rejects replacement archive bytes with an unchanged filename', async (t) => {
    const root = await fixture(t)
    await Deno.writeTextFile(join(root, '.tmp/packages/fixture-one-1.0.0.tgz'), 'substituted bytes')
    await expect(artifacts.get(root)).rejects.toThrow(Error)
  })

  for (const mutation of ['extra', 'missing', 'duplicate receipt'] as const) {
    it(`rejects a ${mutation} archive inventory`, async (t) => {
      const root = await fixture(t)
      if (mutation === 'extra') {
        await Deno.writeTextFile(join(root, '.tmp/packages/old-0.1.0.tgz'), 'old archive')
      } else if (mutation === 'missing') {
        await Deno.remove(join(root, '.tmp/packages/fixture-one-1.0.0.tgz'))
      } else {
        const path = join(root, '.tmp/packages/artifacts.json')
        const receipt = JSON.parse(await Deno.readTextFile(path))
        receipt.archives[1] = receipt.archives[0]
        await Deno.writeTextFile(path, JSON.stringify(receipt))
      }
      await expect(artifacts.get(root)).rejects.toThrow(Error)
    })
  }

  it('rejects an absent receipt instead of silently accepting preexisting archives', async (t) => {
    const root = await fixture(t)
    await Deno.remove(join(root, '.tmp/packages/artifacts.json'))
    await expect(artifacts.get(root)).rejects.toThrow(Deno.errors.NotFound)
  })

  it('does not issue a receipt when source changes while archives are built', async (t) => {
    const root = await fixture(t)
    const before = await artifacts.identity(root)
    await Deno.remove(join(root, '.tmp/packages/artifacts.json'))
    await Deno.writeTextFile(join(root, 'packages/one/mod.ts'), 'changed during build')
    await expect(artifacts.save(before, root)).rejects.toThrow(Error)
    await expect(Deno.stat(join(root, '.tmp/packages/artifacts.json'))).rejects.toThrow(
      Deno.errors.NotFound,
    )
  })

  it('compares actual installed archive payloads and rejects missing, extra and changed files', async (t) => {
    for (const change of ['none', 'changed', 'missing', 'extra'] as const) {
      const root = await fixture(t)
      const consumer = join(root, '.tmp/consumer')
      for (const name of ['one', 'two']) {
        const staging = join(root, 'staging', name)
        const packageRoot = join(staging, 'package')
        const installedRoot = join(consumer, 'node_modules', '@fixture', name)
        await Deno.mkdir(packageRoot, { recursive: true })
        await Deno.mkdir(installedRoot, { recursive: true })
        for (const file of ['package.json', 'mod.js']) {
          const bytes = file === 'package.json'
            ? JSON.stringify({ name: `@fixture/${name}`, version: '1.0.0' })
            : `export const name = '${name}'`
          await Deno.writeTextFile(join(packageRoot, file), bytes)
          await Deno.writeTextFile(join(installedRoot, file), bytes)
        }
        const packed = await new Deno.Command('tar', {
          args: [
            '-czf',
            join(root, '.tmp/packages', `fixture-${name}-1.0.0.tgz`),
            '-C',
            staging,
            'package',
          ],
        }).output()
        expect(packed.success).toBe(true)
      }
      await artifacts.save(await artifacts.identity(root), root)
      const file = join(consumer, 'node_modules/@fixture/one/mod.js')
      if (change === 'changed') await Deno.writeTextFile(file, 'export const name = "incorrect"')
      if (change === 'missing') await Deno.remove(file)
      if (change === 'extra') {
        await Deno.writeTextFile(join(consumer, 'node_modules/@fixture/one/extra.js'), 'unexpected')
      }
      if (change === 'none') await artifacts.installed(consumer, root)
      else await expect(artifacts.installed(consumer, root)).rejects.toThrow(AggregateError)
    }
  })
})
