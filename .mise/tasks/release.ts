/** Uses Bumpy's release model with Deno manifests and independently resumable registry uploads. @module */
import process from 'node:process'
import { ceiling } from './ceiling.ts'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
  gates: { file: string; sha256: string }
  inputs?: OpfsInputsType
  packages: Array<{ name: string; version: string; archive: string; sha256: string }>
}
/** Raw bytes and actual process observation for one Git authority request. */
interface GitObservationType {
  /** The exact argument vector; no shell expands these values. */
  readonly args: readonly string[]
  /** The checkout whose identity was requested. */
  readonly cwd: string
  /** Unobserved means output acquisition failed, not that Git reported an exit. */
  readonly state: 'exited' | 'unobserved'
  /** Null does not stand for a successful exit. */
  readonly code: number | null
  /** A reported termination signal, if one exists. */
  readonly signal: string | null
  /** Exact bytes, or null when output acquisition did not report them. */
  readonly stdout: readonly number[] | null
  /** Exact bytes, or null when output acquisition did not report them. */
  readonly stderr: readonly number[] | null
}
/** Diagnostic metadata never substitutes for successful Git admission. */
class GitError extends Error {
  /** Detached actual request/status/raw-output evidence. */
  readonly git: GitObservationType
  constructor(
    message: string,
    args: readonly string[],
    cwd: string,
    output?: Deno.CommandOutput,
    cause?: unknown,
  ) {
    const details = output
      ? `exit ${output.code}, signal ${output.signal ?? 'none'}`
      : 'status unobserved'
    const stderr = output ? new TextDecoder().decode(output.stderr) : ''
    super(`${message} Git (${details}) in ${cwd}.${stderr ? `\n${stderr}` : ''}`, { cause })
    this.name = 'GitError'
    this.git = {
      args: [...args],
      cwd,
      state: output ? 'exited' : 'unobserved',
      code: output?.code ?? null,
      signal: output?.signal ?? null,
      stdout: output ? Array.from(output.stdout) : null,
      stderr: output ? Array.from(output.stderr) : null,
    }
  }
}
/** Snapshot ownership admission is not a Git child-process observation. */
class SnapshotError extends Error {
  readonly snapshot = { stage: 'admission' } as const
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}
/** Report diagnostics distinguish root admission from confined tree capture without relying on wording. */
class ReportError extends Error {
  readonly report: { readonly stage: 'admission' | 'copy' }
  constructor(stage: 'admission' | 'copy', cause: unknown) {
    super(`Release report retention failed during ${stage}.`, { cause })
    this.name = 'ReportError'
    this.report = { stage }
  }
}
/** Repository-selection preflight records the rejected variable name, never its potentially sensitive value. */
class SourceSelectionError extends Error {
  readonly selection: { readonly variable: string }
  constructor(variable: string) {
    super(`Release source selection does not support ${variable}.`)
    this.name = 'SourceSelectionError'
    this.selection = { variable }
  }
}
/** Machine-readable failure trees preserve independent causes and non-Error throws. */
interface FailureType {
  readonly name: string
  readonly message: string
  readonly git?: GitObservationType
  readonly report?: { readonly stage: 'admission' | 'copy' }
  readonly snapshot?: { readonly stage: 'admission' }
  readonly selection?: { readonly variable: string }
  readonly cause?: FailureType
  readonly errors?: readonly FailureType[]
}
/** Cyclic cause links are observations, not permission to discard the other failures. */
function failure(reason: unknown, seen = new Set<unknown>()): FailureType {
  if (!(reason instanceof Error)) return { name: 'ThrownValue', message: String(reason) }
  if (seen.has(reason)) return { name: reason.name, message: 'Repeated error reference' }
  seen.add(reason)
  return {
    name: reason.name,
    message: reason.message,
    ...(reason instanceof GitError ? { git: reason.git } : {}),
    ...(reason instanceof SnapshotError ? { snapshot: reason.snapshot } : {}),
    ...(reason instanceof ReportError ? { report: reason.report } : {}),
    ...(reason instanceof SourceSelectionError ? { selection: reason.selection } : {}),
    ...(Object.hasOwn(reason, 'cause') ? { cause: failure(reason.cause, seen) } : {}),
    ...(reason instanceof AggregateError
      ? { errors: Array.from(reason.errors as Iterable<unknown>, (value) => failure(value, seen)) }
      : {}),
  }
}
/** Captures Git's actual status and both raw outputs, without ownership exceptions or retry. */
async function git(args: string[], cwd = ROOT): Promise<Deno.CommandOutput> {
  let output: Deno.CommandOutput
  try {
    // Preserve ordinary Git ownership admission while refusing ancestor repository discovery.
    // Explicit --git-dir selection disables discovery and is not a substitute for that trust check.
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
      if (Deno.env.get(name) !== undefined) {
        throw new SourceSelectionError(name)
      }
    }
    cwd = await Deno.realPath(cwd)
    const parent = ceiling(dirname(cwd), Deno.build.os === 'windows')
    output = await new Deno.Command('git', {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
      env: { GIT_CEILING_DIRECTORIES: parent },
    }).output()
  } catch (cause) {
    throw new GitError('Cannot acquire Git authority.', args, cwd, undefined, cause)
  }
  if (!output.success) throw new GitError('Git authority request failed.', args, cwd, output)
  return output
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
  const result = await prepareSnapshot()
  await save(`${STORE}/manifests.json`, result.manifests)
  await save(`${STORE}/prepared.json`, result.candidate)
  console.log(
    'Snapshot gates, exact release archives and source identity recorded in .tmp/releases/.',
  )
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
function archivePath(member: WorkspacePackage, opfs = packages.has('@okikio/opfs')): string {
  const filename = `${member.name.replace(/^@/u, '').replace('/', '-')}-${member.version}.tgz`
  return `${opfs ? '.release/npm' : '.tmp/packages'}/${filename}`
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
  if (
    !candidate.gates ||
    !new RegExp(
      `^${STORE.replaceAll('.', '\\.')}\/gates-${candidate.revision}-[a-f0-9-]{36}\\.json$`,
      'u',
    ).test(candidate.gates.file) ||
    candidate.gates.sha256 !== await hash(await Deno.readFile(candidate.gates.file))
  ) {
    throw new Error('Prepared gate evidence changed or is missing.')
  }
  const evidence = JSON.parse(await Deno.readTextFile(candidate.gates.file)) as {
    passed?: boolean
    revision?: string
    source?: string
    inputs?: OpfsInputsType
  }
  if (
    evidence.passed !== true || evidence.revision !== candidate.revision ||
    evidence.source !== candidate.source ||
    JSON.stringify(evidence.inputs) !== JSON.stringify(candidate.inputs)
  ) throw new Error('Prepared candidate differs from its successful gate evidence.')
  const journal = JSON.parse(await Deno.readTextFile(candidate.gates.file)) as {
    passed?: boolean
    source?: string
    revision?: string
    version?: number
    steps?: GateType[]
  }
  if (
    journal.passed !== true || journal.source !== candidate.source ||
    journal.revision !== candidate.revision || !Array.isArray(journal.steps) ||
    (journal.version !== undefined && journal.version !== 2) ||
    journal.steps.some((step) =>
      (journal.version === 2 &&
        (!step.execution || !step.integrity || typeof step.finished !== 'string')) ||
      step.code !== 0 || step.source !== candidate.source || step.revision !== candidate.revision ||
      (step.execution !== undefined &&
        (step.execution.state !== 'exited' || step.execution.success !== true)) ||
      (step.integrity !== undefined &&
        (step.integrity.source.state !== 'verified' ||
          step.integrity.revision.state !== 'verified')) ||
      step.before.source !== candidate.source || step.before.revision !== candidate.revision
    )
  ) throw new Error('Prepared gate journal differs from the successful source snapshot.')
  for (const step of journal.steps) {
    if (step.phase !== 'dependencies') continue
    if (!step.logs) throw new Error('Prepared dependency phase lacks raw evidence.')
    for (const stream of [step.logs.stdout, step.logs.stderr]) {
      const prefix = `${STORE}/snapshot-${candidate.revision}-`
      if (
        !stream.file.startsWith(prefix) ||
        !/^snapshot-[a-f0-9]{40}-[a-f0-9-]{36}\/dependencies\/(?:stdout|stderr)\.log$/u.test(
          stream.file.slice(STORE.length + 1),
        ) || stream.sha256 !== await fileHash(stream.file)
      ) throw new Error('Prepared dependency raw evidence changed or is missing.')
    }
  }
  return candidate
}
/** Hashes publishable and maintained source inputs, including untracked release files.
 * Local outputs and caches remain excluded by the repository's Git ignore rules. */
