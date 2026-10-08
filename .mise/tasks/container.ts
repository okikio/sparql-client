/** Creates verified private consumer payloads without binding maintained host paths into Docker. @module */
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FailureType, StreamType } from './command.ts'

/** A complete tree entry records physical kind and byte identity; links never grant an escaped authority. */
export interface EntryType {
  /** Relative admitted path, or the empty root path in a borrowed-input snapshot. */
  readonly path: string
  /** Physical lstat kind; aliases are recorded without following them as files. */
  readonly kind: 'directory' | 'file' | 'link'
  /** Permission bits; original host metadata may be unavailable on Windows. */
  readonly mode: number | null
  /** Original host owner, or required private-container owner zero. */
  readonly uid: number | null
  /** Original host group, or required private-container group zero. */
  readonly gid: number | null
  /** Exact regular-file length. */
  readonly bytes?: number
  /** SHA-256 of regular-file bytes. */
  readonly sha256?: string
  /** Original link spelling, or rebased relative link spelling in the copied payload. */
  readonly target?: string
  /** Canonical physical target relative to this manifest root; records link-chain authority at admission. */
  readonly resolved?: string
}

/** One invocation owns only this private staging directory; original installation and archive paths remain borrowed. */
export interface PayloadType {
  /** Unique private staging directory; never a maintained or borrowed input path. */
  readonly directory: string
  /** Full expected copied membership after private root ownership is established. */
  readonly entries: readonly EntryType[]
  /** Full original installed tree used for borrowed-input stability checks. */
  readonly inputs: readonly EntryType[]
  /** Retained exact admission receipt survives disposal of the private copied tree. */
  readonly receipt: string
  /** Independent host-admitted bootstrap hashes, checked by native Linux sha256sum before the worker loads. */
  readonly bootstrap: { readonly workerSha256: string; readonly receiptSha256: string }
  /** Records one completed or rejected CLI observation under this acquired report authority. */
  record(event: ObservationType): Promise<void>
  /** Rejects changes to original inputs, task authority, archive bytes, receipt or private copy. */
  verify(): Promise<void>
  /** Shares one retirement promise; refuses substituted root/parent authority without permission changes. Receipts survive. */
  close(): Promise<void>
}

