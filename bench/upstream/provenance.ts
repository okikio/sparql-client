/** Checks the original bytes that authorize adopted datastore cases and workloads. @module */

const root = new URL('../../', import.meta.url)
const prefix = 'bench/upstream/sources/'

/** Identity of the verified snapshot set; manifest bytes bind all copied-file digests. */
export interface SourcesType {
  readonly count: number
  readonly identity: string
}

/** Hashes original bytes without newline or text decoding changes. */
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
}

/** Narrows untrusted manifest objects before reading their paths or digest fields. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Upstream provenance must contain objects')
  }
  return value as Record<string, unknown>
}

/** Enumerates only original regular files; symlinks cannot substitute different fixture authority. */
async function files(directory: URL, path: string): Promise<string[]> {
  const result: string[] = []
  for await (const entry of Deno.readDir(directory)) {
    const name = `${path}${entry.name}`
    if (entry.isDirectory) {
      result.push(...await files(new URL(`${entry.name}/`, directory), `${name}/`))
    } else if (entry.isFile) result.push(name)
    else throw new TypeError(`Upstream snapshot must be a regular file: ${name}`)
  }
  return result
}

/**
 * Verifies every copied source and license against its pinned digest and byte size.
 * Missing, changed and unexplained extra snapshots invalidate acquisition before
 * parsing or timing. Call again after consumption to detect changes during a run.
 */
export async function inspectSources(): Promise<SourcesType> {
  const manifestBytes = await Deno.readFile(new URL('./provenance.json', import.meta.url))
  const manifest = record(JSON.parse(new TextDecoder().decode(manifestBytes)))
  if (
    manifest.format !== 1 || !Array.isArray(manifest.projects) ||
    !Array.isArray(manifest.additionalLicenses)
  ) {
    throw new TypeError('Unsupported upstream provenance schema')
  }
  const entries: Record<string, unknown>[] = []
  for (const value of manifest.projects) {
    const project = record(value)
    if (
      typeof project.repository !== 'string' || typeof project.commit !== 'string' ||
      !/^[a-f0-9]{40}$/.test(project.commit) || typeof project.license !== 'string' ||
      !Array.isArray(project.files)
    ) throw new TypeError('Invalid pinned source identity')
    for (const value of project.files) {
      const file = record(value)
      if (
        typeof file.path !== 'string' ||
        file.url !==
          `https://raw.githubusercontent.com/${project.repository}/${project.commit}/${file.path}`
      ) {
        throw new TypeError('Source URL must identify its pinned original path')
      }
      entries.push(file)
    }
  }
  entries.push(...manifest.additionalLicenses.map(record))
  if (!entries.length) throw new TypeError('Upstream provenance must not be empty')
  const expected = new Set<string>()
  for (const file of entries) {
    if (
      typeof file.local !== 'string' || !file.local.startsWith(prefix) ||
      file.local.split('/').some((part) => !part || part === '.' || part === '..') ||
      /[\\%?#]/.test(file.local) || typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.bytes !== 'number' ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 0 || expected.has(file.local)
    ) {
      throw new TypeError('Invalid or duplicate upstream snapshot record')
    }
    expected.add(file.local)
    const bytes = await Deno.readFile(new URL(file.local, root))
    if (bytes.length !== file.bytes || await digest(bytes) !== file.sha256) {
      throw new Error(`Upstream snapshot differs from its pin: ${file.local}`)
    }
  }
  const actual = await files(new URL(prefix, root), prefix)
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) {
    throw new Error('Unlisted or missing upstream snapshot')
  }
  return { count: expected.size, identity: await digest(manifestBytes) }
}
