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
  uploads: string[][]
  archive: string
}

/** Bounds a real subprocess and always releases its deadline timer. */
async function run(root: string, file: string, args: string[], env: Record<string, string> = {}) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Release fixture command exceeded 30 seconds.')),
    30_000,
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
    await Deno.symlink(fileURLToPath(new URL('node_modules', source)), join(root, 'node_modules'), {
      type: 'dir',
    })
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
    const env = {
      PATH: `${join(root, 'bin')}:${Deno.env.get('PATH')}`,
      REGISTRY_STATE: join(root, '.tmp/registry.json'),
      GITHUB_ACTIONS: 'false',
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
        story,
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
      await Deno.writeTextFile(join(value.root, 'extra.txt'), 'uncommitted candidate\n')
      success(await value.release('prepare'))
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
const status=state.status??((npm?state.npm:state.jsr)?200:404);
const body=JSON.stringify({name:'@okikio/rdf',version:'0.1.0',dist:{tarball:'https://registry.npmjs.org/@okikio/rdf/-/opfs-0.1.0.tgz'}});
process.stdout.write(body+(args.includes('--write-out')?'\\n'+status:''));
if(args.includes('--fail')&&status>=400)process.exit(22);
`