/** Rejects special files, Git metadata and links outside the physically installed root. Owned copies also reject hardlinks. */
export async function tree(root: string, independent = false): Promise<readonly EntryType[]> {
  if ((await Deno.lstat(root)).isSymlink || !(await Deno.stat(root)).isDirectory) {
    throw new TypeError('A copied consumer needs a physical directory.')
  }
  const physical = await Deno.realPath(root)
  const entries: EntryType[] = []
  async function visit(path: string): Promise<void> {
    const absolute = join(physical, path)
    const info = await Deno.lstat(absolute)
    const mode = info.mode === null ? null : info.mode & 0o777
    if (info.isSymlink) {
      const target = await Deno.readLink(absolute)
      const resolved = relative(physical, await Deno.realPath(absolute))
      if (resolved === '..' || resolved.startsWith(`..${sep}`) || isAbsolute(resolved)) {
        throw new TypeError(`Installed link escapes its consumer: ${path}`)
      }
      entries.push({
        path,
        kind: 'link',
        mode,
        uid: info.uid,
        gid: info.gid,
        target,
        resolved: resolved.split(sep).join('/'),
      })
    } else if (info.isDirectory) {
      entries.push({ path, kind: 'directory', mode, uid: info.uid, gid: info.gid })
      for await (const entry of Deno.readDir(absolute)) {
        if (entry.name === '.git') {
          throw new TypeError(`Git metadata is not an installed payload: ${path}`)
        }
        await visit(path ? `${path}/${entry.name}` : entry.name)
      }
    } else if (info.isFile) {
      if (independent && info.nlink !== null && info.nlink !== 1) {
        throw new TypeError(`Copied file is hardlinked: ${path}`)
      }
      const bytes = await Deno.readFile(absolute)
      entries.push({
        path,
        kind: 'file',
        mode,
        uid: info.uid,
        gid: info.gid,
        bytes: bytes.length,
        sha256: digest(bytes),
      })
    } else throw new TypeError(`Special installed entry: ${path}`)
  }
  await visit('')
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/**
 * Copies exact installed bytes, selected archives and the packing receipt into an owned directory.
 *
 * Original modes remain in inputs, including unknown metadata on hosts without POSIX fields.
 * Admitted Linux files become 0444 (0555 when executable), directories 0555;
 * A bounded private bootstrap establishes root ownership, while the consumer runs as UID 1000. This protects the copied
 * payload without a host bind or a read-only rootfs, which Docker's copy API refuses to populate.
 * Host staging directories remain owner-writable so retirement needs no permission traversal.
 * temporary optionally selects a caller-owned staging parent; normal tasks use the system temporary directory.
 */
export async function prepare(
  installed: string,
  archives: readonly string[],
  receipt = '.tmp/packages/artifacts.json',
  authority: readonly URL[] = [],
  reportBase = '.tmp/reports/consumer-copy',
  temporary?: string,
): Promise<PayloadType> {
  const source = resolve(installed)
  const inputs = await tree(source)
  const selected = await Promise.all(archives.map(async (path) => {
    const info = await Deno.lstat(path)
    if (!info.isFile || info.isSymlink) {
      throw new TypeError(`Archive must be a regular file: ${path}`)
    }
    const bytes = await Deno.readFile(path)
    return { path: resolve(path), bytes, sha256: digest(bytes) }
  }))
  const receiptBytes = await Deno.readFile(receipt)
  const taskInputs = await Promise.all([
    new URL('./container.ts', import.meta.url),
    new URL('./container-worker.mjs', import.meta.url),
    new URL('./command.ts', import.meta.url),
    ...authority,
  ].map(async (url) => ({ path: fileURLToPath(url), sha256: digest(await Deno.readFile(url)) })))
  const directory = await Deno.makeTempDir({
    prefix: 'rdf-container-copy-',
    ...(temporary === undefined ? {} : { dir: temporary }),
  })
  let ownership: OwnershipType | undefined
  const errors: unknown[] = []
  try {
    ownership = await acquire(directory)
    await Deno.mkdir(join(directory, 'consumer'))
    for (const entry of inputs) {
      if (entry.path === '') continue
      const target = join(directory, 'consumer', entry.path)
      if (entry.kind === 'directory') await Deno.mkdir(target, { recursive: true })
      else if (entry.kind === 'file') {
        await Deno.copyFile(join(source, entry.path), target)
        if (Deno.build.os === 'windows') {
          // copyFile inherits Windows readonly attributes; clear them only on this newly acquired copy.
          await Deno.chmod(target, 0o600)
        } else {
          await Deno.chmod(
            target,
            entry.mode !== null && (entry.mode & 0o111) !== 0 ? 0o555 : 0o444,
          )
        }
      } else {
        // Absolute contained aliases become relative to the owned copied tree, never to the host.
        const resolved = join(source, entry.resolved!)
        const targetPath = relative(dirname(join(source, entry.path)), resolved).split(sep).join(
          '/',
        )
        await Deno.symlink(targetPath, target)
      }
    }
    await Deno.mkdir(join(directory, 'archives'))
    for (let index = 0; index < selected.length; index++) {
      await Deno.writeFile(join(directory, 'archives', `${index}.tgz`), selected[index]!.bytes, {
        mode: 0o444,
      })
    }
    await Deno.writeFile(join(directory, 'archives', 'artifacts.json'), receiptBytes, {
      mode: 0o444,
    })
    await Deno.copyFile(
      fileURLToPath(new URL('./container-worker.mjs', import.meta.url)),
      join(directory, 'worker.mjs'),
    )
    // The worker is also a copyFile target, so its inherited Windows readonly attribute must not survive.
    await Deno.chmod(join(directory, 'worker.mjs'), Deno.build.os === 'windows' ? 0o600 : 0o444)
    // Host-private directories stay owner-writable for removal without a chmod traversal.
    // The separate Linux bootstrap still establishes admitted directories as 0555.
    await admit(ownership)
    const copied = (await tree(directory, true)).filter((entry) => entry.path !== '')
    // Compare the completed copy with the original admission, not a newly derived candidate oracle.
    // A source edit restored before verify() must not bless mixed copied bytes or a different link target.
    const byPath = new Map(copied.map((entry) => [entry.path, entry]))
    if (
      copied.filter((entry) => entry.path === 'consumer' || entry.path.startsWith('consumer/'))
        .length !== inputs.length
    ) {
      throw new Error('Copied consumer membership differs from its original admission.')
    }
    for (const input of inputs) {
      const actual = byPath.get(input.path ? `consumer/${input.path}` : 'consumer')
      if (!actual || actual.kind !== input.kind) {
        throw new Error(`Copied consumer kind differs: ${input.path}`)
      }
      if (
        input.kind === 'file' && (actual.bytes !== input.bytes || actual.sha256 !== input.sha256)
      ) {
        throw new Error(`Copied consumer bytes differ from admission: ${input.path}`)
      }
      if (
        input.kind === 'link' &&
        actual.resolved !== (input.resolved ? `consumer/${input.resolved}` : 'consumer')
      ) {
        throw new Error(`Copied consumer target differs from admission: ${input.path}`)
      }
    }
    for (let index = 0; index < selected.length; index++) {
      const actual = byPath.get(`archives/${index}.tgz`)
      const expected = selected[index]!
      if (actual?.sha256 !== expected.sha256 || actual.bytes !== expected.bytes.length) {
        throw new Error('Copied archive bytes differ from original admission.')
      }
    }
    if (byPath.get('archives/artifacts.json')?.sha256 !== digest(receiptBytes)) {
      throw new Error('Copied packing receipt differs.')
    }
    const worker = taskInputs.find((input) =>
      input.path === fileURLToPath(new URL('./container-worker.mjs', import.meta.url))
    )!
    if (byPath.get('worker.mjs')?.sha256 !== worker.sha256) {
      throw new Error('Copied worker differs from original admission.')
    }
    const inputByPath = new Map(inputs.map((input) => [`consumer/${input.path}`, input]))
    const entries = copied.map((entry) => {
      const input = entry.path.startsWith('consumer/') ? inputByPath.get(entry.path) : undefined
      const executable = entry.kind === 'file' && input?.mode !== null &&
        input?.mode !== undefined && (input.mode & 0o111) !== 0
      return {
        ...entry,
        mode: entry.kind === 'directory'
          ? 0o555
          : entry.kind === 'link'
          ? 0o777
          : executable
          ? 0o555
          : 0o444,
        uid: 0,
        gid: 0,
      }
    })
    const manifest = {
      version: 1,
      entries,
      original: inputs,
      taskInputs,
      archives: selected.map(({ path, sha256 }) => ({ path, sha256 })),
      retirement: {
        identity: 'positive-safe-integer device/inode observations; zero or unavailable is unknown',
        limitation:
          'Path admission is not fd-relative; a copied nonce cannot distinguish an otherwise unobservable replacement.',
        canonicalRoot: ownership.canonical,
        canonicalParent: ownership.canonicalParent,
        root: {
          dev: ownership.root.dev,
          ino: ownership.root.ino,
          uid: ownership.root.uid,
          gid: ownership.root.gid,
        },
        parent: {
          dev: ownership.ancestor.dev,
          ino: ownership.ancestor.ino,
          uid: ownership.ancestor.uid,
          gid: ownership.ancestor.gid,
        },
        hostDirectories: 'owner-writable',
      },
    }
    const admitted = `${JSON.stringify(manifest)}\n`
    await admit(ownership)
    await Deno.writeTextFile(join(directory, 'admission.json'), admitted, { mode: 0o444 })
    await Deno.mkdir(reportBase, { recursive: true })
    const report = await Deno.makeTempDir({
      dir: reportBase,
      prefix: `${new Date().toISOString().replaceAll(':', '-')}-`,
    })
    const reportOwner = await acquire(report)
    await admit(reportOwner)
    const reportAuthority = `${
      JSON.stringify({
        canonicalRoot: reportOwner.canonical,
        canonicalParent: reportOwner.canonicalParent,
        root: reportOwner.root,
        parent: reportOwner.ancestor,
        identity: 'positive-safe-integer device/inode; zero/null unknown',
        limitation: 'not fd-relative; copied nonce is not unobservable object identity',
      })
    }\n`
    const authorityPath = join(report, 'ownership-authority.json')
    await Deno.writeTextFile(authorityPath, reportAuthority, { createNew: true })
    const authorityInfo = physical(await Deno.lstat(authorityPath))
    const retained = join(report, 'admission.json')
    await admit(reportOwner)
    await Deno.writeTextFile(retained, admitted, { createNew: true })
    const retainedInfo = physical(await Deno.lstat(retained))
    const privateInfo = physical(await Deno.lstat(join(directory, 'admission.json')))
    console.log(`Retained copied-consumer admission: ${retained}`)
    let closing: Promise<void> | undefined
    let sequence = 0
    const verify = async (): Promise<void> => {
      await admit(ownership!)
      await admit(reportOwner)
      await regular(retained, retainedInfo)
      await regular(authorityPath, authorityInfo)
      if (await Deno.readTextFile(authorityPath) !== reportAuthority) {
        throw new Error('Retained report ownership authority changed.')
      }
      await regular(join(directory, 'admission.json'), privateInfo)
      for (const input of taskInputs) {
        if (digest(await Deno.readFile(input.path)) !== input.sha256) {
          throw new Error(`Copy task authority changed: ${input.path}`)
        }
      }
      await admit(reportOwner)
      await regular(retained, retainedInfo)
      if (await Deno.readTextFile(retained) !== admitted) {
        throw new Error('Retained copy admission receipt changed.')
      }
      await admit(ownership!)
      await regular(join(directory, 'admission.json'), privateInfo)
      if (await Deno.readTextFile(join(directory, 'admission.json')) !== admitted) {
        throw new Error('Private copy admission receipt changed.')
      }
      if (JSON.stringify(await tree(source)) !== JSON.stringify(inputs)) {
        throw new Error('Original installed consumer changed during Linux validation.')
      }
      for (const archive of selected) {
        if (digest(await Deno.readFile(archive.path)) !== archive.sha256) {
          throw new Error(`Borrowed archive changed: ${archive.path}`)
        }
      }
      if (digest(await Deno.readFile(receipt)) !== digest(receiptBytes)) {
        throw new Error('Borrowed archive receipt changed.')
      }
      await admit(ownership!)
      const actual = (await tree(directory, true)).filter((entry) =>
        entry.path !== '' && entry.path !== 'admission.json'
      )
      if (JSON.stringify(actual) !== JSON.stringify(copied)) {
        throw new Error('Private copy changed before or after container acquisition.')
      }
      await admit(ownership!)
      await admit(reportOwner)
    }
    await verify()
    return {
      directory,
      inputs,
      entries,
      receipt: retained,
      bootstrap: {
        workerSha256: worker.sha256,
        receiptSha256: digest(new TextEncoder().encode(admitted)),
      },
      record: async (event) => {
        await admit(reportOwner)
        const output = event.output
        const target = join(report, `cli-${String(++sequence).padStart(3, '0')}`)
        await Deno.mkdir(target)
        await admit(reportOwner)
        const targetOwner = await acquire(target)
        const errors: unknown[] = []
        const streams: Record<string, unknown> = {}
        for (const stream of ['stdout', 'stderr'] as const) {
          if (!output) continue
          const raw = output.streams?.[stream]
          const bytes = raw?.bytes ?? new TextEncoder().encode(output[stream])
          const quota = 32 * 1024 * 1024
          let saved = false
          try {
            if (bytes.byteLength > quota) {
              throw new RangeError('CLI evidence exceeds diagnostic admission.')
            }
            await admit(reportOwner)
            await admit(targetOwner)
            await Deno.writeFile(join(target, `${stream}.bin`), bytes, { createNew: true })
            saved = true
          } catch (error) {
            errors.push(error)
          }
          streams[stream] = {
            file: `${stream}.bin`,
            saved,
            bytes: bytes.byteLength,
            sha256: digest(bytes),
            quotaBytes: raw?.quotaBytes ?? quota,
            observedBytes: raw?.observedBytes ?? bytes.byteLength,
            complete: raw?.complete ?? null,
          }
        }
        try {
          await admit(reportOwner)
          await admit(targetOwner)
          await Deno.writeTextFile(
            join(target, 'observation.json'),
            `${
              JSON.stringify({
                command: event.command,
                timeoutMs: event.timeoutMs,
                outcome: event.outcome,
                ...(output
                  ? {
                    code: output.code,
                    signal: output.signal ?? null,
                    success: output.success,
                    streams,
                    captureFailures: output.failures?.map((item) => ({
                      ...item,
                      reason: observation(item.reason),
                    })) ?? [],
                  }
                  : { reason: observation(event.reason) }),
                evidenceFailures: errors.map((error) => observation(error)),
              })
            }\n`,
            { createNew: true },
          )
        } catch (error) {
          errors.push(error)
        }
        try {
          await admit(reportOwner)
          await admit(targetOwner)
        } catch (error) {
          errors.push(error)
        }
        if (errors.length) throw new AggregateError(errors, 'Owned CLI evidence retention failed.')
      },
      verify,
      close: () => closing ??= remove(ownership!),
    }
  } catch (error) {
    errors.push(error)
  }
  try {
    await remove(ownership)
  } catch (error) {
    errors.push(error)
  }
  throw new AggregateError(
    errors,
    `Private consumer copy acquisition failed; location ${directory}.`,
  )
}

/** Exact numeric observations; zero device/inode values mean unavailable identity, not a strong match. */
interface PhysicalType {
  readonly dev: number | null
  readonly ino: number | null
  readonly uid: number | null
  readonly gid: number | null
}

/** Rejects rounded/invalid identities instead of silently treating them as exact native observations. */
function physical(info: Deno.FileInfo): PhysicalType {
  const value = (number: number | null, positive: boolean): number | null => {
    if (number === null || positive && number === 0) return null
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new RangeError('Filesystem identity must be an exact nonnegative safe integer.')
    }
    return number
  }
  return {
    dev: value(info.dev, true),
    ino: value(info.ino, true),
    uid: value(info.uid, false),
    gid: value(info.gid, false),
  }
}