async function sourceHash(cwd = ROOT, admit?: (path: string) => Promise<void>): Promise<string> {
  const values: Array<[string, string]> = []
  for (const path of await sourcePaths(cwd)) {
    // Admission errors are authority failures, not an absent file hash.
    await admit?.(resolve(cwd, path))
    try {
      values.push([path, await hash(await Deno.readFile(resolve(cwd, path)))])
    } catch (reason) {
      if (reason instanceof Deno.errors.NotFound) values.push([path, 'deleted'])
      else throw reason
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
/** Hashes retained raw logs with a fixed buffer and explicit file ownership. */
async function fileHash(path: string): Promise<string> {
  const file = await Deno.open(path)
  const digest = createHash('sha256'), buffer = new Uint8Array(65536)
  const errors: unknown[] = []
  let value: string | undefined
  try {
    while (true) {
      const size = await file.read(buffer)
      if (size === null) break
      digest.update(buffer.subarray(0, size))
    }
    value = digest.digest('hex')
  } catch (reason) {
    errors.push(reason)
  } finally {
    try {
      file.close()
    } catch (reason) {
      errors.push(reason)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Raw evidence hashing and file cleanup failed.', {
      cause: errors[0],
    })
  }
  if (value === undefined) throw new Error('Raw evidence hash is absent.')
  return value
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
  // Clone and checkout acquire the same source authority as status/revision/listing.
  // Keep their successful progress visible, and retain exact failure bytes in the journal.
  if (file === 'git') {
    const output = await git(args, cwd)
    if (output.stdout.length) console.log(new TextDecoder().decode(output.stdout).trimEnd())
    if (output.stderr.length) console.error(new TextDecoder().decode(output.stderr).trimEnd())
    return
  }

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
async function revision(cwd = ROOT): Promise<string> {
  const args = ['rev-parse', 'HEAD']
  const result = await git(args, cwd)
  const sha = new TextDecoder().decode(result.stdout).trim()
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    throw new GitError('Cannot identify the source revision.', args, cwd, result)
  }
  return sha
}
/** Distinguishes a dirty checkout from failed Git acquisition; neither permits publication. */
async function cleanRevision(cwd = ROOT): Promise<void> {
  const args = ['-c', 'core.fsmonitor=false', 'status', '--porcelain']
  const result = await git(args, cwd)
  if (result.stdout.length) {
    throw new GitError(
      'Publication requires a clean immutable checkout. Preserve local work and publish its prepared release snapshot.',
      args,
      cwd,
      result,
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

/** Source and archive are independent reviewed inputs, not evidence of one build. */
interface OpfsInputsType {
  source: { path: string; revision: string; sha256: string; version: string }
  archive: { path: string; sha256: string; version: string; exports: string[] }
}
/** Owns the captured inputs while retaining checks against their original identities. */
interface InputsType {
  receipt: OpfsInputsType
  env: Record<string, string>
  mappings: readonly (readonly [string, string, boolean?])[]
  verify(): Promise<void>
  original(): Promise<void>
}

/** Protects maintained bytes and all replacement ancestors, leaving owned outputs writable. */
async function protectSource(root: string, frozen: Map<string, number>): Promise<void> {
  for (const name of ['.tmp', '.release', 'node_modules']) {
    await Deno.mkdir(resolve(root, name), { recursive: true })
  }
  const parents = new Set<string>([root])
  for (const path of await sourcePaths(root)) {
    const file = resolve(root, path)
    const info = await Deno.lstat(file)
    if (info.isSymlink) throw new Error(`Maintained source aliases are unsupported: ${path}`)
    if (!info.isFile) throw new Error(`Maintained source is not a file: ${path}`)
    await freeze(file, frozen)
    let parent = dirname(file)
    while (parent !== root) {
      parents.add(parent)
      parent = dirname(parent)
    }
  }
  for (const path of [...parents].sort((left, right) => right.length - left.length)) {
    await freeze(path, frozen)
  }
}

/** Reads bounded tar metadata without extracting paths into the filesystem. */
async function tarBytes(
  archive: string,
  args: string[],
  limit: number,
  member?: string,
): Promise<Uint8Array> {
  const child = new Deno.Command('tar', {
    args: [...args, archive, ...(member === undefined ? [] : [member])],
    stdout: 'piped',
    stderr: 'inherit',
    stdin: 'null',
  }).spawn()
  const reader = child.stdout.getReader()
  const chunks: Uint8Array[] = []
  const failures: unknown[] = []
  let size = 0
  let completed = false
  let bytes: Uint8Array | undefined
  let deadline: Error | undefined
  // This is an operational admission bound, not a performance target. It owns
  // only this direct read-only tar child and does not claim descendant cleanup.
  const timer = setTimeout(() => {
    deadline = new Error('OPFS archive inspection exceeded its 30-second admission deadline.')
    try {
      child.kill('SIGKILL')
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
    }
  }, 30_000)
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > limit) throw new Error('OPFS archive metadata exceeds its admission limit.')
      chunks.push(item.value)
    }
    const status = await child.status
    completed = true
    if (deadline) throw deadline
    if (!status.success) throw new Error('Cannot inspect the OPFS archive.')
    bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
  } catch (reason) {
    failures.unshift(reason)
  } finally {
    clearTimeout(timer)
    if (!completed) {
      try {
        child.kill('SIGKILL')
      } catch (reason) {
        if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
      }
      try {
        await child.status
      } catch (reason) {
        failures.push(reason)
      }
    }
    try {
      await reader.cancel()
    } catch (reason) {
      failures.push(reason)
    }
    try {
      reader.releaseLock()
    } catch (reason) {
      failures.push(reason)
    }
  }
  if (deadline && !failures.includes(deadline)) failures.unshift(deadline)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Archive inspection and owned cleanup failed.', {
      cause: failures[0],
    })
  }
  if (!bytes) throw new Error('Archive inspection produced no metadata.')
  return bytes
}

