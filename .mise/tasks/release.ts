/** Uses Bumpy's release model with Deno manifests and independently resumable registry uploads. @module */
import { resolve } from 'node:path'
import {
  applyReleasePlan,
  assembleReleasePlan,
  defaultFormatter,
  DependencyGraph,
  discoverPackages,
  loadConfig,
  loadFormatter,
  publishPackages,
  readBumpFiles,
} from 'npm:@varlock/bumpy@1.18.1'
import type { PlannedRelease, ReleasePlan, WorkspacePackage } from 'npm:@varlock/bumpy@1.18.1'

/** A prepared upload records exactly which source tree and archive passed the release gates. */
interface CandidateType {
  source: string
  revision: string
  created: string
  packages: Array<{ name: string; version: string; archive: string; sha256: string }>
}
const ROOT = Deno.cwd()
const STORE = '.tmp/releases'
const config = await loadConfig(ROOT)
const packages = await discoverPackages(ROOT, config)
const graph = new DependencyGraph(packages)
const command = Deno.args[0] ?? 'plan'
const target = Deno.args[1] ?? 'both'
await metadata()
if (command === 'plan' || command === 'version') {
  const { bumpFiles, errors } = await readBumpFiles(ROOT)
  if (errors.length) throw new Error(errors.join('\n'))
  const plan = assembleReleasePlan(bumpFiles, packages, graph, config)
  if (plan.warnings.length) throw new Error(plan.warnings.join('\n'))
  if (command === 'plan') console.log(JSON.stringify(plan, null, 2))
  else {
    if (
      config.changelog && config.changelog !== 'default' &&
      await loadFormatter(config.changelog, ROOT) === defaultFormatter
    ) {
      throw new Error(
        'The configured changelog formatter failed; refusing to silently replace authored stories.',
      )
    }
    await Deno.mkdir(STORE, { recursive: true })
    // Retain the authored notes and their exact propagation plan before Bumpy consumes them.
    await save(`${STORE}/version-plan.json`, plan)
    await applyReleasePlan(plan, packages, ROOT, config)
    const changelogs: string[] = []
    for (const release of plan.releases) {
      const member = packages.get(release.name)!
      const path = `${member.dir}/deno.json`
      const source = await Deno.readTextFile(path)
      await Deno.writeTextFile(
        path,
        source.replace(/("version"\s*:\s*")[^"]+(")/u, `$1${release.newVersion}$2`),
      )
      const changelog = `${member.dir}/CHANGELOG.md`
      try {
        if ((await Deno.stat(changelog)).isFile) changelogs.push(changelog)
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      }
    }
    // Authored Markdown keeps its examples while adopting the repository's formatter.
    if (changelogs.length) await run(Deno.execPath(), ['fmt', ...changelogs])
    console.log(
      'Bumpy versions, dependency ranges, release notes, and Deno versions written. Run release:prepare next.',
    )
  }
} else if (command === 'prepare') {
  const gates = packages.has('@okikio/opfs')
    ? [
      'quality',
      'test',
      'test:node',
      'test:bun',
      'test:browser',
      'test:ecosystems',
      'test:providers',
      'test:linux',
      'bench:report',
      'bench:browser',
    ]
    : ['release-check']
  for (const gate of gates) await run(Deno.execPath(), ['task', gate])
  if (packages.has('@okikio/opfs')) {
    await run(Deno.execPath(), ['task', 'pack:npm'])
    await run(Deno.execPath(), [
      'task',
      'verify:npm:artifact',
      archivePath(packages.get('@okikio/opfs')!),
    ])
  }
  const rows: CandidateType['packages'] = []
  for (const name of graph.topologicalSort(packages)) {
    const member = packages.get(name)!
    const archive = archivePath(member)
    rows.push({
      name,
      version: member.version,
      archive,
      sha256: await hash(await Deno.readFile(archive)),
    })
  }
  await Deno.mkdir(STORE, { recursive: true })
  await save(
    `${STORE}/manifests.json`,
    Object.fromEntries(
      await Promise.all(
        Array.from(
          packages.values(),
          async (member) => [member.name, await Deno.readTextFile(`${member.dir}/package.json`)],
        ),
      ),
    ),
  )
  await save(`${STORE}/prepared.json`, {
    source: await sourceHash(),
    revision: await revision(),
    created: new Date().toISOString(),
    packages: rows,
  })
  console.log('Exact release archives and source identity recorded in .tmp/releases/prepared.json.')
} else if (command === 'publish') {
  await cleanRevision()
  registries(target)
  const candidate = await prepared()
  // Preflight every registry/package before any irreversible upload. A 401, 403, timeout,
  // or malformed response is an error, never evidence that a version is available.
  for (const row of candidate.packages) {
    for (const registry of registries(target)) {
      if (await published(registry, row.name, row.version)) {
        await samePublication(registry, row, candidate)
      }
    }
  }
  for (const row of candidate.packages) {
    const member = packages.get(row.name)!
    const release: PlannedRelease = {
      name: row.name,
      type: 'patch',
      oldVersion: row.version,
      newVersion: row.version,
      bumpFiles: [],
      isDependencyBump: false,
      isCascadeBump: false,
      isGroupBump: false,
      bumpSources: [],
    }
    const plan: ReleasePlan = { bumpFiles: [], releases: [release], warnings: [] }
    const bytes = await Deno.readTextFile(`${member.dir}/package.json`)
    const previous = member.bumpy
    member.bumpy = {
      ...previous,
      publishCommand: `${quote(Deno.execPath())} task --cwd ${quote(ROOT)} release:upload ${
        quote(row.name)
      } ${quote(row.version)} ${quote(target)}`,
    }
    const failures: unknown[] = []
    try {
      // The custom Deno command owns dual-registry credentials and provenance. Bumpy's
      // default npm auth setup writes .npmrc; selecting the unused Bun manager bypasses
      // that setup. Its public pipeline still owns ordering and command failure results.
      const result = await publishPackages(
        plan,
        packages,
        graph,
        { ...config, publish: { ...config.publish, publishManager: 'bun', provenance: false } },
        ROOT,
        { noTag: true },
      )
      if (result.failed.length || result.published.length !== 1) {
        throw new Error(JSON.stringify(result))
      }
    } catch (reason) {
      failures.push(reason)
    } finally {
      // Bumpy resolves workspace protocols in place for custom commands. Restore the
      // development manifest, even when a registry rejects an upload.
      try {
        await Deno.writeTextFile(`${member.dir}/package.json`, bytes)
      } catch (reason) {
        failures.push(reason)
      }
      if (previous === undefined) delete member.bumpy
      else member.bumpy = previous
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Publication and manifest restoration failed.', {
        cause: failures[0],
      })
    }
  }
  console.log(
    'Requested registry uploads completed. Verify fresh public installs before declaring this release complete.',
  )
} else if (command === 'upload') {
  const name = Deno.args[1]!
  const version = Deno.args[2]!
  const selected = Deno.args[3] ?? 'both'
  await restoreProtocols()
  await cleanRevision()
  const candidate = await prepared()
  const row = candidate.packages.find((row) => row.name === name && row.version === version)
  if (!row) throw new Error('Package/version is absent from the prepared release set.')
  for (const registry of registries(selected)) {
    const member = packages.get(name)!
    for (const dependency of Object.keys(member.dependencies)) {
      const internal = packages.get(dependency)
      if (internal && !(await published(registry, internal.name, internal.version))) {
        throw new Error(
          `${registry} dependency is unavailable: ${internal.name}@${internal.version}`,
        )
      }
    }
    const exists = await published(registry, name, version)
    if (exists) await samePublication(registry, row, candidate)
    else {
      if (registry === 'jsr') {
        const member = packages.get(name)!
        await run(Deno.execPath(), ['publish'], member.dir)
      } else {
        const args = [
          'publish',
          resolve(ROOT, row.archive),
          '--registry=https://registry.npmjs.org',
          '--access=public',
        ]
        if (Deno.env.get('GITHUB_ACTIONS') === 'true') args.push('--provenance')
        await run(Deno.execPath(), ['task', 'release:npm', ...args.slice(1)])
      }
    }
    if (!(await visible(registry, name, version))) {
      throw new Error(`${registry} did not expose ${name}@${version} after upload.`)
    }
    if (registry === 'npm') await sameNpmArchive(row)
    await save(`${STORE}/${name.replace(/[@/]/gu, '-')}-${version}-${registry}.json`, {
      name,
      version,
      registry,
      archiveSha256: row.sha256,
      source: candidate.source,
      revision: candidate.revision,
      confirmed: new Date().toISOString(),
    })
  }
} else if (command === 'registry') {
  for (const member of packages.values()) {
    for (const registry of registries(target)) {
      console.log(
        JSON.stringify({
          registry,
          name: member.name,
          version: member.version,
          published: await published(registry, member.name, member.version),
        }),
      )
    }
  }
} else throw new Error(`Unknown release operation: ${command}`)

