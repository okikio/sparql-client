import process from 'node:process'
import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** These subprocess fixtures use the real pinned Bumpy and owned Git repositories, never public registry uploads. */
interface FixtureType {
  root: string
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

/** Owns each temporary root immediately and retains independent fixture/cleanup failures. */
async function fixture(
  body: (value: FixtureType) => Promise<void>,
  workspace = false,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'opfs-release-test-' })
  const errors: unknown[] = []
  try {
    const source = new URL('../../', import.meta.url)
    await Deno.mkdir(join(root, '.mise/tasks'), { recursive: true })
    await Deno.mkdir(join(root, '.bumpy'))
    await Deno.mkdir(join(root, '.tmp'))
    await Deno.mkdir(join(root, 'bin'))
    await Deno.copyFile(
      new URL('.mise/tasks/release.ts', source),
      join(root, '.mise/tasks/release.ts'),
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
      const snapshot = await Deno.readTextFile(join(value.root, '.tmp/failed-snapshot.txt'))
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
        // The fixture deliberately removed directory access. Restore only its
        // owned path so the test itself leaves no failed-cleanup snapshot behind.
        try {
          await Deno.chmod(join(snapshot, '.tmp/blocked'), 0o755)
        } catch (reason) {
          if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
        }
        try {
          await Deno.remove(join(snapshot, '..'), { recursive: true })
        } catch (reason) {
          if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
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
      const snapshot = await Deno.readTextFile(join(value.root, '.tmp/snapshot-root.txt'))
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
      const snapshot = await Deno.readTextFile(join(value.root, '.tmp/failed-snapshot.txt'))
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