/** Tar paths cannot use control bytes or platform-dependent separators. */
function unsafePath(value: string): boolean {
  return value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

/** Checks package identity and every public export against regular tar members. */
async function archiveIdentity(
  archive: string,
  manifest: { version: string; exports: unknown },
  quality: boolean,
): Promise<{ version: string; exports: string[] }> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const names = decoder.decode(await tarBytes(archive, ['-tzf'], 16 * 1024 * 1024)).replace(
    /\n$/u,
    '',
  ).split('\n')
  const kinds = decoder.decode(await tarBytes(archive, ['-tvzf'], 16 * 1024 * 1024)).replace(
    /\n$/u,
    '',
  ).split('\n')
  const entries = new Map<string, string>()
  if (names.length !== kinds.length) throw new Error('Ambiguous OPFS archive members.')
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!.replace(/^\.\//u, '')
    const kind = kinds[index]![0]!
    if (
      !name.startsWith('package/') || unsafePath(name) ||
      name.replace(/\/$/u, '').split('/').some((part) => !part || part === '..' || part === '.') ||
      entries.has(name) ||
      !['-', 'd'].includes(kind)
    ) {
      throw new Error('OPFS archive contains an unsafe or non-regular member.')
    }
    entries.set(name, kind)
  }
  if (entries.get('package/package.json') !== '-') {
    throw new Error('OPFS archive lacks a regular package manifest.')
  }
  // -O reads the named manifest to stdout without an extraction destination.
  const value = JSON.parse(
    decoder.decode(await tarBytes(archive, ['-xOzf'], 1024 * 1024, 'package/package.json')),
  ) as { name?: unknown; version?: unknown; exports?: unknown }
  if (
    value.name !== '@okikio/opfs' || typeof value.version !== 'string' ||
    value.version !== (quality ? '0.0.0-quality' : manifest.version)
  ) {
    throw new Error('OPFS archive package name/version differs from the selected input.')
  }
  const keys = (exports: unknown): string[] => {
    if (typeof exports === 'string') return ['.']
    if (!exports || typeof exports !== 'object' || Array.isArray(exports)) {
      throw new Error('OPFS public export map is absent.')
    }
    return Object.keys(exports).sort()
  }
  if (JSON.stringify(keys(value.exports)) !== JSON.stringify(keys(manifest.exports))) {
    throw new Error('OPFS archive public export keys differ from the selected source.')
  }
  const files = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (
        !value.startsWith('./') || (unsafePath(value) || value.includes('*')) ||
        value.slice(2).split('/').some((part) => !part || part === '.' || part === '..') ||
        entries.get(`package/${value.slice(2)}`) !== '-'
      ) throw new Error('OPFS export does not identify a regular archive file.')
      files.add(value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of Object.values(value)) visit(child)
    } else throw new Error('OPFS archive has an unsupported public export target.')
  }
  visit(value.exports)
  return { version: value.version, exports: [...files].sort() }
}

