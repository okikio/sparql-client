/** Verifies an owned packed-consumer copy around its actual lane-native behavior. @module */
import { createHash } from 'node:crypto'
import { chmod, lchown, lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argv } from 'node:process'
import { attest } from './attest.mjs'

/** Reads only a regular independent receipt from the already acquired private root. */
async function receipt(root) {
  const info = await lstat(root)
  const file = await lstat(join(root, 'admission.json'))
  if (!info.isDirectory() || info.isSymbolicLink() || !file.isFile() || file.nlink !== 1) {
    throw new Error('Copied root and receipt must be physical independent entries.')
  }
  const bytes = await readFile(join(root, 'admission.json'))
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error('Copied manifest has no supported entry inventory.')
  }
  const entries = new Map()
  for (const entry of manifest.entries) {
    if (
      typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') ||
      entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      isAbsolute(entry.path) || entries.has(entry.path) ||
      !['directory', 'file', 'link'].includes(entry.kind) || entry.uid !== 0 || entry.gid !== 0 ||
      entry.mode !==
        (entry.kind === 'directory' ? 0o555 : entry.kind === 'link' ? 0o777 : entry.mode) ||
      (entry.kind === 'file' && entry.mode !== 0o444 && entry.mode !== 0o555)
    ) {
      throw new Error('Copied manifest contains an invalid path, kind, owner or mode.')
    }
    entries.set(entry.path, entry)
  }
  for (const entry of manifest.entries) {
    const parent = dirname(entry.path)
    if (parent !== '.' && entries.get(parent)?.kind !== 'directory') {
      throw new Error('Copied manifest parent is not an admitted physical directory.')
    }
  }
  return { bytes, manifest, entries }
}