/** Only captured observable fields participate; unknown fields remain an explicit weaker boundary. */
function same(actual: PhysicalType, expected: PhysicalType): boolean {
  return (expected.dev === null || actual.dev === expected.dev) &&
    (expected.ino === null || actual.ino === expected.ino) &&
    (expected.uid === null || actual.uid === expected.uid) &&
    (expected.gid === null || actual.gid === expected.gid)
}

/** The created root and its parent retain physical identity independently of mutable payload membership. */
interface OwnershipType {
  readonly path: string
  readonly canonical: string
  readonly parent: string
  readonly canonicalParent: string
  readonly root: PhysicalType
  readonly ancestor: PhysicalType
  readonly marker: PhysicalType
  readonly token: string
}

/** Acquires canonical identity and a private nonce before later operations can grant read/write or retirement authority. */
async function acquire(path: string): Promise<OwnershipType> {
  const info = await Deno.lstat(path)
  const canonical = await Deno.realPath(path)
  const parent = dirname(path)
  const canonicalParent = await Deno.realPath(parent)
  const ancestor = await Deno.lstat(canonicalParent)
  if (!info.isDirectory || info.isSymlink || !ancestor.isDirectory || ancestor.isSymlink) {
    throw new TypeError('Private payload root and canonical parent must be physical directories.')
  }
  const root = physical(info), parentInfo = physical(ancestor)
  const token = crypto.randomUUID()
  await Deno.writeTextFile(join(path, 'ownership.json'), token, { createNew: true, mode: 0o444 })
  const marker = physical(await Deno.lstat(join(path, 'ownership.json')))
  const owner = {
    path,
    canonical,
    parent,
    canonicalParent,
    root,
    ancestor: parentInfo,
    marker,
    token,
  }
  await admit(owner)
  return owner
}