/** Captures the actual storage/browser source and npm consumer archive contracts. */
async function captureInputs(
  snapshot: string,
  frozen: Map<string, number>,
  admit: (path: string, missing?: boolean) => Promise<void>,
): Promise<InputsType> {
  const source = await Deno.realPath(resolve(ROOT, Deno.env.get('OPFS_SOURCE') ?? '../opfs'))
  const topArgs = ['rev-parse', '--show-toplevel']
  const top = await git(topArgs, source)
  if (await Deno.realPath(new TextDecoder().decode(top.stdout).trim()) !== source) {
    throw new GitError('OPFS_SOURCE must select a complete Git checkout.', topArgs, source, top)
  }
  await cleanRevision(source)
  const commit = await revision(source), identity = await sourceHash(source)
  const manifest = JSON.parse(await Deno.readTextFile(resolve(source, 'package.json'))) as {
    name: string
    version: string
    exports: unknown
  }
  const deno = JSON.parse(await Deno.readTextFile(resolve(source, 'deno.json'))) as {
    name: string
    version: string
  }
  if (
    manifest.name !== '@okikio/opfs' || deno.name !== manifest.name ||
    deno.version !== manifest.version
  ) throw new Error('Selected OPFS source manifests disagree.')
  const archive = resolve(
    ROOT,
    Deno.env.get('OPFS_TARBALL') ?? '../opfs/.release/npm/okikio-opfs-0.0.0-quality.tgz',
  )
  const stat = await Deno.lstat(archive)
  if (!stat.isFile || stat.isSymlink || stat.size > 128 * 1024 * 1024) {
    throw new Error('OPFS_TARBALL must select a regular archive no larger than 128 MiB.')
  }
  const sha = await hash(await Deno.readFile(archive)),
    expected = Deno.env.get('OPFS_ARCHIVE_SHA256')
  if (expected !== undefined && (!/^[a-f0-9]{64}$/u.test(expected) || expected !== sha)) {
    throw new Error('OPFS archive does not match OPFS_ARCHIVE_SHA256.')
  }
  const root = resolve(snapshot, '.tmp/release-inputs'),
    ownedSource = resolve(root, 'opfs-source'),
    ownedArchive = resolve(root, 'opfs.tgz')
  await admit(root, true)
  await Deno.mkdir(root, { recursive: true })
  await run('git', [
    'clone',
    '--no-hardlinks',
    '--no-checkout',
    '--dissociate',
    '--',
    source,
    ownedSource,
  ])
  await run('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commit], ownedSource)
  if (await revision(ownedSource) !== commit || await sourceHash(ownedSource, admit) !== identity) {
    throw new Error('Captured OPFS source differs from the selected revision.')
  }
  const mappings: Array<readonly [string, string, boolean?]> = [[source, ownedSource, true]]
  let dependencies: string | undefined
  try {
    dependencies = await Deno.realPath(resolve(source, 'node_modules'))
  } catch (reason) {
    if (!(reason instanceof Deno.errors.NotFound)) throw reason
  }
  if (dependencies !== undefined) {
    await copyTree(dependencies, resolve(ownedSource, 'node_modules'), [[
      dependencies,
      resolve(ownedSource, 'node_modules'),
    ], ...mappings])
  }
  await Deno.copyFile(archive, ownedArchive)
  if (await hash(await Deno.readFile(ownedArchive)) !== sha) {
    throw new Error('Copied OPFS archive changed.')
  }
  const archiveInfo = await archiveIdentity(
    ownedArchive,
    manifest,
    Deno.env.get('OPFS_TARBALL') === undefined,
  )
  await protectSource(ownedSource, frozen)
  for (const path of [ownedArchive, root]) {
    await freeze(path, frozen)
  }
  const original = async (): Promise<void> => {
    await cleanRevision(source)
    if (await revision(source) !== commit || await sourceHash(source) !== identity) {
      throw new Error('Original OPFS source changed during release preparation.')
    }
    const info = await Deno.lstat(archive)
    if (
      !info.isFile || info.isSymlink || info.size > 128 * 1024 * 1024 ||
      await hash(await Deno.readFile(archive)) !== sha
    ) throw new Error('Original OPFS archive changed during release preparation.')
  }
  await original()
  return {
    receipt: {
      source: { path: source, revision: commit, sha256: identity, version: manifest.version },
      archive: { path: archive, sha256: sha, ...archiveInfo },
    },
    env: { OPFS_SOURCE: ownedSource, OPFS_TARBALL: ownedArchive, OPFS_ARCHIVE_SHA256: sha },
    mappings,
    original,
    verify: async () => {
      await admit(resolve(ownedSource, '.git'))
      await admit(ownedArchive)
      await original()
      if (
        await revision(ownedSource) !== commit ||
        await sourceHash(ownedSource, admit) !== identity ||
        await hash(await Deno.readFile(ownedArchive)) !== sha
      ) throw new Error('Captured OPFS input changed during release preparation.')
    },
  }
}

/** Gate evidence names the immutable input and each actually completed command. */
interface GateType {
  readonly task: string
  readonly started: string
  readonly finished?: string
  readonly code: number | null
  readonly source?: string
  readonly revision?: string
  readonly phase: 'dependencies' | 'source'
  readonly before: { source: string; revision: string }
  readonly logs?: {
    stdout: { file: string; sha256: string }
    stderr: { file: string; sha256: string }
  }
  /** Execution remains independent from subsequent integrity requests. */
  readonly execution?: {
    readonly state: 'pending' | 'exited' | 'unobserved'
    readonly success?: boolean
    readonly signal?: string | null
  }
  /** A field is verified only after successful acquisition and exact equality. */
  readonly integrity?: {
    readonly source: {
      readonly state: 'pending' | 'verified' | 'failed'
      readonly failure?: FailureType
    }
    readonly revision: {
      readonly state: 'pending' | 'verified' | 'failed'
      readonly failure?: FailureType
    }
  }
}

/** Physical identity is required only for Unix preparation's permission protection. */
interface SnapshotOwnerType {
  readonly path: string
  readonly identity: string
}
/** Device and inode identify copied objects after a private subtree is renamed. */
function physicalIdentity(info: Deno.FileInfo): string {
  if (
    info.isSymlink || (!info.isFile && !info.isDirectory) || typeof info.dev !== 'number' ||
    typeof info.ino !== 'number' ||
    !Number.isSafeInteger(info.dev) || !Number.isSafeInteger(info.ino) || info.dev <= 0 ||
    info.ino <= 0
  ) {
    throw new Error('Release protection requires physical file/directory identities.')
  }
  return `${info.dev}:${info.ino}:${info.isDirectory ? 'directory' : 'file'}`
}
/** Register the original mode before a protection syscall can fail. */
async function freeze(path: string, frozen: Map<string, number>): Promise<void> {
  const info = await Deno.lstat(path)
  const identity = physicalIdentity(info)
  if (info.mode === null) throw new Error('Release protection requires Unix permission modes.')
  if (!frozen.has(identity)) frozen.set(identity, info.mode)
  await Deno.chmod(path, info.mode & ~0o222)
}
/** Capture the newly acquired owner before cloning or other fallible setup. */
async function snapshotOwner(directory: string): Promise<SnapshotOwnerType> {
  const info = await Deno.lstat(directory)
  if (!info.isDirectory || info.isSymlink) {
    throw new Error('Release snapshot owner is not a physical directory.')
  }
  return { path: await Deno.realPath(directory), identity: physicalIdentity(info) }
}
/** Admit the originally acquired root before report reads, restoration or removal. */
async function admitSnapshotOwner(
  directory: string,
  owner: SnapshotOwnerType | undefined,
): Promise<SnapshotOwnerType> {
  if (!owner) {
    throw new SnapshotError(
      'Release snapshot owner identity was not acquired; cleanup is unadmitted.',
    )
  }
  const info = await Deno.lstat(directory)
  if (
    !info.isDirectory || info.isSymlink || physicalIdentity(info) !== owner.identity ||
    await Deno.realPath(directory) !== owner.path
  ) {
    throw new SnapshotError('Release snapshot owner changed; refusing borrowed access.')
  }
  return owner
}
/**
 * Restore only recorded physical objects still below the acquired private owner.
 *
 * Paths from protection are not replayed: gates can rename a protected directory
 * or replace an ancestor with an outside alias. A no-follow walk finds renamed
 * objects by identity and skips aliases. Unregistered output modes stay intact,
 * so a denied output directory remains a real independent cleanup failure.
 *
 * Cleanup assumes settled, quiescent gates. Deno's path-based chmod/remove cannot
 * prevent hostile concurrent same-user replacement between admission and syscall.
 * The traversal adds one metadata visit per owned entry; no borrowed tree is read.
 */
async function retireSnapshot(
  directory: string,
  owner: SnapshotOwnerType | undefined,
  frozen: ReadonlyMap<string, number>,
  failures: unknown[],
): Promise<void> {
  try {
    await admitSnapshotOwner(directory, owner)
  } catch (reason) {
    failures.push(reason)
    return
  }
  const visit = async (path: string): Promise<void> => {
    try {
      const info = await Deno.lstat(path)
      if (info.isSymlink) return
      // Starting at a canonical root and never following links makes every child
      // canonical too. Check it again before any permission mutation.
      if (await Deno.realPath(path) !== path) {
        throw new Error('Release cleanup encountered a changed physical path.')
      }
      if (info.isFile || info.isDirectory) {
        const identity = physicalIdentity(info)
        const mode = frozen.get(identity)
        if (mode !== undefined) {
          if (
            physicalIdentity(await Deno.lstat(path)) !== identity ||
            await Deno.realPath(path) !== path
          ) {
            throw new Error('Release cleanup object changed before permission restoration.')
          }
          await Deno.chmod(path, mode)
        }
      }
      if (info.isDirectory) {
        for await (const entry of Deno.readDir(path)) await visit(resolve(path, entry.name))
      }
    } catch (reason) {
      failures.push(reason)
    }
  }
  // owner is admitted above; keep the runtime check rather than asserting a type.
  if (owner) await visit(owner.path)
  try {
    await admitSnapshotOwner(directory, owner)
    await Deno.remove(directory, { recursive: true })
    try {
      await Deno.lstat(directory)
      failures.push(new Error('Release snapshot survived cleanup.'))
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) failures.push(reason)
    }
  } catch (reason) {
    failures.push(reason)
  }
}

