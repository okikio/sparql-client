import process from 'node:process'
import { CaptureError, copy as copyReports } from './reports.ts'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ceiling } from './ceiling.ts'

/** Real diagnostic files use a separately acquired writable namespace and guarded retirement. */
async function reportFixture(action: (root: string) => Promise<void>): Promise<void> {
  const created = await Deno.makeTempDir({ prefix: 'report-capture-control-' })
  let root = created, canonical = false
  let owner: Deno.FileInfo | undefined
  const errors: unknown[] = []
  try {
    // Acquire physical identity before canonicalization or any fixture action can fail.
    owner = await Deno.lstat(created)
    if (!owner.isDirectory || owner.isSymlink || !owner.dev || !owner.ino) {
      throw new Error('Report fixture requires observable physical ownership.')
    }
    root = await Deno.realPath(created)
    canonical = true
    await action(root)
  } catch (reason) {
    errors.push(reason)
  }
  try {
    if (!owner?.isDirectory || owner.isSymlink || !owner.dev || !owner.ino) {
      throw new Error(
        `Report fixture ownership was not acquired; created path retained at ${created}.`,
      )
    }
    const current = await Deno.lstat(root)
    if (
      !current.isDirectory || current.isSymlink || current.dev !== owner.dev ||
      current.ino !== owner.ino ||
      (canonical && await Deno.realPath(root) !== root)
    ) throw new Error('Report fixture acquired root changed.')
    await Deno.remove(root, { recursive: true })
  } catch (reason) {
    errors.push(reason)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length) {
    throw new AggregateError(errors, 'Report fixture behavior and retirement failed.', {
      cause: errors[0],
    })
  }
}

/** Parses actual retained journal bytes; alias targets remain inert byte observations. */
async function reportCatalog(path: string): Promise<Array<Record<string, unknown>>> {
  return (await Deno.readTextFile(path)).trimEnd().split('\n').map((line: string) =>
    JSON.parse(line) as Record<string, unknown>
  )
}

describe('diagnostic report capture', () => {
  it('retains dangling/internal/escaped aliases as inert bytes beside independent binary reports', async () => {
    await reportFixture(async (root) => {
      const source = join(root, 'source'),
        target = join(root, 'reports'),
        outside = join(root, 'outside.bin')
      await Deno.mkdir(join(source, 'nested'), { recursive: true })
      const bytes = Uint8Array.from({ length: 192 * 1024 + 7 }, (_, index) => index % 251)
      await Deno.writeFile(join(source, 'nested/raw.bin'), bytes)
      await Deno.writeTextFile(
        join(source, 'report-catalog-retained.ndjson'),
        'ordinary report with a catalog-like name',
      )
      await Deno.writeFile(outside, new Uint8Array([255, 0, 17, 128]))
      const before = await Deno.lstat(outside)
      const links = {
        dangling: 'missing-lock-owner',
        internal: 'nested/raw.bin',
        escaped: '../outside.bin',
        absolute: outside,
        cycle: 'cycle',
        unicode: '../répertoire/锁-🦊',
      }
      for (const [name, value] of Object.entries(links)) {
        await Deno.symlink(value, join(source, name), { type: 'file' })
      }
      const captured = await copyReports(source, target)
      expect(captured.failures).toEqual([])
      expect(dirname(captured.catalog.path)).toBe(root)
      expect(captured.catalog.sha256).toBe(
        createHash('sha256').update(await Deno.readFile(captured.catalog.path)).digest('hex'),
      )
      expect(await Deno.readFile(join(target, 'nested/raw.bin'))).toEqual(bytes)
      expect(await Deno.readTextFile(join(target, 'report-catalog-retained.ndjson'))).toBe(
        'ordinary report with a catalog-like name',
      )
      const rows = await reportCatalog(captured.catalog.path)
      for (const [name, value] of Object.entries(links)) {
        const row = rows.find((entry) => entry.path === name)
        expect(row?.kind).toBe('link')
        expect(row?.representation).toBe('inert')
        expect(Uint8Array.from(Buffer.from(String(row?.rawTargetBase64), 'base64'))).toEqual(
          new TextEncoder().encode(value),
        )
        await expect(Deno.lstat(join(target, name))).rejects.toThrow(Deno.errors.NotFound)
      }
      expect(rows.filter((entry) => typeof entry.path === 'string').map((entry) => entry.path))
        .toEqual([
          'absolute',
          'cycle',
          'dangling',
          'escaped',
          'internal',
          'nested',
          'nested/raw.bin',
          'report-catalog-retained.ndjson',
          'unicode',
        ])
      expect(await Deno.readFile(outside)).toEqual(new Uint8Array([255, 0, 17, 128]))
      const after = await Deno.lstat(outside)
      expect({ dev: after.dev, ino: after.ino, mode: after.mode, size: after.size }).toEqual({
        dev: before.dev,
        ino: before.ino,
        mode: before.mode,
        size: before.size,
      })
    })
  })
  it('continues sibling reports after one native read fails and durably journals the original failure', async () => {
    await reportFixture(async (root) => {
      const source = join(root, 'source'), target = join(root, 'reports')
      await Deno.mkdir(join(source, 'nested'), { recursive: true })
      await Deno.writeTextFile(join(source, 'a-failed.bin'), 'unread report')
      await Deno.writeFile(join(source, 'nested/raw.bin'), new Uint8Array([0, 255, 128, 1, 17]))
      await Deno.writeTextFile(join(source, 'z-sibling.json'), '{"observed":9}')
      const primary = new Error('controlled native report read failure')
      const captured = await copyReports(source, target, async (path, file, bytes, position) => {
        if (path === join(source, 'a-failed.bin')) throw primary
        return (await file.read(bytes, 0, bytes.length, position)).bytesRead
      })
      expect(captured.failures).toHaveLength(1)
      expect(captured.failures[0]).toBeInstanceOf(CaptureError)
      if (!(captured.failures[0] instanceof CaptureError)) {
        throw new Error('Actual read failure was not retained.')
      }
      expect(captured.failures[0].cause).toBe(primary)
      expect(await Deno.readFile(join(target, 'nested/raw.bin'))).toEqual(
        new Uint8Array([0, 255, 128, 1, 17]),
      )
      expect(await Deno.readTextFile(join(target, 'z-sibling.json'))).toBe('{"observed":9}')
      const rows = await reportCatalog(captured.catalog.path)
      expect(rows.at(-1)).toMatchObject({
        phase: 'entries-complete',
        entryState: 'partial',
        failures: 1,
      })
      expect(rows.find((entry) => entry.path === 'a-failed.bin')).toMatchObject({
        kind: 'file',
        sha256: null,
        failures: [{
          name: 'CaptureError',
          capture: { path: 'a-failed.bin', phase: 'file-read' },
          cause: { name: 'Error', message: primary.message },
        }],
      })
    })
  })
  it('refuses recursive or overlapping source/destination trees before creating capture entries', async () => {
    await reportFixture(async (root) => {
      const source = join(root, 'source')
      await Deno.mkdir(source)
      await Deno.writeFile(join(source, 'binary'), new Uint8Array([0, 255, 128]))
      await expect(copyReports(source, join(source, 'nested-capture'))).rejects.toThrow()
      await expect(copyReports(source, root)).rejects.toThrow()
      expect(await Deno.readFile(join(source, 'binary'))).toEqual(new Uint8Array([0, 255, 128]))
      await expect(Deno.lstat(join(source, 'nested-capture'))).rejects.toThrow(Deno.errors.NotFound)
    })
  })
  it('records an actual Unix socket as inert metadata without opening or cloning it', {
    skip: Deno.build.os === 'windows',
  }, async () => {
    await reportFixture(async (root) => {
      const source = join(root, 'source'), target = join(root, 'reports')
      await Deno.mkdir(source)
      const listener = Deno.listen({ transport: 'unix', path: join(source, 'socket') })
      const errors: unknown[] = []
      try {
        const captured = await copyReports(source, target)
        expect(captured.failures).toEqual([])
        expect(
          (await reportCatalog(captured.catalog.path)).find((entry) => entry.path === 'socket'),
        ).toMatchObject({ kind: 'socket', representation: 'inert' })
        await expect(Deno.lstat(join(target, 'socket'))).rejects.toThrow(Deno.errors.NotFound)
      } catch (reason) {
        errors.push(reason)
      }
      try {
        listener.close()
      } catch (reason) {
        errors.push(reason)
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length) {
        throw new AggregateError(errors, 'Socket observation and retirement failed.', {
          cause: errors[0],
        })
      }
    })
  })
  it('refuses preexisting destination and parent aliases without changing outside bytes or modes', async () => {
    await reportFixture(async (root) => {
      const source = join(root, 'source'),
        outside = join(root, 'outside'),
        borrowed = join(root, 'borrowed')
      await Deno.mkdir(source)
      await Deno.mkdir(outside)
      await Deno.mkdir(borrowed)
      await Deno.writeTextFile(join(outside, 'sentinel'), 'outside remains')
      await Deno.writeTextFile(join(borrowed, 'sentinel'), 'borrowed destination remains')
      const before = await Deno.lstat(outside), borrowedBefore = await Deno.lstat(borrowed)
      await Deno.symlink(outside, join(root, 'parent-alias'), { type: 'dir' })
      await expect(copyReports(source, join(root, 'parent-alias/reports'))).rejects.toThrow()
      await expect(copyReports(source, borrowed)).rejects.toThrow()
      expect(await Deno.readTextFile(join(outside, 'sentinel'))).toBe('outside remains')
      expect(await Deno.readTextFile(join(borrowed, 'sentinel'))).toBe(
        'borrowed destination remains',
      )
      expect((await Deno.lstat(outside)).mode).toBe(before.mode)
      expect((await Deno.lstat(borrowed)).mode).toBe(borrowedBefore.mode)
      await expect(Deno.lstat(join(outside, 'reports'))).rejects.toThrow(Deno.errors.NotFound)
    })
  })
})

/** Native Git separator admission is pure and remains testable on every host. */
describe('Git discovery ceiling', () => {
  it('admits a Windows drive-letter path as one ceiling', () => {
    expect(ceiling(String.raw`C:\release inputs\parent`, true)).toBe(
      String.raw`C:\release inputs\parent`,
    )
  })
  it('rejects a Windows semicolon that could select another ceiling', () => {
    expect(() => ceiling(String.raw`C:\parent;D:\other`, true)).toThrow(RangeError)
  })
  it('admits one canonical Unix parent without changing it', () => {
    expect(ceiling('/owned/release inputs', false)).toBe('/owned/release inputs')
  })
  it('rejects a Unix colon that could select another ceiling', () => {
    expect(() => ceiling('/owned/parent:/other', false)).toThrow(RangeError)
  })
})

/** These subprocess fixtures use the real pinned Bumpy and owned Git repositories, never public registry uploads. */
interface FixtureType {
  root: string
  snapshots: string
  env: Record<string, string>
  release(...args: string[]): Promise<Deno.CommandOutput>
}

/** Registry doubles retain attempted uploads separately from metadata observations. */
interface RegistryType {
  npm: boolean
  jsr: boolean
  status?: number
  different?: boolean
  failUpload?: boolean
  staleJsr?: boolean
  uploads: string[][]
  archive: string
}

