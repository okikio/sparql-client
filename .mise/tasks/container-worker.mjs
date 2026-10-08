/** Verifies an owned packed-consumer copy around its actual lane-native behavior. @module */
import { createHash } from 'node:crypto'
import { chmod, lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argv } from 'node:process'

const root = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(root, 'admission.json')
const bytes = await readFile(manifestPath)
const manifest = JSON.parse(bytes.toString('utf8'))
const failures = []

/** Exact membership detects missing or extra files as well as byte, kind, link and permission changes. */
async function verify(protectedMode = true) {
  const info = await lstat(root)
  const receipt = await lstat(manifestPath)
  if (
    info.uid !== 0 || receipt.uid !== 0 || (protectedMode && ((info.mode & 0o022) !== 0 ||
      (receipt.mode & 0o777) !== 0o444))
  ) {
    throw new Error('Copied root or receipt lacks readonly ordinary-user protection.')
  }
  const actual = []
  async function visit(path) {
    const absolute = join(root, path)
    const info = await lstat(absolute)
    const kind = info.isDirectory()
      ? 'directory'
      : info.isFile()
      ? 'file'
      : info.isSymbolicLink()
      ? 'link'
      : 'special'
    if (kind === 'special' || info.uid !== 0) throw new Error(`Unowned copied entry: ${path}`)
    if (kind === 'file' && info.nlink !== 1) throw new Error(`Aliased copied file: ${path}`)
    const entry = { path, kind, mode: info.mode & 0o777, uid: info.uid, gid: info.gid }
    if (kind === 'file') {
      entry.bytes = info.size
      entry.sha256 = createHash('sha256').update(await readFile(absolute)).digest('hex')
    } else if (kind === 'link') {
      entry.target = await readlink(absolute)
      const target = relative(root, await realpath(absolute))
      if (target === '..' || target.startsWith(`..${sep}`) || target.startsWith(sep)) {
        throw new Error(`Escaped copied link: ${path}`)
      }
      entry.resolved = target.split(sep).join('/')
    }
    actual.push(entry)
    if (kind === 'directory') {
      for (const name of (await readdir(absolute)).sort()) await visit(`${path}/${name}`)
    }
  }
  for (const name of (await readdir(root)).sort()) {
    if (name !== 'admission.json') await visit(name)
  }
  actual.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const comparable = (entries) =>
    protectedMode ? entries : entries.map(({ mode: _mode, ...entry }) => entry)
  if (JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(manifest.entries))) {
    throw new Error('Copied consumer membership, bytes, modes or links differ from admission.')
  }
  if (!(await readFile(manifestPath)).equals(bytes)) {
    throw new Error('Copy admission receipt changed.')
  }
}

try {
  const status = await readFile('/proc/self/status', 'utf8')
  const admitting = argv.includes('--admit')
  for (const field of ['Uid', 'Gid']) {
    const values = status.match(new RegExp(`^${field}:\\s+(.*)$`, 'm'))?.[1]?.trim().split(/\s+/u)
    if (values?.length !== 4 || values.some((value) => value !== (admitting ? '0' : '1000'))) {
      throw new Error('Consumer must run as the ordinary copied-payload user.')
    }
  }
  for (const field of admitting ? [] : ['CapEff', 'CapPrm', 'CapAmb']) {
    if (!new RegExp(`^${field}:\\s*0+$`, 'm').test(status)) {
      throw new Error(`Ordinary consumer retains ${field} capabilities.`)
    }
  }
  if (admitting) {
    await verify(false)
    for (const entry of [...manifest.entries].reverse()) {
      if (entry.kind !== 'link') await chmod(join(root, entry.path), entry.mode)
    }
    await chmod(manifestPath, 0o444)
    await chmod(root, 0o555)
  }
  await verify()
  console.log(
    `Copied consumer admission passed: ${manifest.entries.length} entries, ${manifest.archives.length} archives.`,
  )
  if (!admitting) await import('./consumer/behavior.ts')
} catch (error) {
  failures.push(error)
} finally {
  try {
    await verify()
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) {
  throw new AggregateError(failures, 'Copied consumer behavior or identity failed.')
}
console.log('Copied consumer identity remained unchanged after behavior.')