/**
 * Prepares only from an owned checkout of a clean committed revision.
 *
 * Original working-tree edits cannot become build inputs, including edits later
 * restored to their original bytes. Source permissions prevent accidental writes;
 * identity checks remain authoritative. Cleanup must settle before a receipt is
 * issued, and independent operation/cleanup errors are retained together.
 */
async function prepareSnapshot(): Promise<{
  candidate: CandidateType
  manifests: Record<string, string>
}> {
  if (Deno.build.os === 'windows') {
    throw new Error(
      'Release preparation does not support Windows source protection. Run release:prepare on an ordinary Unix account or the Unix CI runner. Consumer runtime support is unchanged.',
    )
  }
  // Unix root bypasses source permissions. Require an ordinary account so an
  // accidental gate write cannot change and restore maintained inputs unseen.
  if (process.getuid?.() === 0) {
    throw new Error(
      'Release preparation does not support Unix UID 0. Run release:prepare as an ordinary account; root bypasses immutable-source permissions.',
    )
  }
  let commit: string, source: string
  try {
    await cleanRevision()
    commit = await revision()
    source = await sourceHash()
  } catch (reason) {
    try {
      await Deno.mkdir(STORE, { recursive: true })
      await save(`${STORE}/authority-${crypto.randomUUID()}.json`, {
        version: 2,
        phase: 'admission',
        passed: false,
        failures: [reason instanceof Error ? reason.message : String(reason)],
        diagnostics: [failure(reason)],
      })
    } catch (record) {
      throw new AggregateError(
        [reason, record],
        'Release admission and diagnostic recording failed.',
        { cause: reason },
      )
    }
    throw reason
  }
  const directory = await Deno.makeTempDir({ prefix: 'release-snapshot-' })
  const snapshot = resolve(directory, 'source')
  const failures: unknown[] = []
  const frozen = new Map<string, number>()
  let owner: SnapshotOwnerType | undefined
  let sourceOwner: SnapshotOwnerType | undefined
  const steps: GateType[] = []
  const attempt = crypto.randomUUID()
  const evidence = `${STORE}/gates-${commit}-${attempt}.json`
  const reportDirectory = `${STORE}/snapshot-${commit}-${attempt}/reports`
  let inputs: InputsType | undefined
  let reports:
    | { path: string; source: string; revision: string; copyState: 'partial' | 'complete' }
    | undefined
  let result: { candidate: CandidateType; manifests: Record<string, string> } | undefined
  try {
    owner = await snapshotOwner(directory)
    await run('git', [
      'clone',
      '--no-hardlinks',
      '--no-checkout',
      '--dissociate',
      '--',
      ROOT,
      snapshot,
    ])
    const acquired = await admitSnapshotOwner(directory, owner)
    sourceOwner = await snapshotOwner(snapshot)
    if (sourceOwner.path !== resolve(acquired.path, 'source')) {
      throw new SnapshotError('Cloned snapshot left its acquired temporary owner.')
    }
    await admitSnapshot()
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commit], snapshot)
    await verify()
    const members = await discoverPackages(snapshot, await loadConfig(snapshot))
    const dependencyGraph = new DependencyGraph(members)
    const opfs = members.has('@okikio/opfs')
    if (!opfs) inputs = await captureInputs(snapshot, frozen, admitSnapshotPath)

    const dependencies = resolve(ROOT, 'node_modules')
    let installed = false
    try {
      await Deno.lstat(dependencies)
      installed = true
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) throw reason
    }
    if (installed) {
      const dependencyRoot = await Deno.realPath(dependencies)
      await copyTree(dependencyRoot, resolve(snapshot, 'node_modules'), [
        [dependencyRoot, resolve(snapshot, 'node_modules')],
        [ROOT, snapshot, true],
        ...(inputs?.mappings ?? []),
      ])
    }
    await copySourceCache(resolve(directory, 'deno-cache'))
    if (opfs) await dependenciesPhase()
    await protectSource(snapshot, frozen)
    // Load gate authority from the committed clone, not an already-loaded
    // module in the mutable original checkout.
    const dag = await import(
      pathToFileURL(resolve(snapshot, '.mise/tasks/release-check.ts')).href
    ) as { tasks?: unknown }
    if (!Array.isArray(dag.tasks)) throw new Error('Snapshot release DAG is absent.')
    const releaseTasks = dag.tasks.map((task: unknown): string => {
      if (typeof task !== 'string') {
        throw new Error('Snapshot release DAG contains a non-string task.')
      }
      return task
    })
    const tasks = opfs
      ? [
        'quality:source',
        'test',
        'test:node',
        'test:bun',
        'test:browser',
        'test:ecosystems',
        'test:providers',
        'test:linux',
        'bench:report',
        'bench:browser',
        'pack:npm',
        'verify:npm:artifact',
      ]
      : [...releaseTasks]
    for (const task of tasks) {
      await verify()
      const before = { source: await currentSource(), revision: await currentRevision() }
      const index = beginGate(task, 'source', before)
      await checkpoint()
      const errors: unknown[] = []
      try {
        await admitSnapshot()
        const status = await new Deno.Command(Deno.execPath(), {
          args: [
            'task',
            task,
            ...(task === 'verify:npm:artifact'
              ? [archivePath(members.get('@okikio/opfs')!, opfs)]
              : []),
          ],
          cwd: snapshot,
          env: { DENO_DIR: resolve(directory, 'deno-cache'), ...inputs?.env },
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        }).spawn().status
        observeGate(index, status)
        if (!status.success) {
          errors.push(
            new Error(
              `Snapshot gate '${task}' failed with exit code ${status.code}, signal ${
                status.signal ?? 'none'
              }.`,
            ),
          )
        }
      } catch (reason) {
        observeGate(index)
        errors.push(reason)
      }
      await finishGate(index, errors)
      if (errors.length) {
        throw new AggregateError(
          errors,
          `Snapshot gate '${task}' or integrity acquisition failed.`,
          { cause: errors[0] },
        )
      }
      await verify()
    }
    const rows: CandidateType['packages'] = []
    const manifests: Record<string, string> = {}
    for (const name of dependencyGraph.topologicalSort(members)) {
      const member = members.get(name)!
      const archive = archivePath(member, opfs)
      await admitSnapshotPath(resolve(snapshot, archive))
      await admitSnapshotPath(resolve(snapshot, member.dir, 'package.json'))
      rows.push({
        name,
        version: member.version,
        archive,
        sha256: await hash(await Deno.readFile(resolve(snapshot, archive))),
      })
      manifests[name] = await Deno.readTextFile(
        resolve(snapshot, member.dir, 'package.json'),
      )
    }
    await verify()
    await original()
    // Carry package receipts and report bytes with the archives. Never merge an
    // old artifact inventory into the newly checked snapshot's inventory.
    const artifactDirectory = opfs ? '.release/npm' : '.tmp/packages'
    const output = resolve(ROOT, artifactDirectory)
    await verify()
    try {
      await Deno.remove(output, { recursive: true })
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) throw reason
    }
    await Deno.mkdir(output, { recursive: true })
    for (const row of rows) {
      await verify()
      await admitSnapshotPath(resolve(snapshot, row.archive))
      await Deno.copyFile(resolve(snapshot, row.archive), resolve(ROOT, row.archive))
    }
    // Artifact inventory is an independent packing authority; retain it when
    // this package family emits one, without copying its staging/install trees.
    const receipt = resolve(snapshot, artifactDirectory, 'artifacts.json')
    try {
      await admitSnapshotPath(receipt)
      await Deno.copyFile(receipt, resolve(output, 'artifacts.json'))
    } catch (reason) {
      if (!(reason instanceof Deno.errors.NotFound)) throw reason
    }
    for (const row of rows) {
      if (row.sha256 !== await hash(await Deno.readFile(resolve(ROOT, row.archive)))) {
        throw new Error(`Snapshot artifact copy changed: ${row.archive}`)
      }
    }
    result = {
      candidate: {
        source,
        revision: commit,
        created: new Date().toISOString(),
        gates: { file: evidence, sha256: '' },
        ...(inputs ? { inputs: inputs.receipt } : {}),
        packages: rows,
      },
      manifests,
    }
  } catch (reason) {
    failures.push(reason)
  } finally {
    // Failed/partial reports are diagnostic bytes, not source or publication authority.
    // Retain them before removing their owner, even when Git identity acquisition failed.
    try {
      await retainReports()
    } catch (reason) {
      failures.push(new ReportError(reports ? 'copy' : 'admission', reason))
    }
    try {
      await checkpoint()
    } catch (reason) {
      failures.push(reason)
    }
    // Restoration/removal retain each independent error and never replay stale paths.
    await retireSnapshot(directory, owner, frozen, failures)
    if (failures.length === 0) {
      try {
        await original()
      } catch (reason) {
        failures.push(reason)
      }
    }
    // A receipt saying passed must include successful owned cleanup. Do not
    // replace evidence from another attempt at this same immutable revision.
    try {
      await Deno.mkdir(STORE, { recursive: true })
      await save(evidence, {
        revision: commit,
        source,
        version: 2,
        steps,
        diagnostics: failures.map((reason) => failure(reason)),
        ...(reports
          ? {
            reports: {
              ...reports,
              outcome: result !== undefined && failures.length === 0 ? 'passed' : 'failed',
              sourceIdentity: result !== undefined && failures.length === 0
                ? 'verified'
                : 'expected',
            },
          }
          : {}),
        ...(inputs ? { inputs: inputs.receipt } : {}),
        passed: result !== undefined && failures.length === 0,
        failures: failures.map((reason) =>
          reason instanceof Error ? reason.message : String(reason)
        ),
      })
    } catch (reason) {
      failures.push(reason)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Snapshot preparation and cleanup failed.', {
      cause: failures[0],
    })
  }
  if (!result) throw new Error('Snapshot preparation did not produce a candidate.')
  result.candidate.gates.sha256 = await hash(await Deno.readFile(evidence))
  return result

  /** One attempt copies report bytes once, using the same confined alias contract as successful evidence. */
  async function retainReports(): Promise<void> {
    if (reports) return
    await admitSnapshot()
    const acquired = await admitSnapshotOwner(directory, owner)
    let reportSource = resolve(snapshot, '.tmp/reports')
    try {
      const owner = await Deno.lstat(snapshot)
      if (!owner.isDirectory || owner.isSymlink) {
        throw new Error('Release snapshot report owner must be a physical directory.')
      }
      const physical = await Deno.realPath(snapshot)
      if (physical !== resolve(acquired.path, 'source')) {
        throw new Error('Release report snapshot left its acquired owner.')
      }
      const parent = resolve(snapshot, '.tmp')
      const parentInfo = await Deno.lstat(parent)
      if (
        !parentInfo.isDirectory || parentInfo.isSymlink ||
        await Deno.realPath(parent) !== resolve(physical, '.tmp')
      ) {
        throw new Error('Release report parent must be a physical directory inside the snapshot.')
      }
      const info = await Deno.lstat(reportSource)
      if (
        !info.isDirectory || info.isSymlink ||
        await Deno.realPath(reportSource) !== resolve(physical, '.tmp/reports')
      ) {
        throw new Error('Release report root must be a physical directory.')
      }
      // Canonical ownership admits OS prefix aliases while keeping child alias mapping confined.
      reportSource = resolve(physical, '.tmp/reports')
    } catch (reason) {
      if (reason instanceof Deno.errors.NotFound) return
      throw reason
    }
    const target = resolve(ROOT, reportDirectory)
    // Partial is recorded before copy so failure never silently relabels incomplete output as complete.
    reports = { path: reportDirectory, source, revision: commit, copyState: 'partial' }
    await copyTree(reportSource, target, [[reportSource, target]])
    reports = { ...reports, copyState: 'complete' }
  }

  /** Pending and actual child observation are persisted before fallible integrity checks. */
  function beginGate(task: string, phase: GateType['phase'], before: GateType['before']): number {
    const index = steps.length, started = new Date().toISOString()
    steps.push({
      task,
      phase,
      before,
      started,
      code: null,
      execution: { state: 'pending' },
      integrity: { source: { state: 'pending' }, revision: { state: 'pending' } },
    })
    return index
  }
  /** Unobserved status never becomes a fabricated zero exit. */
  function observeGate(index: number, status?: Deno.CommandStatus): void {
    steps[index] = {
      ...steps[index]!,
      finished: new Date().toISOString(),
      code: status?.code ?? null,
      execution: status
        ? { state: 'exited', success: status.success, signal: status.signal }
        : { state: 'unobserved' },
    }
  }
  /** In-progress checkpoints refuse publication, including after a supervisor interruption. */
  async function checkpoint(): Promise<void> {
    await Deno.mkdir(STORE, { recursive: true })
    await save(evidence, {
      version: 2,
      revision: commit,
      source,
      steps,
      passed: false,
      diagnostics: failures.map((reason) => failure(reason)),
      ...(reports
        ? { reports: { ...reports, outcome: 'pending', sourceIdentity: 'expected' } }
        : {}),
    })
  }
  /** Both identity authorities are attempted; one failure cannot erase the other or the child outcome. */
  async function finishGate(index: number, errors: unknown[]): Promise<void> {
    try {
      await checkpoint()
    } catch (reason) {
      errors.push(reason)
    }
    const values = await Promise.allSettled([currentSource(), currentRevision()])
    let step = steps[index]!
    const integrity: {
      source: NonNullable<GateType['integrity']>['source']
      revision: NonNullable<GateType['integrity']>['revision']
    } = { source: { state: 'pending' }, revision: { state: 'pending' } }
    for (
      const [position, field, expected] of [[0, 'source', source], [1, 'revision', commit]] as const
    ) {
      const value = values[position]!
      let reason: unknown
      if (value.status === 'fulfilled') {
        step = { ...step, [field]: value.value }
        if (value.value === expected) {
          integrity[field] = { state: 'verified' }
          continue
        }
        reason = new Error(`Snapshot ${field} changed during release preparation.`)
      } else reason = value.reason
      errors.push(reason)
      integrity[field] = { state: 'failed', failure: failure(reason) }
    }
    steps[index] = { ...step, integrity }
    try {
      await checkpoint()
    } catch (reason) {
      errors.push(reason)
    }
  }

  /** Installs the committed lock graph while its root entry may be replaced, before any source gate. */
  async function dependenciesPhase(): Promise<void> {
    await verify()
    await original()
    const before = { source: await currentSource(), revision: await currentRevision() }
    const index = beginGate('deps:ci', 'dependencies', before)
    await checkpoint()
    const logs = `${STORE}/snapshot-${commit}-${attempt}/dependencies`
    await Deno.mkdir(resolve(ROOT, logs), { recursive: true })
    const stdout = `${logs}/stdout.log`, stderr = `${logs}/stderr.log`
    const files: Deno.FsFile[] = []
    const errors: unknown[] = []
    let status: Deno.CommandStatus | undefined
    try {
      const out = await Deno.open(resolve(ROOT, stdout), { write: true, createNew: true })
      files.push(out)
      const err = await Deno.open(resolve(ROOT, stderr), { write: true, createNew: true })
      files.push(err)
      console.log('Snapshot dependency phase: deno task deps:ci (before source protection).')
      await admitSnapshot()
      const child = new Deno.Command(Deno.execPath(), {
        args: ['task', 'deps:ci'],
        cwd: snapshot,
        env: { DENO_DIR: resolve(directory, 'deno-cache'), ...inputs?.env },
        stdin: 'inherit',
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()
      const retain = async (
        stream: ReadableStream<Uint8Array>,
        file: Deno.FsFile,
      ): Promise<void> => {
        const reader = stream.getReader()
        const failures: unknown[] = []
        let ended = false
        try {
          // Write exact child bytes directly. FsFile writes can be shorter than
          // the supplied chunk; retain the remainder before reading more data.
          while (true) {
            const item = await reader.read()
            if (item.done) {
              ended = true
              break
            }
            let offset = 0
            while (offset < item.value.length) {
              const remaining = item.value.subarray(offset)
              const written = await file.write(remaining)
              if (!Number.isInteger(written) || written <= 0 || written > remaining.length) {
                throw new Error('Dependency raw output writer made invalid progress.')
              }
              offset += written
            }
          }
        } catch (reason) {
          failures.push(reason)
          // Stop this directly owned task CLI on logging failure. Its spawned
          // install descendants are not implied to share that lifetime; the
          // outer aggregate/container watchdog owns the final process boundary.
          try {
            child.kill('SIGKILL')
          } catch (stop) {
            if (!(stop instanceof Deno.errors.NotFound)) failures.push(stop)
          }
        } finally {
          if (!ended) {
            try {
              await reader.cancel()
            } catch (reason) {
              failures.push(reason)
            }
          }
          try {
            reader.releaseLock()
          } catch (reason) {
            failures.push(reason)
          }
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Dependency raw output and reader cleanup failed.', {
            cause: failures[0],
          })
        }
      }
      // Both raw streams settle alongside the actual status. A logging failure
      // cannot become successful dependency evidence or suppress another error.
      const outcomes = await Promise.allSettled(
        [
          child.status.then(async (value) => {
            status = value
            observeGate(index, value)
            // A descendant may still hold a raw-output pipe after this CLI exits.
            // Persist its observed status without waiting for those unrelated lifetimes.
            try {
              await checkpoint()
            } catch (reason) {
              errors.push(reason)
            }
            return value
          }),
          retain(child.stdout, out),
          retain(child.stderr, err),
        ] as const,
      )
      const first = outcomes[0]!
      if (first.status === 'fulfilled') status = first.value
      for (const outcome of outcomes) if (outcome.status === 'rejected') errors.push(outcome.reason)
    } catch (reason) {
      errors.push(reason)
    } finally {
      for (const file of files) {
        try {
          file.close()
        } catch (reason) {
          errors.push(reason)
        }
      }
    }
    let recorded: GateType['logs']
    try {
      recorded = {
        stdout: { file: stdout, sha256: await fileHash(resolve(ROOT, stdout)) },
        stderr: { file: stderr, sha256: await fileHash(resolve(ROOT, stderr)) },
      }
    } catch (reason) {
      errors.push(reason)
    }
    if (!status) observeGate(index)
    if (recorded) steps[index] = { ...steps[index]!, logs: recorded }
    if (!status?.success) {
      errors.push(
        new Error(
          `Snapshot dependency phase 'deps:ci' failed with exit code ${
            status?.code ?? 'unreported'
          }, signal ${status?.signal ?? 'unobserved'}. See ${stdout} and ${stderr}.`,
        ),
      )
    }
    await finishGate(index, errors)
    if (errors.length) {
      throw new AggregateError(
        errors,
        'Dependency installation, raw evidence, or integrity failed.',
        { cause: errors[0] },
      )
    }
    await verify()
    await original()
  }

  /** Every snapshot operation re-admits its originally acquired physical roots. */
  async function admitSnapshot(): Promise<void> {
    const acquired = await admitSnapshotOwner(directory, owner)
    const captured = await admitSnapshotOwner(snapshot, sourceOwner)
    if (captured.path !== resolve(acquired.path, 'source')) {
      throw new SnapshotError('Snapshot source left its acquired temporary owner.')
    }
  }
  /**
   * Admit a physical path before reading owned source or package output.
   * Root identity alone is insufficient when a gate replaces a nested ancestor.
   * Setup writes may name absent children, but their nearest existing ancestor
   * must still have the expected canonical path below the acquired source root.
   */
  async function admitSnapshotPath(path: string, missing = false): Promise<void> {
    await admitSnapshot()
    if (!sourceOwner) throw new SnapshotError('Snapshot source owner was not acquired.')
    const local = relative(snapshot, path)
    if (
      isAbsolute(local) || local === '..' ||
      local.startsWith(`..${Deno.build.os === 'windows' ? '\\' : '/'}`) ||
      resolve(snapshot, local) !== path
    ) {
      throw new SnapshotError('Snapshot path is outside its acquired source owner.')
    }
    const expected = resolve(sourceOwner.path, local)
    let existing = expected
    while (true) {
      try {
        const info = await Deno.lstat(existing)
        if (info.isSymlink || await Deno.realPath(existing) !== existing) {
          throw new SnapshotError('Snapshot path contains an unadmitted alias.')
        }
        return
      } catch (reason) {
        if (
          !(reason instanceof Deno.errors.NotFound) || !missing || existing === sourceOwner.path
        ) throw reason
        existing = dirname(existing)
      }
    }
  }
  /** Independent source and revision attempts retain their own admission faults. */
  async function currentSource(): Promise<string> {
    await admitSnapshotPath(resolve(snapshot, '.git'))
    return await sourceHash(snapshot, admitSnapshotPath)
  }
  async function currentRevision(): Promise<string> {
    await admitSnapshotPath(resolve(snapshot, '.git'))
    return await revision(snapshot)
  }

  /** Checks identity after every gate, and before copying any release output. */
  async function verify(): Promise<void> {
    await admitSnapshot()
    await inputs?.verify()
    if (await currentRevision() !== commit || await currentSource() !== source) {
      throw new Error('Snapshot source or revision changed during release preparation.')
    }
  }
  /** Refuses a receipt when the caller retained an edit or changed branches. */
  async function original(): Promise<void> {
    await inputs?.original()
    await cleanRevision()
    if (await revision() !== commit || await sourceHash() !== source) {
      throw new Error('Original source or revision changed during snapshot preparation.')
    }
  }
}