/** Refuses alias/kind and observable physical substitutions before reading a retained regular file. */
async function regular(path: string, expected: PhysicalType): Promise<void> {
  const info = await Deno.lstat(path)
  if (!info.isFile || info.isSymlink || !same(physical(info), expected)) {
    throw new Error('Private retained file authority changed.')
  }
}

/**
 * Admits an acquired physical root and parent before private reads, writes, copying or removal.
 *
 * Available positive safe-integer device/inode values retain object identity. Zero/unavailable values
 * are explicitly unknown; a nonce rejects ordinary unrelated substitution but cannot distinguish a
 * replacement carrying an identical copied nonce when object identity is unavailable. Path checks
 * are not fd-relative protection against hostile concurrent mutation between admission and use.
 */
async function admit(owner: OwnershipType): Promise<void> {
  async function boundary(): Promise<void> {
    if (await Deno.realPath(owner.parent) !== owner.canonicalParent) {
      throw new Error('Private payload parent canonical authority changed.')
    }
    const parent = await Deno.lstat(owner.canonicalParent)
    const root = await Deno.lstat(owner.path)
    if (
      !parent.isDirectory || parent.isSymlink || !root.isDirectory || root.isSymlink ||
      !same(physical(parent), owner.ancestor) || !same(physical(root), owner.root) ||
      await Deno.realPath(owner.path) !== owner.canonical
    ) {
      throw new Error('Private payload physical root or parent identity changed.')
    }
  }
  await boundary()
  const markerPath = join(owner.path, 'ownership.json')
  const marker = await Deno.lstat(markerPath)
  if (
    !marker.isFile || marker.isSymlink || marker.size !== owner.token.length ||
    !same(physical(marker), owner.marker)
  ) {
    throw new Error('Private payload ownership marker identity changed.')
  }
  if (await token(markerPath, owner.token.length) !== owner.token) {
    throw new Error('Private payload ownership nonce changed.')
  }
  await boundary()
}