/** Bounds a real subprocess and always releases its deadline timer. */
async function run(root: string, file: string, args: string[], env: Record<string, string> = {}) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Release fixture command exceeded 45 seconds.')),
    45_000,
  )
  try {
    const command = file === 'git'
      ? ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args]
      : args
    return await new Deno.Command(file, {
      args: command,
      cwd: root,
      env,
      stdin: 'null',
      signal: controller.signal,
    })
      .output()
  } finally {
    clearTimeout(timer)
  }
}

/** Test manifests and registry state are inspectable data, while Bumpy owns all release decisions. */
async function json(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Reads one fixture-owned JSON record. */
async function read<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T
}

/** Reports child diagnostics when a fixture setup command fails. */
function success(result: Deno.CommandOutput): void {
  if (!result.success) {
    throw new Error(
      new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout),
    )
  }
}

/** A child marker observes a path; the fixture's acquired namespace owns cleanup authority. */
async function snapshotPath(
  value: FixtureType,
  observed: string,
  removed = false,
): Promise<string> {
  if (!observed || !isAbsolute(observed)) {
    throw new Error('Snapshot observation is outside the owned fixture namespace.')
  }
  const path = resolve(observed)
  const ownerInfo = await Deno.lstat(value.root)
  if (ownerInfo.isSymlink || !ownerInfo.isDirectory) {
    throw new Error('Snapshot owner path changed kind.')
  }
  const owner = await Deno.realPath(value.root)
  // Temporary roots can have an OS alias, such as /var -> /private/var on macOS.
  // Admit its actual canonical spelling, without accepting an arbitrary link below the owner.
  const contained = (suffix: string): boolean =>
    Boolean(suffix) && !isAbsolute(suffix) && !suffix.split(/[\\/]/u).includes('..')
  let suffix = relative(value.snapshots, path)
  if (!contained(suffix)) suffix = relative(join(owner, '.tmp', 'owned-snapshots'), path)
  if (!contained(suffix)) {
    throw new Error('Snapshot observation is outside the owned fixture namespace.')
  }
  const parts = suffix.split(/[\\/]/u)
  let canonical = owner
  let cursor = value.root
  for (const part of ['.tmp', 'owned-snapshots', ...parts]) {
    cursor = join(cursor, part)
    canonical = join(canonical, part)
    let info: Deno.FileInfo
    try {
      info = await Deno.lstat(cursor)
    } catch (reason) {
      // Removed observations support physical absence oracles; they never authorize mutation.
      if (removed && reason instanceof Deno.errors.NotFound) return path
      throw reason
    }
    if (info.isSymlink || !info.isDirectory || await Deno.realPath(cursor) !== canonical) {
      throw new Error('Snapshot observation is not an owned canonical directory.')
    }
  }
  return path
}
/** Restore only acquired snapshot storage, without following links or trusting child-written markers. */
async function retireSnapshots(root: string): Promise<void> {
  const namespace = join(root, '.tmp', 'owned-snapshots')
  for (const path of [root, join(root, '.tmp'), namespace]) {
    try {
      const info = await Deno.lstat(path)
      if (!info.isDirectory || info.isSymlink) throw new Error('Snapshot owner path changed kind.')
    } catch (reason) {
      if (reason instanceof Deno.errors.NotFound) return
      throw reason
    }
  }
  const failures: unknown[] = []
  async function restore(path: string): Promise<void> {
    const info = await Deno.lstat(path)
    if (info.isSymlink) return
    await Deno.chmod(path, info.isDirectory ? 0o755 : 0o600)
    if (info.isDirectory) {
      for await (const entry of Deno.readDir(path)) {
        try {
          await restore(join(path, entry.name))
        } catch (reason) {
          failures.push(reason)
        }
      }
    }
  }
  try {
    await restore(namespace)
  } catch (reason) {
    failures.push(reason)
  }
  try {
    await Deno.remove(namespace, { recursive: true })
  } catch (reason) {
    failures.push(reason)
  }
  try {
    await Deno.lstat(namespace)
    failures.push(new Error('Owned snapshot namespace survived fixture cleanup.'))
  } catch (reason) {
    if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Owned snapshot fixture cleanup failed.', {
      cause: failures[0],
    })
  }
}

/** Owns each temporary root immediately and retains independent fixture/cleanup failures. */
async function fixture(
  body: (value: FixtureType) => Promise<void>,
  workspace = false,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'opfs-release-test-' })
  const snapshots = join(root, '.tmp', 'owned-snapshots')
  const errors: unknown[] = []
  try {
    const source = new URL('../../', import.meta.url)
    await Deno.mkdir(join(root, '.mise/tasks'), { recursive: true })
    await Deno.mkdir(join(root, '.bumpy'))
    await Deno.mkdir(join(root, '.tmp'))
    await Deno.mkdir(snapshots)
    await Deno.mkdir(join(root, 'bin'))
    await Deno.copyFile(
      new URL('.mise/tasks/ceiling.ts', source),
      join(root, '.mise/tasks/ceiling.ts'),
    )
    await Deno.copyFile(
      new URL('.mise/tasks/release.ts', source),
      join(root, '.mise/tasks/release.ts'),
    )
    await Deno.copyFile(
      new URL('.mise/tasks/reports.ts', source),
      join(root, '.mise/tasks/reports.ts'),
    )
    await Deno.copyFile(new URL('.bumpy/format.ts', source), join(root, '.bumpy/format.ts'))
    await Deno.copyFile(
      new URL('.mise/tasks/release-check.ts', source),
      join(root, '.mise/tasks/release-check.ts'),
    )
    await fixtureDependencies(root, source)
    await Deno.writeTextFile(join(root, '.gitignore'), '.tmp/\n.release/\nnode_modules\n')
    await json(join(root, '.bumpy/_config.json'), {
      baseBranch: 'main',
      changelog: './.bumpy/format.ts',
      updateInternalDependencies: 'out-of-range',
    })
    const child = `${quote(Deno.execPath())} run --cached-only --no-lock -A .mise/tasks/release.ts`
    await json(join(root, 'deno.json'), {
      name: '@okikio/rdf',
      version: '0.1.0',
      exports: './mod.js',
      nodeModulesDir: 'manual',
      tasks: {
        'release:upload': `${child} upload`,
        'release:npm': 'npm publish',
        quality: 'deno run --allow-read check.ts',
        verify: 'deno task quality',
        'conformance:sync': 'deno run --allow-read check.ts',
        conformance: 'deno run --allow-read check.ts',
        support: 'deno run --allow-read check.ts',
        integration: 'deno run --allow-read check.ts',
        'test:upstream': 'deno run --allow-read check.ts',
        browser: 'deno run --allow-read check.ts',
        package: 'deno task pack:npm',
        distribution: 'deno task verify:npm:artifact .tmp/packages/okikio-rdf-0.1.0.tgz',
        consumer: 'deno run --allow-read check.ts',
        'consumer:linux': 'deno run --allow-read check.ts',
        'integration:storage': 'deno run --allow-read check.ts',
        'consumer:storage': 'deno run --allow-read check.ts',
        'bench:storage': 'deno run --allow-read check.ts',
        'bench:report': 'deno run --allow-read check.ts',
        'bench:types': 'deno run --allow-read check.ts',
        'release-check':
          'deno task quality && deno task pack:npm && deno task verify:npm:artifact .tmp/packages/okikio-rdf-0.1.0.tgz',
        'pack:npm': 'deno run -A pack.ts',
        'verify:npm:artifact': 'deno run --allow-read verify.ts',
      },
    })
    await json(
      join(root, 'package.json'),
      workspace
        ? { name: 'release-workspace', private: true, workspaces: ['packages/*'] }
        : { name: '@okikio/rdf', version: '0.1.0', type: 'module', files: ['mod.js'] },
    )
    await Deno.writeTextFile(join(root, 'mod.js'), 'export const value = 7;\n')
    const node = await executable('node')
    const npm = await executable('npm')
    await Deno.writeTextFile(
      join(root, 'check.ts'),
      "if ((await import('./mod.js')).value !== 7) throw new Error('toy behavior failed');\n",
    )
    await Deno.writeTextFile(
      join(root, 'pack.ts'),
      `
      await Deno.mkdir('.tmp/packages/package', { recursive:true });
      await Deno.copyFile('package.json','.tmp/packages/package/package.json');
      await Deno.copyFile('mod.js','.tmp/packages/package/mod.js');
      const result=await new Deno.Command(${
        JSON.stringify(npm)
      },{args:['pack','.tmp/packages/package','--pack-destination','.tmp/packages','--ignore-scripts','--json'],env:{npm_config_cache:Deno.cwd()+'/.tmp/npm-cache'}}).output();
      if(!result.success)throw new Error(new TextDecoder().decode(result.stderr));
    `,
    )
    await Deno.writeTextFile(
      join(root, 'verify.ts'),
      "const bytes=await Deno.readFile(Deno.args[0]);if(bytes[0]!==31||bytes[1]!==139)throw new Error('toy archive is not gzip');\n",
    )
    await Deno.writeTextFile(join(root, 'bin/registry.mjs'), REGISTRY)
    for (const command of ['curl', 'npm']) {
      await Deno.writeTextFile(
        join(root, 'bin', command),
        `#!/bin/sh\nexec ${quote(node)} "$0".mjs "$@"\n`,
      )
      await Deno.writeTextFile(
        join(root, 'bin', `${command}.mjs`),
        `process.env.REGISTRY_COMMAND=${JSON.stringify(command)};await import('./registry.mjs');\n`,
      )
      await Deno.chmod(join(root, 'bin', command), 0o755)
    }
    const opfs = join(root, '.tmp/opfs-source')
    const opfsArchive = join(root, '.tmp/opfs-package/opfs.tgz')
    await Deno.mkdir(opfs, { recursive: true })
    await Deno.writeTextFile(join(opfs, '.gitignore'), '.tmp/\n.release/\nnode_modules/\n')
    await json(join(opfs, 'deno.json'), {
      name: '@okikio/opfs',
      version: '0.1.0',
      exports: './mod.js',
    })
    await json(join(opfs, 'package.json'), {
      name: '@okikio/opfs',
      version: '0.1.0',
      exports: './mod.js',
      type: 'module',
    })
    await Deno.writeTextFile(join(opfs, 'mod.js'), 'export const value = 7;\n')
    success(await run(opfs, 'git', ['init', '-b', 'main']))
    success(await run(opfs, 'git', ['add', '.']))
    success(
      await run(opfs, 'git', [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-m',
        'test: freeze OPFS fixture input',
      ]),
    )
    const stage = join(root, '.tmp/opfs-package')
    await Deno.mkdir(join(stage, 'package'), { recursive: true })
    await Deno.copyFile(join(opfs, 'package.json'), join(stage, 'package/package.json'))
    await Deno.copyFile(join(opfs, 'mod.js'), join(stage, 'package/mod.js'))
    success(await run(stage, 'tar', ['-czf', opfsArchive, 'package']))
    const opfsHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await Deno.readFile(opfsArchive))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const env = {
      TMPDIR: snapshots,
      TMP: snapshots,
      TEMP: snapshots,
      OPFS_SOURCE: opfs,
      OPFS_TARBALL: opfsArchive,
      OPFS_ARCHIVE_SHA256: opfsHash,
      PATH: `${join(root, 'bin')}:${Deno.env.get('PATH')}`,
      REGISTRY_STATE: join(root, '.tmp/registry.json'),
      GITHUB_ACTIONS: 'false',
      DENO_DIR: join(root, '.tmp/deno-cache'),
    }
    await json(env.REGISTRY_STATE, {
      npm: false,
      jsr: false,
      uploads: [],
      archive: join(root, '.tmp/packages/okikio-rdf-0.1.0.tgz'),
    })
    if (workspace) {
      for (
        const [name, dependencies] of [['core', {}], ['app', {
          '@release/core': 'workspace:~0.1.0',
        }]] as const
      ) {
        const path = join(root, 'packages', name)
        await Deno.mkdir(path, { recursive: true })
        await json(join(path, 'package.json'), {
          name: `@release/${name}`,
          version: '0.1.0',
          dependencies,
        })
        await json(join(path, 'deno.json'), { name: `@release/${name}`, version: '0.1.0' })
      }
    }
    success(await run(root, 'git', ['init', '-b', 'main']))
    success(await run(root, 'git', ['add', '.']))
    success(
      await run(root, 'git', [
        '-c',
        'user.name=Release Fixture',
        '-c',
        'user.email=release@example.test',
        'commit',
        '-m',
        'test: create isolated release fixture',
      ]),
    )
    await body({
      root,
      snapshots,
      env,
      release: (...args) =>
        run(root, Deno.execPath(), [
          'run',
          '--cached-only',
          '--no-lock',
          '-A',
          '.mise/tasks/release.ts',
          ...args,
        ], env),
    })
  } catch (reason) {
    errors.push(reason)
  }
  try {
    await retireSnapshots(root)
  } catch (reason) {
    errors.push(reason)
  }
  try {
    await Deno.remove(root, { recursive: true })
    try {
      await Deno.lstat(root)
      throw new Error('Release fixture root survived cleanup.')
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) throw reason
    }
  } catch (reason) {
    errors.push(reason)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Release fixture and cleanup failed.', { cause: errors[0] })
  }
}