/** Exact membership detects missing or extra files as well as byte, kind, link and permission changes. */
async function verify(root, admitted, protectedMode = true, owner = { uid: 0, gid: 0 }) {
  const info = await lstat(root)
  const receiptInfo = await lstat(join(root, 'admission.json'))
  if (
    !info.isDirectory() || info.isSymbolicLink() || !receiptInfo.isFile() ||
    receiptInfo.nlink !== 1 ||
    info.uid !== owner.uid || info.gid !== owner.gid ||
    receiptInfo.uid !== owner.uid || receiptInfo.gid !== owner.gid ||
    (protectedMode && ((info.mode & 0o777) !== 0o555 || (receiptInfo.mode & 0o777) !== 0o444))
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
    if (kind === 'special' || info.uid !== owner.uid || info.gid !== owner.gid) {
      throw new Error(`Unowned copied entry: ${path}`)
    }
    if (kind === 'file' && info.nlink !== 1) throw new Error(`Aliased copied file: ${path}`)
    const entry = { path, kind, mode: info.mode & 0o777, uid: info.uid, gid: info.gid }
    if (kind === 'file') {
      entry.bytes = info.size
      entry.sha256 = createHash('sha256').update(await readFile(absolute)).digest('hex')
    } else if (kind === 'link') {
      entry.target = await readlink(absolute)
      const target = relative(root, await realpath(absolute))
      if (target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
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
    entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      ...(protectedMode ? { mode: entry.mode } : {}),
      uid: entry.uid,
      gid: entry.gid,
      ...(entry.kind === 'file' ? { bytes: entry.bytes, sha256: entry.sha256 } : {}),
      ...(entry.kind === 'link' ? { target: entry.target, resolved: entry.resolved } : {}),
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const expected = admitted.manifest.entries.map((entry) => ({
    ...entry,
    uid: owner.uid,
    gid: owner.gid,
  }))
  if (JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(expected))) {
    throw new Error('Copied consumer membership, bytes, modes or links differ from admission.')
  }
  if (!(await readFile(join(root, 'admission.json'))).equals(admitted.bytes)) {
    throw new Error('Copy admission receipt changed.')
  }
}

/**
 * Acquires each physical entry before descending, then checks the complete identity and sets final modes.
 *
 * Production always uses UID/GID zero. owner is a private test authority for real caller-owned fixtures;
 * it has no CLI/environment override and confers no permission to alter a borrowed input tree.
 * No recursive chown or DAC override is needed for a copied 0700 directory. An independent regular
 * file is checked before lchown, and aliases are never followed for ownership or permission changes.
 */
export async function admit(root, owner = { uid: 0, gid: 0 }) {
  if (![owner.uid, owner.gid].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError('Private copied ownership must use exact nonnegative IDs.')
  }
  const admitted = await receipt(root)
  const seen = new Set()
  async function acquire(path) {
    const absolute = path ? join(root, path) : root
    const info = await lstat(absolute)
    const kind = info.isDirectory()
      ? 'directory'
      : info.isFile()
      ? 'file'
      : info.isSymbolicLink()
      ? 'link'
      : 'special'
    const expected = path ? admitted.entries.get(path) : { kind: 'directory' }
    if (!expected || kind !== expected.kind || kind === 'special') {
      throw new Error(`Copied physical kind or membership differs before ownership: ${path}`)
    }
    // A hardlink would grant ownership mutation to another name, so reject before lchown.
    if (kind === 'file' && info.nlink !== 1) throw new Error(`Aliased copied file: ${path}`)
    if (kind === 'link') {
      if (await readlink(absolute) !== expected.target) {
        throw new Error(`Copied alias changed: ${path}`)
      }
      // Canonical resolution happens after directory acquisition; parent link paths are never descended.
    }
    await lchown(absolute, owner.uid, owner.gid)
    if (path) seen.add(path)
    if (kind === 'directory') {
      // Only this newly acquired private directory becomes traversable; final admission is still 0555.
      await chmod(absolute, 0o700)
      for (const name of (await readdir(absolute)).sort()) {
        if (!path && name === 'admission.json') continue
        await acquire(path ? `${path}/${name}` : name)
      }
    } else if (kind === 'file') {
      // Copied Windows files may be 0600; ownership must precede any content read.
      await chmod(absolute, 0o400)
    }
  }
  const manifestInfo = await lstat(join(root, 'admission.json'))
  if (!manifestInfo.isFile() || manifestInfo.nlink !== 1) {
    throw new Error('Private manifest cannot grant hardlink ownership.')
  }
  await lchown(join(root, 'admission.json'), owner.uid, owner.gid)
  await acquire('')
  if (seen.size !== admitted.entries.size) throw new Error('Copied membership is incomplete.')
  await verify(root, admitted, false, owner)
  // Parents are kept traversable while children take their final immutable modes.
  for (const entry of [...admitted.manifest.entries].reverse()) {
    if (entry.kind !== 'link') await chmod(join(root, entry.path), entry.mode)
  }
  await chmod(join(root, 'admission.json'), 0o444)
  await chmod(root, 0o555)
  await verify(root, admitted, true, owner)
}

/** Lane-native CLI keeps root admission and ordinary consumer authority distinct. Importing does not run it. */
async function main() {
  const root = dirname(fileURLToPath(import.meta.url))
  const failures = []
  let admitted
  try {
    const authority = await attest()
    const args = argv.slice(2)
    const admitting = args.length === 1 && args[0] === '--admit'
    if (
      !((admitting && authority.role === 'root') ||
        (args.length === 0 && authority.role === 'ordinary'))
    ) {
      throw new Error('Copied worker arguments contradict its independently attested authority.')
    }
    admitted = await receipt(root)
    if (admitting) await admit(root)
    await verify(root, admitted)
    console.log(
      `Copied consumer admission passed: ${admitted.manifest.entries.length} entries, ${admitted.manifest.archives.length} archives.`,
    )
    if (!admitting) await import('./consumer/behavior.ts')
  } catch (error) {
    failures.push(error)
  } finally {
    if (admitted) {
      try {
        await verify(root, admitted)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Copied consumer behavior or identity failed.')
  }
  console.log('Copied consumer identity remained unchanged after behavior.')
}

if (import.meta.main || (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url))) {
  await main()
}
