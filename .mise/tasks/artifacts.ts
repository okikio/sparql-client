/** Rejects stale or substituted development archives before installed-consumer validation. @module */
import { join } from 'node:path'
import * as workspace from './workspace.ts'

/** A receipt binds each archive to the workspace package identity and its actual bytes. */
interface ArtifactType {
  readonly name: string
  readonly version: string
  readonly file: string
  readonly sha256: string
}

/** Build inputs exclude tests, benchmark programs, local outputs and runtime-test task strings. */
export async function identity(root = '.'): Promise<Readonly<Record<string, string>>> {
  const inputs: Record<string, string> = {}
  const config = object(JSON.parse(await Deno.readTextFile(join(root, 'deno.json'))))
  const selected = Object.fromEntries(
    ['workspace', 'imports', 'compilerOptions', 'publish'].filter((key) => key in config)
      .map((key) => [key, config[key]]),
  )
  inputs['deno.json:pack'] = await digest(new TextEncoder().encode(canonical(selected)))
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
    inputs[path] = await digest(await Deno.readFile(join(root, path)))
  }
  for (const member of await workspace.get(root)) await visit(member)
  return Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))

  /** Package-owned source and documents can enter the artifact; host debris and test definitions cannot. */
  async function visit(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(join(root, directory))) {
      if (
        entry.name === '.DS_Store' || entry.name.startsWith('._') || entry.name === 'node_modules'
      ) continue
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory) await visit(path)
      else if (entry.isFile && !/_(?:test|bench)\.ts$/u.test(entry.name)) {
        inputs[path] = await digest(await Deno.readFile(join(root, path)))
      } else if (!entry.isFile) throw new Error(`Unexpected package input: ${path}`)
    }
  }
}

/** Writes a receipt only after packing succeeds and the build inputs remain unchanged. */
export async function save(before: Readonly<Record<string, string>>, root = '.'): Promise<void> {
  const after = await identity(root)
  if (canonical(before) !== canonical(after)) {
    throw new Error('Package inputs changed during packing.')
  }
  const archives = await expected(root)
  await exactFiles(archives, root)
  const values = await Promise.all(archives.map(async (archive) => ({
    ...archive,
    sha256: await digest(await Deno.readFile(join(root, '.tmp/packages', archive.file))),
  })))
  await Deno.writeTextFile(
    join(root, '.tmp/packages/artifacts.json'),
    `${JSON.stringify({ version: 1, inputs: after, archives: values }, null, 2)}\n`,
  )
}

/** Returns the exact current six archives, rejecting stale sources, versions, extras and byte substitutions. */
export async function get(root = '.'): Promise<readonly string[]> {
  const receipt = object(
    JSON.parse(await Deno.readTextFile(join(root, '.tmp/packages/artifacts.json'))),
  )
  if (receipt.version !== 1 || !Array.isArray(receipt.archives)) {
    throw new TypeError('Invalid artifact receipt.')
  }
  const inputs = object(receipt.inputs)
  if (canonical(inputs) !== canonical(await identity(root))) {
    throw new Error('Packed artifacts are stale. Run deno task package on the current source.')
  }
  const archives = await expected(root)
  await exactFiles(archives, root)
  if (receipt.archives.length !== archives.length) {
    throw new Error('Artifact receipt package set differs.')
  }
  const rows = new Map(receipt.archives.map((value) => {
    const row = object(value)
    if (typeof row.name !== 'string') {
      throw new TypeError('Artifact receipt package name is missing.')
    }
    return [row.name, row] as const
  }))
  if (rows.size !== archives.length) throw new Error('Duplicate artifact receipt package name.')
  for (const archive of archives) {
    const row = rows.get(archive.name)
    if (!row) throw new Error(`Artifact receipt omits ${archive.name}.`)
    if (row.name !== archive.name || row.version !== archive.version || row.file !== archive.file) {
      throw new Error(`Artifact receipt identity differs for ${archive.name}.`)
    }
    if (
      row.sha256 !== await digest(await Deno.readFile(join(root, '.tmp/packages', archive.file)))
    ) {
      throw new Error(`Archive bytes differ from the packing receipt: ${archive.file}.`)
    }
  }
  return archives.map(({ file }) => join(root, '.tmp/packages', file))
}