/**
 * Removes only an admitted physical root. No chmod/readDir traversal grants authority to a substitute.
 * Refusal leaves the acquired original for investigation; retained evidence roots are never removed here.
 */
async function remove(owner: OwnershipType | undefined): Promise<void> {
  if (!owner) throw new Error('Private payload retirement has no acquired physical identity.')
  await admit(owner)
  await Deno.remove(owner.canonical, { recursive: true })
}

/** Reads only the admitted nonce bytes and one EOF byte; read failure never hides file-close failure. */
async function token(path: string, size: number): Promise<string> {
  const file = await Deno.open(path, { read: true })
  const errors: unknown[] = []
  const bytes = new Uint8Array(size)
  let value!: string
  try {
    let offset = 0
    while (offset < size) {
      const count = await file.read(bytes.subarray(offset))
      if (count === null || count < 1) {
        throw new Error('Private payload nonce ended before admission.')
      }
      offset += count
    }
    if (await file.read(new Uint8Array(1)) !== null) {
      throw new Error('Private payload nonce exceeds admission.')
    }
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      file.close()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Private payload nonce read or retirement failed.')
  }
  return value
}

/** Hashes actual bytes without relying on archive filenames or JSON ordering. */
function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Structured command output distinguishes an actual exit from partial diagnostics at a deadline. */
export interface OutputType {
  /** Null when no command exit was observed before its operational deadline. */
  readonly code: number | null
  /** True only for an observed successful CLI exit. */
  readonly success: boolean
  /** Complete or partial command stdout, retained independently of status. */
  readonly stdout: string
  /** Complete or partial command stderr, retained independently of status. */
  readonly stderr: string
  /** Observed signal when the native collector supplied process status. */
  readonly signal?: string | null
  /** Exact finite raw pipe observations from the native collector. */
  readonly streams?: { readonly stdout: StreamType; readonly stderr: StreamType }
  /** Capture faults remain distinct from the actual observed process exit. */
  readonly failures?: readonly FailureType[]
}