/**
 * Copies independent bytes, rebasing only aliases inside the owned dependency
 * tree or committed workspace. External aliases reject instead of borrowing a
 * mutable checkout. No hard links are created.
 */
async function copyTree(
  source: string,
  destination: string,
  mappings: readonly (readonly [string, string, boolean?])[],
): Promise<void> {
  const info = await Deno.lstat(source)
  if (info.isSymlink) {
    const target = await Deno.realPath(source)
    const mapping = mappings.filter(([from]) =>
      target === from || target.startsWith(`${from}${Deno.build.os === 'windows' ? '\\' : '/'}`)
    ).sort((left, right) =>
      right[0].length - left[0].length
    )[0]
    if (!mapping) throw new Error(`Snapshot dependency alias escapes owned inputs: ${source}`)
    const mapped = resolve(mapping[1], relative(mapping[0], target))
    // Workspace source must actually exist in the committed clone. A link into
    // an ignored/uncommitted source directory is not a release dependency.
    if (mapping[2]) await Deno.lstat(mapped)
    await Deno.mkdir(dirname(destination), { recursive: true })
    await Deno.symlink(relative(dirname(destination), mapped), destination, {
      type: (await Deno.stat(source)).isDirectory ? 'dir' : 'file',
    })
  } else if (info.isDirectory) {
    await Deno.mkdir(destination, { recursive: true })
    for await (const child of Deno.readDir(source)) {
      await copyTree(resolve(source, child.name), resolve(destination, child.name), mappings)
    }
  } else if (info.isFile) {
    await Deno.mkdir(dirname(destination), { recursive: true })
    await Deno.copyFile(source, destination)
    if (Deno.build.os !== 'windows' && info.mode !== null) await Deno.chmod(destination, info.mode)
  } else throw new Error(`Unsupported snapshot input: ${source}`)
}

/** Enumerates maintained files; Git's ignore authority excludes task-owned outputs. */
async function sourcePaths(cwd: string): Promise<string[]> {
  const output = await git([
    '-c',
    'core.fsmonitor=false',
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ], cwd)
  return [...new Set(new TextDecoder().decode(output.stdout).split('\0').filter(Boolean))].sort()
}

/** Seeds an owned cache with downloaded source/metadata, never compiler state or databases. */
async function copySourceCache(destination: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['info', '--json'],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error('Cannot locate downloaded Deno source cache.')
  const info = JSON.parse(new TextDecoder().decode(result.stdout)) as { denoDir: string }
  await Deno.mkdir(destination, { recursive: true })
  for (const name of ['remote', 'registries', 'jsr']) {
    const source = resolve(info.denoDir, name), target = resolve(destination, name)
    try {
      await Deno.lstat(source)
    } catch (reason) {
      if (reason instanceof Deno.errors.NotFound) continue
      throw reason
    }
    await copyTree(source, target, [[source, target]])
  }
}