/** Resolves real build tools before controlled registry commands are placed on PATH. */
async function executable(name: string): Promise<string> {
  const result = await new Deno.Command('which', { args: [name] }).output()
  success(result)
  return new TextDecoder().decode(result.stdout).trim()
}

/** Quotes an owned executable for the fixture's POSIX command seam. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Updates only controlled external registry state, outside the prepared source identity. */
async function registry(value: FixtureType, changes: Partial<RegistryType>): Promise<void> {
  await json(value.env.REGISTRY_STATE!, {
    ...await read<RegistryType>(value.env.REGISTRY_STATE!),
    ...changes,
  })
}

/** Confirms no irreversible command was admitted by a failed guard. */
async function noUploads(value: FixtureType): Promise<void> {
  expect((await read<RegistryType>(value.env.REGISTRY_STATE!)).uploads).toEqual([])
}

describe('Deno release command', { skip: Deno.build.os === 'windows' }, () => {
  it('rejects Unix root before creating snapshots or running any gate', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(
        join(value.root, '.tmp/root-admission.ts'),
        `
        import process from 'node:process';
        if (!Reflect.set(process, 'getuid', () => 0)) throw new Error('Cannot install owned identity double.');
        Deno.args.splice(0, Deno.args.length, 'prepare');
        await import('../.mise/tasks/release.ts');
      `,
      )
      const result = await run(value.root, Deno.execPath(), [
        'run',
        '--cached-only',
        '--no-lock',
        '-A',
        '.tmp/root-admission.ts',
      ], value.env)
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('does not support Unix UID 0')
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await expect(Deno.stat(join(value.root, '.tmp/releases'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
    // This suite exercises ordinary-account protection and real permission
    // failures. A privileged runner must select a dedicated ordinary account.
    expect(process.getuid?.(), 'Run release fixtures as an ordinary Unix account.').not.toBe(0)
  })

  it('rejects Windows preparation before unprotected gates without changing consumer support', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(
        join(value.root, '.tmp/windows-admission.ts'),
        `
        Object.defineProperty(Deno, 'build', { value: { ...Deno.build, os: 'windows' } });
        Deno.args.splice(0, Deno.args.length, 'prepare');
        await import('../.mise/tasks/release.ts');
      `,
      )
      const result = await run(value.root, Deno.execPath(), [
        'run',
        '--cached-only',
        '--no-lock',
        '-A',
        '.tmp/windows-admission.ts',
      ], value.env)
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain(
        'does not support Windows source protection',
      )
      await expect(Deno.stat(join(value.root, '.tmp/releases'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })

  it('protects maintained files against direct writes and atomic replacement', async () => {
    await fixture(async (value) => {
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      for (const [name, task] of Object.entries(config.tasks)) {
        if (task.includes('check.ts')) config.tasks[name] = 'deno run -A check.ts'
      }
      await json(join(value.root, 'deno.json'), config)
      await Deno.writeTextFile(
        join(value.root, 'check.ts'),
        `
        const expected = 'export const value = 7;\\n';
        // Coverage --clean and Playwright cleanup must recreate their output
        // directories without requiring write access to the maintained root.
        for (const path of ['.tmp/reports/coverage', '.tmp/reports/browser/artifacts', '.tmp/reports/browser-bench/artifacts']) {
          await Deno.mkdir(path, { recursive: true });
          await Deno.writeTextFile(path+'/old.txt', 'old output');
          await Deno.remove(path, { recursive: true });
          await Deno.mkdir(path, { recursive: true });
          await Deno.writeTextFile(path+'/proof.txt', 'recreated owned output');
        }
        let direct = false;
        try { await Deno.writeTextFile('mod.js', 'export const value = 9;\\n'); }
        catch (error) { if (!(error instanceof Deno.errors.PermissionDenied)) throw error; direct = true; }
        if (!direct) throw new Error('Maintained source accepted a direct write.');
        await Deno.writeTextFile('.tmp/replacement.js', 'export const value = 9;\\n');
        let atomic = false;
        try { await Deno.rename('.tmp/replacement.js', 'mod.js'); }
        catch (error) { if (!(error instanceof Deno.errors.PermissionDenied)) throw error; atomic = true; }
        if (!atomic) throw new Error('Maintained source accepted atomic replacement.');
        if (await Deno.readTextFile('mod.js') !== expected) throw new Error('Source bytes changed.');
      `,
      )
      await commitFixture(value)
      success(await value.release('prepare'))
      expect(await Deno.readTextFile(join(value.root, 'mod.js'))).toBe('export const value = 7;\n')
      await noUploads(value)
    })
  })

  it('captures separate OPFS source/archive identities and protects their copied inputs', async () => {
    await fixture(async (value) => {
      const opfs = value.env.OPFS_SOURCE!
      await Deno.mkdir(join(opfs, 'linked'))
      await Deno.writeTextFile(join(opfs, 'linked/mod.js'), 'export const value = 7;\n')
      await Deno.mkdir(join(opfs, 'node_modules/@fixture'), { recursive: true })
      await Deno.symlink(join(opfs, 'linked'), join(opfs, 'node_modules/@fixture/source'), {
        type: 'dir',
      })
      success(await run(opfs, 'git', ['add', '.']))
      success(
        await run(opfs, 'git', [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '-m',
          'test: freeze OPFS alias control',
        ]),
      )
      await Deno.mkdir(join(value.root, 'node_modules/@fixture'), { recursive: true })
      await Deno.symlink(opfs, join(value.root, 'node_modules/@fixture/opfs'), { type: 'dir' })
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks.quality = 'deno run -A check-inputs.ts'
      await json(join(value.root, 'deno.json'), config)
      await Deno.writeTextFile(
        join(value.root, 'check-inputs.ts'),
        `
        const source = Deno.env.get('OPFS_SOURCE'), archive = Deno.env.get('OPFS_TARBALL');
        if (!source?.startsWith(Deno.cwd()+'/.tmp/release-inputs/') || !archive?.startsWith(Deno.cwd()+'/.tmp/release-inputs/')) throw new Error('OPFS input was not captured.');
        if (await Deno.readTextFile(source+'/mod.js') !== 'export const value = 7;\\n') throw new Error('Copied source behavior differs.');
        if ((await import(source+'/node_modules/@fixture/source/mod.js')).value !== 7) throw new Error('Copied OPFS dependency alias differs.');
        if ((await import('./node_modules/@fixture/opfs/linked/mod.js')).value !== 7) throw new Error('Main workspace OPFS alias differs.');
        const output = await new Deno.Command('tar', { args: ['-xOzf', archive, 'package/mod.js'] }).output();
        if (!output.success || new TextDecoder().decode(output.stdout) !== 'export const value = 7;\\n') throw new Error('Copied archive behavior differs.');
        let refused = false;
        try { await Deno.writeTextFile(source+'/mod.js', 'export const value = 9;\\n'); }
        catch (error) { if (!(error instanceof Deno.errors.PermissionDenied)) throw error; refused = true; }
        if (!refused) throw new Error('Copied OPFS source accepted writes.');
        refused = false;
        try { await Deno.writeFile(archive, new Uint8Array([0])); }
        catch (error) { if (!(error instanceof Deno.errors.PermissionDenied)) throw error; refused = true; }
        if (!refused) throw new Error('Copied OPFS archive accepted writes.');
      `,
      )
      await commitFixture(value)
      success(await value.release('prepare'))
      const candidate = await read<
        {
          inputs: {
            source: { path: string; revision: string; version: string }
            archive: { path: string; sha256: string; version: string; exports: string[] }
          }
          gates: { file: string }
        }
      >(join(value.root, '.tmp/releases/prepared.json'))
      expect(candidate.inputs.source.path).toBe(value.env.OPFS_SOURCE)
      expect(candidate.inputs.source.revision).toMatch(/^[a-f0-9]{40}$/u)
      expect(candidate.inputs.source.version).toBe('0.1.0')
      expect(candidate.inputs.archive).toEqual({
        path: value.env.OPFS_TARBALL,
        sha256: value.env.OPFS_ARCHIVE_SHA256,
        version: '0.1.0',
        exports: ['./mod.js'],
      })
      expect((await read<{ inputs: unknown }>(join(value.root, candidate.gates.file))).inputs)
        .toEqual(candidate.inputs)
      await noUploads(value)
    })
  })

  for (const input of ['source', 'archive'] as const) {
    it(`rejects original OPFS ${input} mutation while gates continue to read independent copied bytes`, async () => {
      await fixture(async (value) => {
        const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
        config.tasks.quality = 'deno run -A change-input.ts'
        await json(join(value.root, 'deno.json'), config)
        const changed = input === 'source'
          ? join(value.env.OPFS_SOURCE!, 'mod.js')
          : value.env.OPFS_TARBALL!
        await Deno.writeTextFile(
          join(value.root, 'change-input.ts'),
          `
          await Deno.writeTextFile(${JSON.stringify(changed)}, 'original input changed');
          const source = Deno.env.get('OPFS_SOURCE'), archive = Deno.env.get('OPFS_TARBALL');
          if (await Deno.readTextFile(source+'/mod.js') !== 'export const value = 7;\\n') throw new Error('Copied source borrowed original bytes.');
          const output = await new Deno.Command('tar', { args: ['-xOzf', archive, 'package/mod.js'] }).output();
          if (!output.success || new TextDecoder().decode(output.stdout) !== 'export const value = 7;\\n') throw new Error('Copied archive borrowed original bytes.');
        `,
        )
        await commitFixture(value)
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        expect(await Deno.readTextFile(changed)).toBe('original input changed')
        const evidence = []
        for await (const item of Deno.readDir(join(value.root, '.tmp/releases'))) {
          if (item.name.startsWith('gates-')) {
            evidence.push(
              await read<{ passed: boolean; steps: Array<{ code: number }> }>(
                join(value.root, '.tmp/releases', item.name),
              ),
            )
          }
        }
        expect(evidence).toHaveLength(1)
        expect(evidence[0]!.passed).toBe(false)
        expect(evidence[0]!.steps[0]!.code).toBe(0)
        await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        await noUploads(value)
      })
    })
  }

  it('rejects uncommitted OPFS source and independently rejects an archive hash mismatch before gates', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(join(value.env.OPFS_SOURCE!, 'mod.js'), 'export const value = 9;\n')
      expect((await value.release('prepare')).success).toBe(false)
      await Deno.writeTextFile(join(value.env.OPFS_SOURCE!, 'mod.js'), 'export const value = 7;\n')
      value.env.OPFS_ARCHIVE_SHA256 = '0'.repeat(64)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain(
        'does not match OPFS_ARCHIVE_SHA256',
      )
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })

  for (const flaw of ['identity', 'version', 'missing export', 'linked export'] as const) {
    it(`rejects a supplied OPFS archive with ${flaw}`, async () => {
      await fixture(async (value) => {
        const stage = join(value.root, '.tmp/opfs-package')
        if (flaw === 'identity' || flaw === 'version') {
          await json(join(stage, 'package/package.json'), {
            name: flaw === 'identity' ? '@other/opfs' : '@okikio/opfs',
            version: flaw === 'version' ? '0.2.0' : '0.1.0',
            exports: './mod.js',
          })
        } else {
          await Deno.remove(join(stage, 'package/mod.js'))
          if (flaw === 'linked export') {
            await Deno.symlink('package.json', join(stage, 'package/mod.js'))
          }
        }
        success(await run(stage, 'tar', ['-czf', value.env.OPFS_TARBALL!, 'package']))
        delete value.env.OPFS_ARCHIVE_SHA256
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        expect(new TextDecoder().decode(result.stderr)).toContain(
          flaw === 'identity' || flaw === 'version'
            ? 'package name/version'
            : flaw === 'linked export'
            ? 'non-regular member'
            : 'regular archive file',
        )
        await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        await noUploads(value)
      })
    })
  }

  for (const failure of ['exit', 'overflow', 'stall'] as const) {
    it(`refuses a tar inspector ${failure} and stops its directly owned child`, async () => {
      await fixture(async (value) => {
        const node = await executable('node')
        const pidFile = join(value.root, '.tmp/tar-pid.txt')
        await Deno.writeTextFile(
          join(value.root, 'bin/tar'),
          `#!/bin/sh\nexec ${quote(node)} "$0".mjs "$@"\n`,
        )
        await Deno.writeTextFile(
          join(value.root, 'bin/tar.mjs'),
          `
          import { writeFileSync, writeSync } from 'node:fs';
          writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
          ${
            failure === 'exit'
              ? 'process.exit(9);'
              : failure === 'overflow'
              ? 'writeSync(1, Buffer.alloc(17 * 1024 * 1024, 97)); setInterval(() => {}, 1000);'
              : 'setInterval(() => {}, 1000);'
          }
        `,
        )
        await Deno.chmod(join(value.root, 'bin/tar'), 0o755)
        await commitFixture(value)
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        expect(new TextDecoder().decode(result.stderr)).toContain(
          failure === 'stall'
            ? '30-second admission deadline'
            : failure === 'overflow'
            ? 'metadata exceeds its admission limit'
            : 'Cannot inspect the OPFS archive',
        )
        const pid = Number(await Deno.readTextFile(pidFile))
        expect(() => Deno.kill(pid, 0)).toThrow(Deno.errors.NotFound)
        await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        await noUploads(value)
      })
    })
  }

  it('retains independent gate and cleanup failures without a passed receipt', async () => {
    await fixture(async (value) => {
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks.quality = 'deno run -A block-cleanup.ts'
      await json(join(value.root, 'deno.json'), config)
      await Deno.writeTextFile(
        join(value.root, 'block-cleanup.ts'),
        `
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/failed-snapshot.txt', Deno.cwd());
        await Deno.mkdir('.tmp/blocked');
        await Deno.writeTextFile('.tmp/blocked/owned.txt', 'owned cleanup fixture');
        await Deno.chmod('.tmp/blocked', 0);
        Deno.exit(9);
      `,
      )
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await commitFixture(value)
      const result = await value.release('prepare')
      await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/failed-snapshot.txt')),
      )
      const failures: unknown[] = []
      try {
        expect(result.success).toBe(false)
        await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        const files = []
        for await (const entry of Deno.readDir(join(value.root, '.tmp/releases'))) {
          if (entry.name.startsWith('gates-')) files.push(entry.name)
        }
        expect(files).toHaveLength(1)
        const evidence = await read<
          { passed: boolean; failures: string[]; steps: Array<{ code: number }> }
        >(join(value.root, '.tmp/releases', files[0]!))
        expect(evidence.passed).toBe(false)
        expect(evidence.failures.length).toBeGreaterThanOrEqual(2)
        expect(evidence.steps[0]!.code).toBe(9)
        await noUploads(value)
      } catch (reason) {
        failures.push(reason)
      } finally {
        // The denied snapshot is contained in parent-owned storage. Markers never authorize deletion.
        try {
          await retireSnapshots(value.root)
        } catch (reason) {
          failures.push(reason)
        }
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Cleanup-failure fixture and repair failed.', {
          cause: failures[0],
        })
      }
    })
  })

  it('rejects dependency aliases into uncommitted source instead of borrowing them', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp/uncommitted-package')
      await Deno.mkdir(outside)
      await Deno.writeTextFile(join(outside, 'mod.js'), 'export const value = 9;\n')
      await Deno.mkdir(join(value.root, 'node_modules/@fixture'), { recursive: true })
      await Deno.symlink(outside, join(value.root, 'node_modules/@fixture/uncommitted'), {
        type: 'dir',
      })
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('refuses a receipt when an original-source edit remains after snapshot gates', async () => {
    await fixture(async (value) => {
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks.quality = 'deno run -A change-original.ts'
      await json(join(value.root, 'deno.json'), config)
      await Deno.writeTextFile(
        join(value.root, 'change-original.ts'),
        "await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/mod.js','export const value = 9;\\n');\n",
      )
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      expect(await Deno.readTextFile(join(value.root, 'mod.js'))).toBe('export const value = 9;\n')
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('rejects changed durable gate evidence before any registry command', async () => {
    await fixture(async (value) => {
      success(await value.release('prepare'))
      const candidate = await read<{ gates: { file: string } }>(
        join(value.root, '.tmp/releases/prepared.json'),
      )
      await Deno.writeTextFile(join(value.root, candidate.gates.file), '{}\n')
      const result = await value.release('upload', '@okikio/rdf', '0.1.0', 'npm')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('gate evidence changed')
      await noUploads(value)
    })
  })

  it('rejects initially dirty source before running preparation gates', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(join(value.root, 'mod.js'), 'export const value = 9;\n')
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('clean immutable checkout')
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('builds committed snapshot bytes despite original A-to-B-to-A edits between gates', async () => {
    await fixture(async (value) => {
      await Deno.mkdir(join(value.root, 'linked'))
      await Deno.writeTextFile(join(value.root, 'linked/mod.js'), 'export const value = 7;\n')
      await json(join(value.root, 'linked/package.json'), {
        name: '@fixture/source',
        type: 'module',
        exports: './mod.js',
      })
      await Deno.mkdir(join(value.root, 'node_modules/@fixture'), { recursive: true })
      await Deno.symlink(
        join(value.root, 'linked'),
        join(value.root, 'node_modules/@fixture/source'),
        { type: 'dir' },
      )
      await Deno.mkdir(join(value.root, '.tmp/reports'), { recursive: true })
      await Deno.writeTextFile(
        join(value.root, '.tmp/reports/local-review.txt'),
        'retain this local review',
      )
      await Deno.mkdir(join(value.root, 'node_modules/.bin'), { recursive: true })
      await Deno.writeTextFile(
        join(value.root, 'node_modules/.bin/snapshot-check'),
        '#!/bin/sh\nprintf "snapshot-executable\\n"\n',
      )
      await Deno.chmod(join(value.root, 'node_modules/.bin/snapshot-check'), 0o755)
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks.quality = 'deno run -A change-original.ts'
      await json(join(value.root, 'deno.json'), config)
      await Deno.writeTextFile(
        join(value.root, 'change-original.ts'),
        `
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/mod.js','export const value = 9;\\n');
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/snapshot-root.txt', Deno.cwd());
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/linked/mod.js','export const value = 9;\\n');
        await Deno.mkdir('.tmp/reports', { recursive: true });
        await Deno.writeTextFile('.tmp/reports/clone-proof.txt', 'report from committed snapshot');
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/node_modules/.bin/snapshot-check', '#!/bin/sh\\nexit 9\\n');
        const executable = await new Deno.Command('./node_modules/.bin/snapshot-check').output();
        if (!executable.success || new TextDecoder().decode(executable.stdout) !== 'snapshot-executable\\n') throw new Error('Snapshot executable bytes/mode were borrowed');
        if ((await import('./mod.js')).value !== 7) throw new Error('Snapshot borrowed original source');
        if ((await import('./node_modules/@fixture/source/mod.js')).value !== 7) throw new Error('Snapshot borrowed original alias');
      `,
      )
      const pack = join(value.root, 'pack.ts')
      await Deno.writeTextFile(
        pack,
        await Deno.readTextFile(pack) +
          "\nawait Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/mod.js','export const value = 7;\\n');\n",
      )
      await Deno.writeTextFile(
        pack,
        await Deno.readTextFile(pack) +
          "\nawait Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/linked/mod.js','export const value = 7;\\n');\n",
      )
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await commitFixture(value)
      success(await value.release('prepare'))
      // Extract the actual tar member. Expected bytes are an authored oracle,
      // independent from the source hash or the candidate's own receipt.
      const extracted = await run(value.root, 'tar', [
        '-xOf',
        '.tmp/packages/okikio-rdf-0.1.0.tgz',
        'package/mod.js',
      ])
      success(extracted)
      expect(new TextDecoder().decode(extracted.stdout)).toBe('export const value = 7;\n')
      expect(await Deno.readTextFile(join(value.root, 'mod.js'))).toBe('export const value = 7;\n')
      const candidate = await read<{ gates: { file: string }; source: string; revision: string }>(
        join(value.root, '.tmp/releases/prepared.json'),
      )
      const evidence = await read<
        {
          passed: boolean
          source: string
          revision: string
          steps: Array<{ source: string }>
          reports: { path: string; source: string; revision: string }
        }
      >(join(value.root, candidate.gates.file))
      expect(evidence.passed).toBe(true)
      expect(evidence.source).toBe(candidate.source)
      expect(evidence.revision).toBe(candidate.revision)
      expect(evidence.steps.length).toBeGreaterThan(1)
      expect(evidence.steps.every((step) => step.source === candidate.source)).toBe(true)
      expect(await Deno.readTextFile(join(value.root, '.tmp/reports/local-review.txt'))).toBe(
        'retain this local review',
      )
      expect(evidence.reports.source).toBe(candidate.source)
      expect(evidence.reports.revision).toBe(candidate.revision)
      expect(await Deno.readTextFile(join(value.root, evidence.reports.path, 'clone-proof.txt')))
        .toBe('report from committed snapshot')
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/snapshot-root.txt')),
        true,
      )
      await expect(Deno.lstat(join(snapshot, '..'))).rejects.toThrow(Deno.errors.NotFound)
      await noUploads(value)
    })
  })

  it('rejects source edits during passing gates before recording a prepared release', async () => {
    await fixture(async (value) => {
      const path = join(value.root, 'deno.json')
      const config = await read<{ tasks: Record<string, string> }>(path)
      config.tasks.quality = 'deno run --allow-read --allow-write check.ts'
      await json(path, config)
      await Deno.writeTextFile(
        join(value.root, 'check.ts'),
        `await Deno.writeTextFile(${
          JSON.stringify(join(value.root, '.tmp/failed-snapshot.txt'))
        }, Deno.cwd());
        await Deno.writeTextFile('gate-change.txt', 'edit during validation');\n`,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/failed-snapshot.txt')),
        true,
      )
      await expect(Deno.lstat(join(snapshot, '..'))).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })

  it('rejects npm/Deno metadata disagreement before planning', async () => {
    await fixture(async (value) => {
      await json(join(value.root, 'package.json'), { name: '@okikio/rdf', version: '0.2.0' })
      const result = await value.release('plan')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('metadata disagree')
      await noUploads(value)
    })
  })

  it('uses Bumpy for rich stories, synchronized manifests and dependency propagation', async () => {
    await fixture(async (value) => {
      const story =
        '### Preserve exact bytes\n\nA complete explanation.\n\n```ts\nawait store.save(bytes);\n```\n\n| Input | Result |\n| --- | --- |\n| bytes | same bytes |'
      await Deno.writeTextFile(
        join(value.root, '.bumpy/bytes.md'),
        `---\n"@release/core": minor\n---\n\n${story}\n`,
      )
      const plan = await value.release('plan')
      success(plan)
      const parsed = JSON.parse(new TextDecoder().decode(plan.stdout)) as {
        releases: Array<{ name: string; newVersion: string }>
      }
      expect(parsed.releases).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '@release/core', newVersion: '0.2.0' }),
        expect.objectContaining({ name: '@release/app', newVersion: '0.1.1' }),
      ]))
      success(await value.release('version'))
      const storyPath = join(value.root, '.tmp/story.md')
      await Deno.mkdir(join(value.root, '.tmp'), { recursive: true })
      await Deno.writeTextFile(storyPath, story)
      success(await run(value.root, Deno.execPath(), ['fmt', storyPath]))
      for (const [name, version] of [['core', '0.2.0'], ['app', '0.1.1']]) {
        expect(
          (await read<{ version: string }>(join(value.root, 'packages', name!, 'package.json')))
            .version,
        ).toBe(
          version,
        )
        expect(
          (await read<{ version: string }>(join(value.root, 'packages', name!, 'deno.json')))
            .version,
        ).toBe(
          version,
        )
      }
      expect(await Deno.readTextFile(join(value.root, 'packages/core/CHANGELOG.md'))).toContain(
        (await Deno.readTextFile(storyPath)).trim(),
      )
      success(
        await run(value.root, Deno.execPath(), [
          'fmt',
          '--check',
          'packages/core/CHANGELOG.md',
          'packages/app/CHANGELOG.md',
        ]),
      )
      expect(
        (await read<{ dependencies: Record<string, string> }>(
          join(value.root, 'packages/app/package.json'),
        ))
          .dependencies['@release/core'],
      ).toBe('workspace:~0.2.0')
      expect(await Deno.readTextFile(join(value.root, 'packages/app/CHANGELOG.md'))).toContain(
        '@release/core@0.2.0',
      )
    }, true)
  })

  for (const updateRevision of [false, true]) {
    it(`rejects changed prepared ${updateRevision ? 'source independently from' : 'Git revision despite'} a clean checkout`, async () => {
      await fixture(async (value) => {
        success(await value.release('prepare'))
        await Deno.writeTextFile(join(value.root, 'mod.js'), 'export const value = 9;\n')
        success(await run(value.root, 'git', ['add', 'mod.js']))
        success(
          await run(value.root, 'git', [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '-m',
            'test: change source',
          ]),
        )
        if (updateRevision) {
          // Alter only the claimed revision, so this control reaches the independent source-content guard.
          const path = join(value.root, '.tmp/releases/prepared.json')
          const candidate = await read<Record<string, unknown>>(path)
          const revision = await run(value.root, 'git', ['rev-parse', 'HEAD'])
          success(revision)
          await json(path, {
            ...candidate,
            revision: new TextDecoder().decode(revision.stdout).trim(),
          })
        }
        const result = await value.release('upload', '@okikio/rdf', '0.1.0', 'npm')
        expect(result.success).toBe(false)
        expect(new TextDecoder().decode(result.stderr)).toContain(
          updateRevision ? 'Source changed' : 'Prepared revision',
        )
        await noUploads(value)
      })
    })
  }

  it('rejects an altered prepared archive before admitting a registry upload', async () => {
    await fixture(async (value) => {
      success(await value.release('prepare'))
      await Deno.writeTextFile(
        join(value.root, '.tmp/packages/okikio-rdf-0.1.0.tgz'),
        'changed archive',
      )
      const result = await value.release('upload', '@okikio/rdf', '0.1.0', 'npm')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('Release archive changed')
      await noUploads(value)
    })
  })

  it('rejects direct upload from a dirty prepared checkout', async () => {
    await fixture(async (value) => {
      success(await value.release('prepare'))
      await Deno.writeTextFile(join(value.root, 'extra.txt'), 'uncommitted candidate\n')
      const result = await value.release('upload', '@okikio/rdf', '0.1.0', 'npm')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('clean immutable checkout')
      await noUploads(value)
    })
  })

  for (const different of [false, true]) {
    it(`${different ? 'rejects differing' : 'accepts exact matching'} existing npm bytes without uploading`, async () => {
      await fixture(async (value) => {
        success(await value.release('prepare'))
        await registry(value, { npm: true, different })
        const result = await value.release('publish', 'npm')
        expect(result.success).toBe(!different)
        if (different) {
          expect(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr))
            .toContain(
              'npm bytes differ',
            )
        }
        await noUploads(value)
      })
    })
  }

  it('observes the origin JSR version despite a cached missing-version response', async () => {
    await fixture(async (value) => {
      await registry(value, { staleJsr: true })
      const preflight = await value.release('registry', 'jsr')
      success(preflight)
      expect(JSON.parse(new TextDecoder().decode(preflight.stdout)).published).toBe(false)
      await registry(value, { jsr: true })
      for (let observation = 0; observation < 2; observation++) {
        const result = await value.release('registry', 'jsr')
        success(result)
        expect(JSON.parse(new TextDecoder().decode(result.stdout)).published).toBe(true)
      }
      await noUploads(value)
    })
  })

  it('treats HTTP401 as a registry failure rather than available version', async () => {
    await fixture(async (value) => {
      success(await value.release('prepare'))
      await registry(value, { status: 401 })
      const result = await value.release('publish', 'npm')
      expect(result.success).toBe(false)
      expect(new TextDecoder().decode(result.stderr)).toContain('HTTP 401')
      await noUploads(value)
    })
  })

  it('retains a proven JSR phase after npm interruption and retries only npm with the same archive', async () => {
    await fixture(async (value) => {
      success(await value.release('prepare'))
      const candidate = await read<
        { source: string; revision: string; packages: Array<{ sha256: string }> }
      >(
        join(value.root, '.tmp/releases/prepared.json'),
      )
      const receipt = join(value.root, '.tmp/releases/-okikio-rdf-0.1.0-jsr.json')
      const archive = await Deno.readFile(join(value.root, '.tmp/packages/okikio-rdf-0.1.0.tgz'))
      await json(receipt, {
        source: candidate.source,
        revision: candidate.revision,
        archiveSha256: candidate.packages[0]!.sha256,
      })
      await registry(value, { jsr: true, failUpload: true })
      expect((await value.release('publish', 'both')).success).toBe(false)
      const completed = await Deno.readTextFile(receipt)
      await registry(value, { failUpload: false })
      success(await value.release('publish', 'npm'))
      expect(await Deno.readTextFile(receipt)).toBe(completed)
      const uploads = (await read<RegistryType>(value.env.REGISTRY_STATE!)).uploads
      expect(uploads).toHaveLength(2)
      expect(
        uploads.every((args) => args[0] === 'publish' && args[1]!.endsWith('okikio-rdf-0.1.0.tgz')),
      ).toBe(true)
      const npm = await read<{ archiveSha256: string }>(
        join(value.root, '.tmp/releases/-okikio-rdf-0.1.0-npm.json'),
      )
      expect(npm.archiveSha256).toBe(candidate.packages[0]!.sha256)
      expect(await Deno.readFile(join(value.root, '.tmp/packages/okikio-rdf-0.1.0.tgz'))).toEqual(
        archive,
      )
    })
  })
})

/** Fakes only the registry command boundary; real Bumpy and the real candidate tarball remain unchanged. */
const REGISTRY = `
import {readFileSync,writeFileSync} from 'node:fs';
const path=process.env.REGISTRY_STATE;const state=JSON.parse(readFileSync(path,'utf8'));const args=process.argv.slice(2);
if(process.env.REGISTRY_COMMAND==='npm'){
  if(args[0]!=='publish')throw new Error('Unexpected fake npm operation');
  state.uploads.push(args);writeFileSync(path,JSON.stringify(state));
  if(state.failUpload)process.exit(9);
  state.npm=true;writeFileSync(path,JSON.stringify(state));process.exit(0);
}
const url=args.at(-1);const npm=url.startsWith('https://registry.npmjs.org/');
if(url.endsWith('.tgz')){process.stdout.write(state.different?Buffer.from('different archive'):readFileSync(state.archive));process.exit(0);}
const origin=state.status??((npm?state.npm:state.jsr)?200:404);
let status=origin;
if(!npm&&state.staleJsr){state.jsrCache??={};status=state.jsrCache[url]??=origin;writeFileSync(path,JSON.stringify(state));}
const body=JSON.stringify({name:'@okikio/rdf',version:'0.1.0',dist:{tarball:'https://registry.npmjs.org/@okikio/rdf/-/opfs-0.1.0.tgz'}});
process.stdout.write(body+(args.includes('--write-out')?'\\n'+status:''));
if(args.includes('--fail')&&status>=400)process.exit(22);
`

/** Copies the pinned bundled release implementation, not the project's unrelated dependency tree. */
async function fixtureDependencies(root: string, source: URL): Promise<void> {
  const from = await Deno.realPath(fileURLToPath(new URL('node_modules/@varlock/bumpy', source)))
  const metadata = await read<{ version: string; dependencies?: Record<string, string> }>(
    join(from, 'package.json'),
  )
  if (metadata.version !== '1.18.1' || Object.keys(metadata.dependencies ?? {}).length !== 0) {
    throw new Error('Release fixture expects the pinned bundled Bumpy implementation.')
  }
  await copy(from, join(root, 'node_modules/@varlock/bumpy'))
  await Deno.mkdir(join(root, '.tmp/deno-cache'), { recursive: true })
  /** Owns copied fixture dependency bytes; no link points at the project checkout. */
  async function copy(from: string, to: string): Promise<void> {
    const info = await Deno.lstat(from)
    if (info.isDirectory) {
      await Deno.mkdir(to, { recursive: true })
      for await (const entry of Deno.readDir(from)) {
        await copy(join(from, entry.name), join(to, entry.name))
      }
    } else if (info.isFile) await Deno.copyFile(from, to)
    else throw new Error('Bundled Bumpy fixture contains an unexpected alias.')
  }
}

/** Commits intentional test-control edits before immutable preparation begins. */
async function commitFixture(value: FixtureType): Promise<void> {
  success(await run(value.root, 'git', ['add', '.']))
  success(
    await run(value.root, 'git', [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'test: freeze gate controls',
    ]),
  )
}

/** Complete gate outcomes and independent Git authority bytes are behavioral release evidence. */
interface AuthorityEvidenceType {
  readonly passed: boolean
  readonly steps?: readonly {
    readonly task: string
    readonly code: number | null
    readonly execution?: {
      readonly state: string
      readonly success?: boolean
      readonly signal?: string | null
    }
    readonly integrity?: {
      readonly source: { readonly state: string }
      readonly revision: { readonly state: string }
    }
  }[]
  readonly reports?: {
    readonly path: string
    readonly source: string
    readonly revision: string
    readonly copyState: 'partial' | 'complete'
    readonly catalog?: { readonly path: string; readonly sha256: string | null }
    readonly entries?: number
    readonly outcome: 'pending' | 'passed' | 'failed'
    readonly sourceIdentity: 'expected' | 'verified'
  }
  readonly diagnostics?: readonly AuthorityFailureType[]
  readonly failures?: readonly unknown[]
}
/** Git observations retain bytes separately from their human-readable rendering. */
interface AuthorityFailureType {
  readonly name: string
  readonly message: string
  readonly report?: { readonly stage: 'admission' | 'copy' }
  readonly snapshot?: { readonly stage: 'admission' }
  readonly selection?: { readonly variable: string }
  readonly git?: {
    readonly cwd: string
    readonly args: readonly string[]
    readonly state: string
    readonly code: number | null
    readonly signal: string | null
    readonly stdout: readonly number[] | null
    readonly stderr: readonly number[] | null
  }
  readonly cause?: AuthorityFailureType
  readonly errors?: readonly AuthorityFailureType[]
}
/** Reads only this invocation's owned journal; directory traversal order is not an oracle. */
async function authorityJournal(
  value: FixtureType,
  prefix: string,
): Promise<AuthorityEvidenceType> {
  const paths = []
  for await (const entry of Deno.readDir(join(value.root, '.tmp/releases'))) {
    if (entry.name.startsWith(prefix)) paths.push(entry.name)
  }
  expect(paths).toHaveLength(1)
  return await read<AuthorityEvidenceType>(join(value.root, '.tmp/releases', paths[0]!))
}
/** Finds structured causes without depending on localized Git error wording. */
function authorityFailures(rows: readonly AuthorityFailureType[]): AuthorityFailureType[] {
  return rows.flatMap(
    (row) => [
      row,
      ...(row.cause ? authorityFailures([row.cause]) : []),
      ...authorityFailures(row.errors ?? []),
    ],
  )
}

/** Intended admission faults must reach their deliberate exit; preserve setup stdout/stderr when they do not. */
function reportFaultExit(
  journal: AuthorityEvidenceType,
  task: string,
  result: Deno.CommandOutput,
): void {
  try {
    expect(journal.steps!.find((row) => row.task === task)!.code).toBe(9)
  } catch (reason) {
    throw new AggregateError(
      [
        reason,
        new Error(
          new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
        ),
      ],
      'Report fault setup did not reach the deliberate exit 9.',
      { cause: reason },
    )
  }
}

describe('Release source authority outcomes', { skip: Deno.build.os === 'windows' }, () => {
  it('retains outside bytes when markers or links point outside owned snapshot storage', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp', 'outside-owned-snapshots.txt')
      await Deno.writeTextFile(outside, 'outside sentinel')
      const marker = join(value.root, '.tmp', 'wrong-snapshot-marker')
      await Deno.writeTextFile(marker, value.root)
      await expect(snapshotPath(value, value.root)).rejects.toThrow(
        'outside the owned fixture namespace',
      )
      expect(await Deno.readTextFile(marker)).toBe(value.root)
      const owned = await Deno.makeTempDir({ dir: value.snapshots })
      await Deno.mkdir(join(owned, 'source'))
      await Deno.symlink(outside, join(owned, 'source', 'outside-link'))
      await Deno.writeTextFile(join(owned, 'source', 'denied.txt'), 'owned')
      await Deno.chmod(join(owned, 'source'), 0)
      for (const observed of ['', value.root, join(value.snapshots, '..'), outside]) {
        await expect(snapshotPath(value, observed)).rejects.toThrow(
          'outside the owned fixture namespace',
        )
      }
      expect(await snapshotPath(value, join(owned, 'source'))).toBe(join(owned, 'source'))
      const absent = join(owned, 'not-created')
      await expect(snapshotPath(value, absent)).rejects.toThrow(Deno.errors.NotFound)
      expect(await snapshotPath(value, absent, true)).toBe(absent)
      const nested = join(owned, 'nested', 'arbitrary', 'directory')
      await Deno.mkdir(nested, { recursive: true })
      expect(await snapshotPath(value, nested)).toBe(nested)
      const physical = await Deno.realPath(nested)
      expect(await snapshotPath(value, physical)).toBe(physical)
      await Deno.symlink(join(value.root, '.tmp'), join(owned, 'escaped-directory'))
      await expect(snapshotPath(value, join(owned, 'escaped-directory'))).rejects.toThrow(
        'owned canonical directory',
      )
      await retireSnapshots(value.root)
      expect(await Deno.readTextFile(outside)).toBe('outside sentinel')
      await expect(Deno.lstat(value.snapshots)).rejects.toThrow(Deno.errors.NotFound)
    })
  })

  it('retains real Git admission rejection before any gate or upload', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(join(value.root, '.git/HEAD'), 'invalid-ref\n')
      const expected = await run(value.root, 'git', [
        '-c',
        'core.fsmonitor=false',
        'status',
        '--porcelain',
      ], { GIT_CEILING_DIRECTORIES: dirname(await Deno.realPath(value.root)) })
      expect(expected.success).toBe(false)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'authority-')
      expect(journal.passed).toBe(false)
      const observations = authorityFailures(journal.diagnostics ?? []).filter((row) => row.git)
      expect(observations).toHaveLength(1)
      expect(observations[0]!.git).toEqual({
        cwd: await Deno.realPath(value.root),
        args: ['-c', 'core.fsmonitor=false', 'status', '--porcelain'],
        state: 'exited',
        code: expected.code,
        signal: expected.signal,
        stdout: Array.from(expected.stdout),
        stderr: Array.from(expected.stderr),
      })
      await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  for (const gitFault of [false, true]) {
    it(`retains failed gate binary/JSON reports with Git fault ${gitFault} before snapshot cleanup`, async () => {
      await fixture(async (value) => {
        const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
        config.tasks['verify'] = 'deno run -A failed-reports.ts'
        await json(join(value.root, 'deno.json'), config)
        value.env.ORIGINAL_RELEASE_ROOT = value.root
        await Deno.writeTextFile(
          join(value.root, 'failed-reports.ts'),
          `
          await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/report-snapshot',Deno.cwd());
          await Deno.mkdir('.tmp/reports/consumer-copy/nested',{recursive:true});
          await Deno.writeFile('.tmp/reports/consumer-copy/nested/raw.bin',new Uint8Array([0,255,128,1,17]));
          await Deno.writeTextFile('.tmp/reports/consumer-copy/result.json',JSON.stringify({code:9,capture:'failed',binary:'nested/raw.bin'}));
          ${
            gitFault
              ? "await Deno.writeTextFile('.git/HEAD'," + JSON.stringify('invalid-ref\n') + ');'
              : ''
          }
          Deno.exit(9);
        `,
        )
        await commitFixture(value)
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        const journal = await authorityJournal(value, 'gates-')
        expect(journal.passed).toBe(false)
        reportFaultExit(journal, 'verify', result)
        expect(journal.reports).toBeDefined()
        expect(journal.reports!.copyState).toBe('complete')
        expect(journal.reports!.outcome).toBe('failed')
        expect(journal.reports!.sourceIdentity).toBe('expected')
        const target = join(value.root, journal.reports!.path, 'consumer-copy')
        expect(await Deno.readFile(join(target, 'nested/raw.bin'))).toEqual(
          new Uint8Array([0, 255, 128, 1, 17]),
        )
        expect(await read(join(target, 'result.json'))).toEqual({
          code: 9,
          capture: 'failed',
          binary: 'nested/raw.bin',
        })
        if (gitFault) {
          expect(authorityFailures(journal.diagnostics ?? []).filter((row) => row.git).length)
            .toBeGreaterThanOrEqual(2)
        }
        const snapshot = await snapshotPath(
          value,
          await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
          true,
        )
        await expect(Deno.lstat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
        await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        await noUploads(value)
      })
    })
  }
  it('retains escaped diagnostic metadata without replacing the actual gate failure', async () => {
    await fixture(async (value) => {
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A escaped-report.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'escaped-report.ts'),
        `
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/report-snapshot',Deno.cwd());
        await Deno.writeTextFile('.tmp/outside-report.txt','outside report authority');
        await Deno.mkdir('.tmp/reports',{recursive:true});
        await Deno.symlink('../outside-report.txt','.tmp/reports/escaped');
        await Deno.symlink('missing-firefox-lock-owner','.tmp/reports/dangling');
        await Deno.writeFile('.tmp/reports/after-alias.bin',new Uint8Array([0,255,128,17]));
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      expect(journal.passed).toBe(false)
      reportFaultExit(journal, 'verify', result)
      expect(journal.reports!.copyState).toBe('complete')
      expect(journal.reports!.outcome).toBe('failed')
      expect(journal.reports!.sourceIdentity).toBe('expected')
      expect(
        authorityFailures(journal.diagnostics ?? []).some((row) =>
          row.name === 'ReportError' && row.report?.stage === 'copy'
        ),
      ).toBe(false)
      expect(journal.reports!.catalog).toBeDefined()
      const catalog = await reportCatalog(join(value.root, journal.reports!.catalog!.path))
      expect(catalog.find((entry) => entry.path === 'escaped')).toMatchObject({
        kind: 'link',
        representation: 'inert',
      })
      expect(catalog.find((entry) => entry.path === 'dangling')).toMatchObject({
        kind: 'link',
        representation: 'inert',
      })
      expect(await Deno.readFile(join(value.root, journal.reports!.path, 'after-alias.bin')))
        .toEqual(new Uint8Array([0, 255, 128, 17]))
      await expect(Deno.lstat(join(value.root, journal.reports!.path, 'escaped'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
        true,
      )
      await expect(Deno.lstat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  for (const kind of ['file', 'escaped alias'] as const) {
    it(`rejects report root ${kind} without capturing outside bytes or suppressing cleanup`, async () => {
      await fixture(async (value) => {
        const outside = join(value.root, '.tmp', 'outside-report-root')
        await Deno.mkdir(outside)
        await Deno.writeFile(join(outside, 'sentinel.bin'), new Uint8Array([2, 255, 0, 128]))
        const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
        config.tasks['verify'] = 'deno run -A report-root-kind.ts'
        await json(join(value.root, 'deno.json'), config)
        value.env.ORIGINAL_RELEASE_ROOT = value.root
        await Deno.writeTextFile(
          join(value.root, 'report-root-kind.ts'),
          `
          await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/report-snapshot',Deno.cwd());
          await Deno.mkdir('.tmp/reports',{recursive:true});
          await Deno.remove('.tmp/reports',{recursive:true});
          ${
            kind === 'file'
              ? "await Deno.writeFile('.tmp/reports',new Uint8Array([0,1,255]));"
              : "await Deno.symlink(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/outside-report-root','.tmp/reports');"
          }
          Deno.exit(9);
        `,
        )
        await commitFixture(value)
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        const journal = await authorityJournal(value, 'gates-')
        expect(journal.passed).toBe(false)
        reportFaultExit(journal, 'verify', result)
        expect(journal.reports).toBeUndefined()
        expect(
          authorityFailures(journal.diagnostics ?? []).some((row) =>
            row.name === 'ReportError' && row.report?.stage === 'admission'
          ),
        ).toBe(true)
        expect(await Deno.readFile(join(outside, 'sentinel.bin'))).toEqual(
          new Uint8Array([2, 255, 0, 128]),
        )
        const snapshot = await snapshotPath(
          value,
          await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
          true,
        )
        await expect(Deno.lstat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
        await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
          Deno.errors.NotFound,
        )
        await noUploads(value)
      })
    })
  }
  it('does not restore an outside file through a replaced protected source entry', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp', 'outside-permission-sentinel.bin')
      const bytes = new Uint8Array([0, 255, 57, 128])
      await Deno.writeFile(outside, bytes)
      await Deno.chmod(outside, 0o400)
      const mode = (await Deno.lstat(outside)).mode
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A source-alias.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'source-alias.ts'),
        `
        const original=Deno.env.get('ORIGINAL_RELEASE_ROOT');
        await Deno.writeTextFile(original+'/.tmp/report-snapshot',Deno.cwd());
        await Deno.chmod('.',0o755);
        await Deno.remove('mod.js');
        await Deno.symlink(original+'/.tmp/outside-permission-sentinel.bin','mod.js');
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      reportFaultExit(journal, 'verify', result)
      expect(journal.passed).toBe(false)
      expect(journal.steps!.find((row) => row.task === 'verify')!.integrity?.source.state).toBe(
        'failed',
      )
      expect((await Deno.lstat(outside)).mode).toBe(mode)
      expect(await Deno.readFile(outside)).toEqual(bytes)
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
        true,
      )
      await expect(Deno.lstat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('restores safely renamed protected descendants before removing their acquired owner', async () => {
    await fixture(async (value) => {
      await Deno.mkdir(join(value.root, 'protected-input'))
      await Deno.writeTextFile(
        join(value.root, 'protected-input', 'value.ts'),
        'export const value = 31;\n',
      )
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A source-rename.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'source-rename.ts'),
        `
        const original=Deno.env.get('ORIGINAL_RELEASE_ROOT');
        await Deno.writeTextFile(original+'/.tmp/report-snapshot',Deno.cwd());
        await Deno.chmod('.',0o755);
        await Deno.rename('protected-input','displaced-input');
        // Its directory and file remain protected after the rename. Successful
        // owner removal below requires restoring that physical directory.
        await Deno.writeTextFile(original+'/.tmp/renamed-modes.json',JSON.stringify({
          directory:(await Deno.lstat('displaced-input')).mode,
          file:(await Deno.lstat('displaced-input/value.ts')).mode
        }));
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      reportFaultExit(journal, 'verify', result)
      expect(journal.passed).toBe(false)
      expect(journal.steps!.find((row) => row.task === 'verify')!.integrity?.source.state).toBe(
        'failed',
      )
      const modes = await read<{ directory: number; file: number }>(
        join(value.root, '.tmp/renamed-modes.json'),
      )
      expect(modes.directory & 0o222).toBe(0)
      expect(modes.file & 0o222).toBe(0)
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
        true,
      )
      await expect(Deno.lstat(dirname(snapshot))).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('skips a replaced snapshot root and retires its renamed physical tree without changing borrowed modes', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp', 'outside-snapshot-root')
      await Deno.mkdir(outside)
      const bytes = new Uint8Array([0, 255, 91, 128])
      await Deno.writeFile(join(outside, 'mod.js'), bytes)
      await Deno.chmod(outside, 0o700)
      await Deno.chmod(join(outside, 'mod.js'), 0o400)
      const directoryMode = (await Deno.lstat(outside)).mode
      const fileMode = (await Deno.lstat(join(outside, 'mod.js'))).mode
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A snapshot-alias.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'snapshot-alias.ts'),
        `
        import { dirname, resolve } from 'node:path';
        const original=Deno.env.get('ORIGINAL_RELEASE_ROOT');
        const snapshot=Deno.cwd();
        await Deno.writeTextFile(original+'/.tmp/report-snapshot',snapshot);
        await Deno.rename(snapshot,resolve(dirname(snapshot),'displaced-source'));
        await Deno.symlink(original+'/.tmp/outside-snapshot-root',snapshot);
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      reportFaultExit(journal, 'verify', result)
      expect(journal.passed).toBe(false)
      const admissions = authorityFailures(journal.diagnostics ?? [])
      expect(admissions.filter((row) => row.snapshot?.stage === 'admission').length)
        .toBeGreaterThanOrEqual(2)
      expect(admissions.filter((row) => row.git)).toHaveLength(0)
      const step = journal.steps!.find((row) => row.task === 'verify')!
      expect(step.integrity?.source.state).toBe('failed')
      expect(step.integrity?.revision.state).toBe('failed')
      expect(journal.steps!.find((row) => row.task === 'verify')!.integrity?.source.state).toBe(
        'failed',
      )
      expect(
        authorityFailures(journal.diagnostics ?? []).some((row) =>
          row.name === 'ReportError' && row.report?.stage === 'admission'
        ),
      ).toBe(true)
      expect((await Deno.lstat(outside)).mode).toBe(directoryMode)
      expect((await Deno.lstat(join(outside, 'mod.js'))).mode).toBe(fileMode)
      expect(await Deno.readFile(join(outside, 'mod.js'))).toEqual(bytes)
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
        true,
      )
      await expect(Deno.lstat(dirname(snapshot))).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('refuses a replaced temporary owner without reading its reports or mutating borrowed modes', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp', 'outside-temporary-owner')
      await Deno.mkdir(join(outside, 'source', '.tmp', 'reports'), { recursive: true })
      const bytes = new Uint8Array([0, 255, 101, 128])
      await Deno.writeFile(join(outside, 'source', 'mod.js'), bytes)
      await Deno.writeFile(join(outside, 'source', '.tmp', 'reports', 'borrowed.bin'), bytes)
      await Deno.chmod(outside, 0o700)
      await Deno.chmod(join(outside, 'source'), 0o700)
      await Deno.chmod(join(outside, 'source', 'mod.js'), 0o400)
      const mode = (await Deno.lstat(outside)).mode
      const sourceMode = (await Deno.lstat(join(outside, 'source'))).mode
      const fileMode = (await Deno.lstat(join(outside, 'source', 'mod.js'))).mode
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A temporary-owner-alias.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'temporary-owner-alias.ts'),
        `
        import { dirname, resolve } from 'node:path';
        const original=Deno.env.get('ORIGINAL_RELEASE_ROOT');
        const acquired=dirname(Deno.cwd());
        await Deno.rename(acquired,resolve(dirname(acquired),'displaced-owner'));
        await Deno.symlink(original+'/.tmp/outside-temporary-owner',acquired);
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      reportFaultExit(journal, 'verify', result)
      expect(journal.passed).toBe(false)
      const admissions = authorityFailures(journal.diagnostics ?? [])
      expect(admissions.filter((row) => row.snapshot?.stage === 'admission').length)
        .toBeGreaterThanOrEqual(2)
      expect(admissions.filter((row) => row.git)).toHaveLength(0)
      const step = journal.steps!.find((row) => row.task === 'verify')!
      expect(step.integrity?.source.state).toBe('failed')
      expect(step.integrity?.revision.state).toBe('failed')
      expect(journal.reports).toBeUndefined()
      expect(
        authorityFailures(journal.diagnostics ?? []).some((row) =>
          row.name === 'ReportError' && row.report?.stage === 'admission'
        ),
      ).toBe(true)
      expect((await Deno.lstat(outside)).mode).toBe(mode)
      expect((await Deno.lstat(join(outside, 'source'))).mode).toBe(sourceMode)
      expect((await Deno.lstat(join(outside, 'source', 'mod.js'))).mode).toBe(fileMode)
      expect(await Deno.readFile(join(outside, 'source', 'mod.js'))).toEqual(bytes)
      expect(await Deno.readFile(join(outside, 'source', '.tmp', 'reports', 'borrowed.bin')))
        .toEqual(bytes)
      // The release tool refuses deletion at the replaced root. The parent fixture
      // later repairs only its own pre-acquired namespace, without following links.
      const entries = Array.from(Deno.readDirSync(value.snapshots))
      expect(entries.some((entry) => entry.isDirectory && !entry.isSymlink)).toBe(true)
      expect(entries.some((entry) => entry.isSymlink)).toBe(true)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  it('rejects a report parent alias before reading borrowed report bytes and still cleans its snapshot', async () => {
    await fixture(async (value) => {
      const outside = join(value.root, '.tmp', 'outside-report-parent')
      await Deno.mkdir(join(outside, 'reports'), { recursive: true })
      await Deno.writeFile(
        join(outside, 'reports', 'sentinel.bin'),
        new Uint8Array([2, 255, 0, 128]),
      )
      await Deno.chmod(outside, 0o700)
      await Deno.chmod(join(outside, 'reports', 'sentinel.bin'), 0o640)
      const outsideMode = (await Deno.lstat(outside)).mode
      const sentinelMode = (await Deno.lstat(join(outside, 'reports', 'sentinel.bin'))).mode
      const config = await read<{ tasks: Record<string, string> }>(join(value.root, 'deno.json'))
      config.tasks['verify'] = 'deno run -A report-parent-alias.ts'
      await json(join(value.root, 'deno.json'), config)
      value.env.ORIGINAL_RELEASE_ROOT = value.root
      await Deno.writeTextFile(
        join(value.root, 'report-parent-alias.ts'),
        `
        import { relative, resolve, dirname } from 'node:path';
        const original=Deno.env.get('ORIGINAL_RELEASE_ROOT');
        await Deno.writeTextFile(original+'/.tmp/report-snapshot',Deno.cwd());
        // Mirror copied-input locations only as outside mode/byte sentinels. Their
        // observed names are never used to delete or chmod fixture resources.
        const sentinels=[];
        const archive=Deno.env.get('OPFS_TARBALL');
        const source=Deno.env.get('OPFS_SOURCE');
        for(const input of true && archive && source ? [archive,resolve(source,'mod.js')] : []) {
          const path=relative(resolve('.tmp'),input);
          if(!path || path==='..' || path.startsWith('../')) throw new Error('Input is not snapshot-owned');
          const target=resolve(original,'.tmp/outside-report-parent',path);
          await Deno.mkdir(dirname(target),{recursive:true});
          await Deno.writeFile(target,new Uint8Array([0,255,41,128]));
          await Deno.chmod(target,0o400);
          sentinels.push({path,mode:(await Deno.lstat(target)).mode});
        }
        await Deno.writeTextFile(original+'/.tmp/outside-input-sentinels.json',JSON.stringify(sentinels));
        // Deliberate namespace-corruption fault; source bytes remain unchanged.
        await Deno.chmod('.',0o755);
        await Deno.rename('.tmp','.tmp-displaced');
        await Deno.symlink(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/outside-report-parent','.tmp');
        Deno.exit(9);
      `,
      )
      await commitFixture(value)
      const result = await value.release('prepare')
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      expect(journal.passed).toBe(false)
      reportFaultExit(journal, 'verify', result)
      expect(journal.reports).toBeUndefined()
      expect(
        authorityFailures(journal.diagnostics ?? []).some((row) =>
          row.name === 'ReportError' && row.report?.stage === 'admission'
        ),
      ).toBe(true)
      expect(await Deno.readFile(join(outside, 'reports', 'sentinel.bin'))).toEqual(
        new Uint8Array([2, 255, 0, 128]),
      )
      expect((await Deno.lstat(outside)).mode).toBe(outsideMode)
      expect((await Deno.lstat(join(outside, 'reports', 'sentinel.bin'))).mode).toBe(sentinelMode)
      const sentinels = await read<Array<{ path: string; mode: number }>>(
        join(value.root, '.tmp/outside-input-sentinels.json'),
      )
      for (const row of sentinels) {
        const target = resolve(outside, row.path)
        const local = relative(outside, target)
        expect(
          local !== '' && local !== '..' &&
            !local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
            !isAbsolute(local),
        ).toBe(true)
        expect((await Deno.lstat(target)).mode).toBe(row.mode)
        expect(await Deno.readFile(target)).toEqual(new Uint8Array([0, 255, 41, 128]))
      }
      const snapshot = await snapshotPath(
        value,
        await Deno.readTextFile(join(value.root, '.tmp/report-snapshot')),
        true,
      )
      await expect(Deno.lstat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
      await expect(Deno.lstat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
        Deno.errors.NotFound,
      )
      await noUploads(value)
    })
  })
  for (
    const name of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_COMMON_DIR',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_NAMESPACE',
    ]
  ) {
    it(`refuses ambient ${name} as checkout source authority`, async () => {
      await fixture(async (value) => {
        value.env[name] = value.root
        const result = await value.release('prepare')
        expect(result.success).toBe(false)
        const journal = await authorityJournal(value, 'authority-')
        expect(journal.passed).toBe(false)
        const observed = authorityFailures(journal.diagnostics ?? [])
        expect(
          observed.some((row) => row.selection?.variable === name),
        ).toBe(true)
        expect(observed.find((row) => row.git)?.git).toEqual({
          cwd: await Deno.realPath(value.root),
          args: ['-c', 'core.fsmonitor=false', 'status', '--porcelain'],
          state: 'unobserved',
          code: null,
          signal: null,
          stdout: null,
          stderr: null,
        })
        expect(Array.from(Deno.readDirSync(value.snapshots))).toHaveLength(0)
        await noUploads(value)
      })
    })
  }
  for (const task of ['verify']) {
    for (const code of [0, 9]) {
      it(`retains ${task} exit ${code} and both failed post-gate Git authorities`, async () => {
        await fixture(async (value) => {
          const config = await read<{ tasks: Record<string, string> }>(
            join(value.root, 'deno.json'),
          )
          config.tasks[task] = 'deno run -A authority-fault.ts'
          await json(join(value.root, 'deno.json'), config)
          value.env.ORIGINAL_RELEASE_ROOT = value.root
          await Deno.writeTextFile(
            join(value.root, 'authority-fault.ts'),
            `
          const root=Deno.env.get('ORIGINAL_RELEASE_ROOT');
          await Deno.writeTextFile(root+'/.tmp/authority-snapshot',Deno.cwd());
          await Deno.writeTextFile('.git/HEAD',${JSON.stringify('invalid-ref\n')});
          const ancestor=await new Deno.Command('git',{args:['rev-parse','HEAD'],stdout:'piped',stderr:'piped',env:{GIT_CEILING_DIRECTORIES:''}}).output();
          await Deno.writeTextFile(root+'/.tmp/authority-ancestor.json',JSON.stringify({success:ancestor.success,revision:new TextDecoder().decode(ancestor.stdout).trim()}));
          const outputs=[];
          for(const args of [['-c','core.fsmonitor=false','ls-files','-z','--cached','--others','--exclude-standard'],['rev-parse','HEAD']]) {
            const output=await new Deno.Command('git',{args,stdout:'piped',stderr:'piped',env:{GIT_CEILING_DIRECTORIES:(await import('node:path')).dirname(await Deno.realPath(Deno.cwd()))}}).output();
            outputs.push({cwd:Deno.cwd(),args,state:'exited',code:output.code,signal:output.signal,stdout:Array.from(output.stdout),stderr:Array.from(output.stderr)});
          }
          await Deno.writeTextFile(root+'/.tmp/authority-expected.json',JSON.stringify(outputs));
          Deno.exit(${code});
        `,
          )
          await commitFixture(value)
          const result = await value.release('prepare')
          expect(result.success).toBe(false)
          const journal = await authorityJournal(value, 'gates-')
          const ancestor = await read<{ success: boolean; revision: string }>(
            join(value.root, '.tmp/authority-ancestor.json'),
          )
          const parentRevision = await run(value.root, 'git', ['rev-parse', 'HEAD'])
          expect(ancestor).toEqual({
            success: true,
            revision: new TextDecoder().decode(parentRevision.stdout).trim(),
          })

          expect(journal.passed).toBe(false)
          const step = journal.steps!.find((row) => row.task === task)!
          expect(step.code).toBe(code)
          expect(step.execution).toEqual({ state: 'exited', success: code === 0, signal: null })
          expect(step.integrity?.source.state).toBe('failed')
          expect(step.integrity?.revision.state).toBe('failed')
          const observed = authorityFailures(journal.diagnostics ?? []).filter((row) => row.git)
            .map((row) => row.git)
          const expected = await read<readonly NonNullable<AuthorityFailureType['git']>[]>(
            join(value.root, '.tmp/authority-expected.json'),
          )
          expect(expected.every((row) => row.code !== 0 && row.stderr!.length > 0)).toBe(true)
          for (const output of expected) expect(observed).toContainEqual(output)
          const snapshot = await snapshotPath(
            value,
            await Deno.readTextFile(join(value.root, '.tmp/authority-snapshot')),
            true,
          )
          await expect(Deno.stat(snapshot)).rejects.toThrow(Deno.errors.NotFound)
          await expect(Deno.stat(join(value.root, '.tmp/releases/prepared.json'))).rejects.toThrow(
            Deno.errors.NotFound,
          )
          expect(await Deno.readTextFile(join(value.root, 'mod.js'))).toBe(
            'export const value = 7;\n',
          )
          await noUploads(value)
        })
      })
    }
  }
  it('records an unobserved spawn separately from successful integrity acquisition', async () => {
    await fixture(async (value) => {
      await Deno.writeTextFile(
        join(value.root, 'spawn-fault.ts'),
        `
        const Actual=Deno.Command;
        Deno.Command=class extends Actual {
          constructor(command,options){super(command,options);this.options=options;}
          spawn(){if(this.options?.args?.[0]==='task' && this.options.args[1]==="verify") throw new Error('controlled gate spawn fault'); return super.spawn();}
        };
        await import('./.mise/tasks/release.ts');
      `,
      )
      await commitFixture(value)
      const result = await run(value.root, Deno.execPath(), [
        'run',
        '--cached-only',
        '--no-lock',
        '-A',
        'spawn-fault.ts',
        'prepare',
      ], value.env)
      expect(result.success).toBe(false)
      const journal = await authorityJournal(value, 'gates-')
      const step = journal.steps!.find((row) => row.task === 'verify')!
      expect(step.code).toBeNull()
      expect(step.execution).toEqual({ state: 'unobserved' })
      expect(step.integrity).toEqual({
        source: { state: 'verified' },
        revision: { state: 'verified' },
      })
      expect(journal.passed).toBe(false)
      expect(
        authorityFailures(journal.diagnostics ?? []).some((row) =>
          row.message === 'controlled gate spawn fault'
        ),
      ).toBe(true)
      await noUploads(value)
    })
  })
  for (const task of ['verify']) {
    for (const code of [0, 9]) {
      it(`retains ${task} exit ${code}, post-gate Git rejection and independent native cleanup failure`, async () => {
        await fixture(async (value) => {
          const config = await read<{ tasks: Record<string, string> }>(
            join(value.root, 'deno.json'),
          )
          config.tasks[task] = 'deno run -A authority-cleanup-fault.ts'
          await json(join(value.root, 'deno.json'), config)
          value.env.ORIGINAL_RELEASE_ROOT = value.root
          await Deno.writeTextFile(
            join(value.root, 'authority-cleanup-fault.ts'),
            `
        await Deno.writeTextFile(Deno.env.get('ORIGINAL_RELEASE_ROOT')+'/.tmp/authority-snapshot',Deno.cwd());
        await Deno.writeTextFile('.git/HEAD',${JSON.stringify('invalid-ref\n')});
        await Deno.mkdir('.tmp/authority-blocked');
        await Deno.writeTextFile('.tmp/authority-blocked/owned.txt','owned');
        await Deno.chmod('.tmp/authority-blocked',0);
        Deno.exit(${code});
      `,
          )
          await commitFixture(value)
          const result = await value.release('prepare')
          await snapshotPath(
            value,
            await Deno.readTextFile(join(value.root, '.tmp/authority-snapshot')),
          )
          const failures: unknown[] = []
          try {
            expect(result.success).toBe(false)
            const journal = await authorityJournal(value, 'gates-')
            expect(journal.passed).toBe(false)
            expect(journal.steps!.find((row) => row.task === task)!.code).toBe(code)
            const observed = authorityFailures(journal.diagnostics ?? [])
            expect(observed.filter((row) => row.git).length).toBeGreaterThanOrEqual(2)
            expect(observed.some((row) => row.name === 'PermissionDenied')).toBe(true)
            await noUploads(value)
          } catch (reason) {
            failures.push(reason)
          } finally {
            // Preserve assertion failures while retiring only parent-owned snapshot storage.
            try {
              await retireSnapshots(value.root)
            } catch (reason) {
              failures.push(reason)
            }
          }
          if (failures.length) {
            throw new AggregateError(
              failures,
              'Authority oracle and owned fixture repair failed.',
              {
                cause: failures[0],
              },
            )
          }
        })
      })
    }
  }
})