/** Checks the two manifest authorities before Bumpy sees or writes a release. */
async function metadata(): Promise<void> {
  if (!packages.size) throw new Error('Bumpy discovered no packages.')
  for (const member of packages.values()) {
    const deno = JSON.parse(await Deno.readTextFile(`${member.dir}/deno.json`)) as {
      name: string
      version: string
    }
    if (member.name !== deno.name || member.version !== deno.version) {
      throw new Error(`${member.name}: npm and Deno metadata disagree.`)
    }
    if (!/^\d+\.\d+\.\d+$/u.test(member.version)) {
      throw new Error('Stable releases require an explicit stable SemVer version.')
    }
  }
}
/** Maps a release member to the archive produced by its existing package compiler. */
function archivePath(member: WorkspacePackage): string {
  const filename = `${member.name.replace(/^@/u, '').replace('/', '-')}-${member.version}.tgz`
  return `${packages.has('@okikio/opfs') ? '.release/npm' : '.tmp/packages'}/${filename}`
}
/** Validates registry selection before any publication. */
function registries(value: string): Array<'jsr' | 'npm'> {
  if (value === 'both') return ['jsr', 'npm']
  if (value === 'jsr' || value === 'npm') return [value]
  throw new Error(`Unknown registry selection: ${value}`)
}
/** Queries exact versions, including older published versions, without hiding transport errors. */
async function published(registry: 'jsr' | 'npm', name: string, version: string): Promise<boolean> {
  const url = registry === 'jsr'
    ? `https://jsr.io/api/scopes/${name.slice(1).replace('/', '/packages/')}/versions/${version}`
    : `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`
  const request = new URL(url)
  // A cached preflight 404 can outlive a successful JSR upload. Each management
  // observation needs a fresh URL; Cache-Control: no-cache does not bypass its CDN.
  if (registry === 'jsr') request.searchParams.set('release_check', crypto.randomUUID())
  const result = await new Deno.Command('curl', {
    args: [
      '--silent',
      '--show-error',
      '--max-time',
      '30',
      '--write-out',
      '\n%{http_code}',
      request.href,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(`Registry request failed: ${new TextDecoder().decode(result.stderr)}`)
  }
  const output = new TextDecoder().decode(result.stdout)
  const split = output.lastIndexOf('\n')
  const status = Number(output.slice(split + 1))
  if (status === 404) return false
  if (status !== 200) {
    throw new Error(`${registry} metadata returned HTTP ${status} for ${name}@${version}.`)
  }
  const value = JSON.parse(output.slice(0, split)) as { version?: string }
  if (value.version !== version) throw new Error(`${registry} metadata has a different version.`)
  return true
}
/** Rejects changed archives/source after the release gates. Bumpy may only rewrite
 * workspace ranges transiently; upload subprocesses normalize those to their saved values. */
async function prepared(): Promise<CandidateType> {
  const candidate = JSON.parse(await Deno.readTextFile(`${STORE}/prepared.json`)) as CandidateType
  if (candidate.revision !== await revision()) {
    throw new Error('Prepared revision differs from the publishing checkout.')
  }
  if (candidate.source !== await sourceHash()) {
    throw new Error('Source changed after release preparation. Run release:prepare again.')
  }
  if (
    candidate.packages.length !== packages.size ||
    new Set(candidate.packages.map((row) => row.name)).size !== packages.size
  ) throw new Error('Prepared release set differs from the workspace.')
  for (const row of candidate.packages) {
    const member = packages.get(row.name)
    if (!member || member.version !== row.version || row.archive !== archivePath(member)) {
      throw new Error('Prepared package metadata differs from the workspace.')
    }
    if (row.sha256 !== await hash(await Deno.readFile(row.archive))) {
      throw new Error(`Release archive changed: ${row.archive}`)
    }
  }
  return candidate
}
/** Hashes publishable and maintained source inputs, including untracked release files.
 * Local outputs and caches remain excluded by the repository's Git ignore rules. */
async function sourceHash(): Promise<string> {
  const output = await new Deno.Command('git', {
    args: [
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!output.success) throw new Error('Cannot enumerate release source inputs.')
  const paths = [...new Set(new TextDecoder().decode(output.stdout).split('\0').filter(Boolean))]
    .sort()
  const values: Array<[string, string]> = []
  for (const path of paths) {
    try {
      values.push([path, await hash(await Deno.readFile(path))])
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) values.push([path, 'deleted'])
      else throw error
    }
  }
  return await hash(new TextEncoder().encode(JSON.stringify(values)))
}
/** Uses SHA-256 for source and archive identities; this is provenance, not a signature. */
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
/** Writes local receipts only after an independently observed registry success. */
async function save(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
/** Quotes one controlled executable/path for Bumpy's shell command seam. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
/** Runs actual Deno/npm commands without suppressing their exit status or diagnostics. */
async function run(file: string, args: string[], cwd = ROOT): Promise<void> {
  const status = await new Deno.Command(file, {
    args,
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn().status
  if (!status.success) throw new Error(`${file} failed with exit code ${status.code}.`)
}

/** Accepts only Bumpy's documented workspace-protocol resolution, then restores
 * the exact saved development manifest before verifying the full source identity. */
async function restoreProtocols(): Promise<void> {
  const originals = JSON.parse(await Deno.readTextFile(`${STORE}/manifests.json`)) as Record<
    string,
    string
  >
  for (const member of packages.values()) {
    const original = originals[member.name]
    if (original === undefined) throw new Error('Prepared manifest is missing.')
    const path = `${member.dir}/package.json`
    const current = await Deno.readTextFile(path)
    if (current === original) continue
    const expected = JSON.parse(original) as Record<string, unknown>
    for (
      const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    ) {
      const deps = expected[field] as Record<string, string> | undefined
      for (const [name, range] of Object.entries(deps ?? {})) {
        if (!range.startsWith('workspace:')) continue
        const version = packages.get(name)?.version
        if (!version) throw new Error(`Unknown workspace dependency: ${name}`)
        const suffix = range.slice(10)
        deps![name] = suffix === '*'
          ? `^${version}`
          : suffix === '^' || suffix === '~'
          ? `${suffix}${version}`
          : suffix
      }
    }
    if (JSON.stringify(JSON.parse(current)) !== JSON.stringify(expected)) {
      throw new Error('Unexpected source manifest edit during publication.')
    }
    await Deno.writeTextFile(path, original)
  }
}

/** Returns the immutable Git revision represented by a clean publishing checkout. */
async function revision(): Promise<string> {
  const result = await new Deno.Command('git', {
    args: ['rev-parse', 'HEAD'],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  const sha = new TextDecoder().decode(result.stdout).trim()
  if (!result.success || !/^[a-f0-9]{40}$/u.test(sha)) {
    throw new Error('Cannot identify the source revision.')
  }
  return sha
}
/** Preparation can inspect local changes; uploading requires their committed revision. */
async function cleanRevision(): Promise<void> {
  const result = await new Deno.Command('git', {
    args: ['-c', 'core.fsmonitor=false', 'status', '--porcelain'],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!result.success || result.stdout.length) {
    throw new Error(
      'Publication requires a clean immutable checkout. Preserve local work and publish its prepared release snapshot.',
    )
  }
}

/** Accepts an existing JSR version only with the retained source/revision receipt.
 * npm can recover a lost receipt by independently downloading the immutable archive. */
async function samePublication(
  registry: 'jsr' | 'npm',
  row: CandidateType['packages'][number],
  candidate: CandidateType,
): Promise<void> {
  if (registry === 'npm') {
    await sameNpmArchive(row)
    return
  }
  const path = `${STORE}/${row.name.replace(/[@/]/gu, '-')}-${row.version}-${registry}.json`
  let receipt: { source: string; archiveSha256: string; revision: string }
  try {
    receipt = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `JSR already contains ${row.name}@${row.version} without a retained source receipt. Independently verify its published source; do not guess that the bytes match.`,
      )
    }
    throw error
  }
  if (
    receipt.source !== candidate.source || receipt.archiveSha256 !== row.sha256 ||
    receipt.revision !== candidate.revision
  ) throw new Error('Existing JSR receipt belongs to a different candidate.')
}
/** Fetches the exact direct npm archive and checks SHA-256 against the prepared upload. */
async function sameNpmArchive(row: CandidateType['packages'][number]): Promise<void> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(row.name)}/${row.version}`
  const metadata = await new Deno.Command('curl', {
    args: ['--fail', '--silent', '--show-error', '--max-time', '30', url],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!metadata.success) throw new Error('Cannot inspect the published npm archive.')
  const value = JSON.parse(new TextDecoder().decode(metadata.stdout)) as {
    name: string
    version: string
    dist: { tarball: string }
  }
  if (
    value.name !== row.name || value.version !== row.version ||
    !value.dist.tarball.startsWith('https://registry.npmjs.org/')
  ) throw new Error('Unexpected npm archive identity.')
  const archive = await new Deno.Command('curl', {
    args: ['--fail', '--silent', '--show-error', '--max-time', '60', value.dist.tarball],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!archive.success || await hash(archive.stdout) !== row.sha256) {
    throw new Error('Published npm bytes differ from the prepared archive.')
  }
}
/** Allows bounded registry propagation delay while treating transport/auth failures as errors. */
async function visible(registry: 'jsr' | 'npm', name: string, version: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await published(registry, name, version)) return true
    if (attempt !== 5) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
  return false
}