/** Recording authority belongs to the acquired payload, including on unsuccessful or unresolved CLI outcomes. */
export interface ObservationType {
  /** Exact executable and direct arguments; no shell interpretation. */
  readonly command: readonly string[]
  /** Operational deadline declared by the caller. */
  readonly timeoutMs: number
  /** A complete collector result or its original rejection. */
  readonly outcome: 'complete' | 'rejected'
  /** Actual collector observations when it returned. */
  readonly output?: OutputType
  /** Original rejection, including undefined/null, when it did not return. */
  readonly reason?: unknown
}

/** Callers retain their bounded command collector; daemon lifetimes remain owned by the exact name. */
export type InvokeType = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<OutputType>

/**
 * Copies into one stopped container, validates with the actual runtime, and attempts exact cleanup on every outcome.
 * No Docker host path is mounted. Copy and log commands have separate operational deadlines outside all benchmarks.
 */
export async function run(
  payload: PayloadType,
  image: string,
  command: readonly string[],
  invoke: InvokeType,
): Promise<void> {
  const name = `rdf-packed-copy-${crypto.randomUUID()}`
  const failures: unknown[] = []
  const marker = `/tmp/admitted-${crypto.randomUUID()}`
  let created = false
  try {
    await payload.verify()
    await checked([
      'create',
      '--name',
      name,
      '--init',
      '--user',
      '1000:1000',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'CHOWN',
      '--security-opt',
      'no-new-privileges',
      '--network',
      'none',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,mode=1777',
      '-e',
      'HOME=/tmp',
      '-e',
      'DENO_DIR=/tmp/deno',
      '-e',
      'XDG_CACHE_HOME=/tmp/cache',
      '-w',
      '/tmp',
      '--entrypoint',
      '/bin/sh',
      image,
      '-c',
      'while [ ! -f "$1" ]; do sleep 0.1; done; shift; cd /work/consumer || exit; exec "$@"',
      '--',
      marker,
      ...command,
    ], 30_000)
    created = true
    await payload.verify()
    await checked(['cp', `${payload.directory}/.`, `${name}:/work`], 120_000)
    await payload.verify()
    await checked(['start', name], 30_000)
    // CHOWN does not bypass traversal permissions: acquire the physical root before loading its worker.
    await checked([
      'exec',
      '--user',
      '0:0',
      name,
      '/bin/sh',
      '-c',
      'test -d /work && test ! -L /work && chown -h 0:0 /work',
    ], 30_000)
    await checked([
      'exec',
      '--user',
      '0:0',
      name,
      '/bin/sh',
      '-c',
      'for path in /work/worker.mjs /work/admission.json; do test -f "$path" && test ! -L "$path" && test "$(stat -c %h "$path")" = 1 && chown -h 0:0 "$path" || exit 1; done',
    ], 30_000)
    // The worker cannot serve as its own transport oracle: compare both bootstrap byte hashes first.
    const bootstrap = await checked([
      'exec',
      '--user',
      '0:0',
      name,
      'sha256sum',
      '/work/worker.mjs',
      '/work/admission.json',
    ], 30_000)
    const expected =
      `${payload.bootstrap.workerSha256}  /work/worker.mjs\n${payload.bootstrap.receiptSha256}  /work/admission.json`
    if (bootstrap.stdout.trimEnd() !== expected) {
      throw new Error('Copied bootstrap bytes differ from independently admitted host hashes.', {
        cause: { bootstrap, expected },
      })
    }
    const admission = command[0] === 'deno'
      ? [...command.slice(0, -1), '--allow-write=/work', '/work/worker.mjs', '--admit']
      : [...command.slice(0, -1), '/work/worker.mjs', '--admit']
    await checked(
      ['exec', '--user', '0:0', '--workdir', '/work', name, ...admission],
      120_000,
    )
    await checked(['exec', '--user', '0:0', name, 'touch', marker], 30_000)
    const output = await checked(['wait', name], 180_000)
    if (output.stdout.trim() !== '0') {
      throw new Error(`Copied packed consumer ${image} reported exit ${output.stdout.trim()}.`, {
        cause: { container: name, output },
      })
    }
  } catch (error) {
    failures.push(error)
  } finally {
    if (created) {
      try {
        const output = await checked(['logs', name], 15_000)
        if (output.stdout) console.log(output.stdout.trimEnd())
        if (output.stderr) console.error(output.stderr.trimEnd())
      } catch (error) {
        failures.push(error)
      }
    }
    // Even a create CLI timeout can leave daemon state. Always remove this exact owned UUID.
    try {
      await checked(['rm', '--force', '--volumes', name], 30_000)
    } catch (error) {
      failures.push(error)
    }
    try {
      await payload.verify()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, `Copied consumer failed in ${image}, owned ${name}.`)
  }

  async function checked(args: readonly string[], timeoutMs: number): Promise<OutputType> {
    let output: OutputType | undefined
    let reason: unknown
    let rejected = false
    const errors: unknown[] = []
    try {
      output = await invoke('docker', args, timeoutMs)
    } catch (error) {
      rejected = true
      reason = error
      errors.push(error)
    }
    if (output && !output.success) {
      errors.push(
        new Error(`Docker ${args[0]} failed for owned ${name}.`, {
          cause: { output, command: args },
        }),
      )
    }
    if (args[0] === 'create' && (output?.success || output?.code === 0)) created = true
    try {
      await payload.record({
        command: ['docker', ...args],
        timeoutMs,
        ...(rejected ? { outcome: 'rejected', reason } : { outcome: 'complete', output: output! }),
      })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) {
      throw new AggregateError(errors, `Docker ${args[0]} or owned evidence failed.`)
    }
    return output!
  }
}