/**
 * Confirms installed first-party payloads match the current archives, including extra or missing files.
 * npm may put separate dependencies under a package's node_modules; those are outside this payload comparison.
 */
export async function installed(directory: string, root = '.'): Promise<void> {
  await get(root)
  const temporary = await Deno.makeTempDir({ prefix: 'artifact-installation-' })
  const errors: unknown[] = []
  try {
    for (const archive of await expected(root)) {
      const output = join(temporary, archive.name)
      await Deno.mkdir(output, { recursive: true })
      const extracted = await new Deno.Command('tar', {
        args: [
          '-xzf',
          join(await Deno.realPath(root), '.tmp/packages', archive.file),
          '-C',
          output,
        ],
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!extracted.success) {
        throw new Error(`Archive extraction failed: ${archive.file}`, {
          cause: new TextDecoder().decode(extracted.stderr),
        })
      }
      const actual = join(directory, 'node_modules', archive.name)
      if ((await Deno.lstat(actual)).isSymlink) {
        throw new Error(`Installed package must not link to source: ${archive.name}.`)
      }
      if (canonical(await tree(join(output, 'package'))) !== canonical(await tree(actual))) {
        throw new Error(
          `Installed package payload differs from the current archive: ${archive.name}.`,
        )
      }
    }
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      await Deno.remove(temporary, { recursive: true })
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Installed artifact validation failed.')
}

/** Relative paths and regular-file byte digests compare payloads independently of tar order and host metadata. */
async function tree(root: string): Promise<Readonly<Record<string, string>>> {
  const values: Record<string, string> = {}
  await visit('')
  return values
  async function visit(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(join(root, relative))) {
      if (relative === '' && entry.name === 'node_modules') continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory) await visit(path)
      else if (entry.isFile) values[path] = await digest(await Deno.readFile(join(root, path)))
      else throw new Error(`Unexpected installed artifact entry: ${path}.`)
    }
  }
}

/** npm and JSR metadata must agree before an archive can represent a workspace member. */
async function expected(root: string): Promise<readonly Omit<ArtifactType, 'sha256'>[]> {
  const result: Omit<ArtifactType, 'sha256'>[] = []
  for (const member of await workspace.get(root)) {
    const npm = object(JSON.parse(await Deno.readTextFile(join(root, member, 'package.json'))))
    const jsr = object(JSON.parse(await Deno.readTextFile(join(root, member, 'deno.json'))))
    if (
      typeof npm.name !== 'string' || typeof npm.version !== 'string' ||
      npm.name !== jsr.name || npm.version !== jsr.version
    ) {
      throw new Error(`${member}: npm and Deno package identities differ.`)
    }
    result.push({
      name: npm.name,
      version: npm.version,
      file: `${npm.name.replace(/^@/u, '').replace('/', '-')}-${npm.version}.tgz`,
    })
  }
  if (new Set(result.map(({ name }) => name)).size !== result.length) {
    throw new Error('Duplicate workspace package name.')
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** An extra or missing archive changes the installation target and must fail before npm runs. */
async function exactFiles(expected: readonly { file: string }[], root: string): Promise<void> {
  const actual: string[] = []
  for await (const entry of Deno.readDir(join(root, '.tmp/packages'))) {
    if (entry.name.endsWith('.tgz')) {
      if (!entry.isFile) throw new Error(`Archive is not a regular file: ${entry.name}.`)
      actual.push(entry.name)
    }
  }
  if (canonical(actual.sort()) !== canonical(expected.map(({ file }) => file).sort())) {
    throw new Error('Packed archive inventory differs from current workspace packages.')
  }
}

/** Canonical record order prevents harmless JSON key rearrangement from changing an identity check. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')
    }}`
  }
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('Artifact identity must contain JSON values.')
  return text
}

/** Only object-shaped receipts and manifests have the required named fields. */
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object record.')
  }
  return value as Record<string, unknown>
}

/** SHA-256 binds the receipt to retained source and archive bytes, rather than filenames alone. */
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