/** Bounded diagnostics preserve structured causes without invoking getters or replacing objects with a generic string. */
function observation(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget = { left: 512 },
): unknown {
  if (--budget.left < 0) return { kind: 'bounded-reference' }
  if (value === undefined) return { kind: 'undefined' }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { kind: 'number', value: String(value) }
  }
  if (typeof value === 'string') {
    return value.length > 8192 ? { text: value.slice(0, 8192), truncated: true } : value
  }
  if (typeof value !== 'object') return { kind: typeof value, value: String(value) }
  if (seen.has(value) || depth > 8) return { kind: 'bounded-reference' }
  seen.add(value)
  if (ArrayBuffer.isView(value)) return { kind: 'binary', bytes: value.byteLength }
  if (value instanceof ArrayBuffer) return { kind: 'binary', bytes: value.byteLength }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      entries: value.slice(0, 32).map((item) => observation(item, depth + 1, seen, budget)),
      ...(value.length > 32 ? { truncated: true } : {}),
    }
  }
  const result: Record<string, unknown> = {}
  const keys = [
    ...new Set([
      ...(value instanceof Error ? ['name', 'message', 'stack', 'cause', 'errors'] : []),
      ...Object.keys(value),
    ]),
  ]
  for (const key of keys.slice(0, 32)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor) {
      result[key] = 'value' in descriptor
        ? observation(descriptor.value, depth + 1, seen, budget)
        : { kind: 'accessor' }
    } else if (key === 'name' && value instanceof Error) {
      const name = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), 'name')
      result.name = name && 'value' in name && typeof name.value === 'string' ? name.value : 'Error'
    }
  }
  if (keys.length > 32) result.truncated = true
  return result
}
