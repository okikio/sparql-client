/** Retains diagnostic bytes and inert filesystem observations; never admits executable inputs. @module */
import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, readdir, readlink, realpath } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'

/** One independent capture failure keeps its path, phase and original thrown value. */
export class CaptureError extends Error {
  readonly capture: { readonly path: string; readonly phase: string }
  constructor(path: string, phase: string, cause: unknown) {
    super(`Report capture failed at ${path} during ${phase}.`, { cause })
    this.name = 'CaptureError'
    this.capture = { path, phase }
  }
}

/** The separate catalog survives partial file capture and never contains live aliases. */
export interface CaptureType {
  readonly catalog: { readonly path: string; readonly sha256: string | null }
  readonly entries: number
  readonly failures: readonly unknown[]
}

/** A private I/O seam permits deterministic faults while other real files still use native reads. */
export interface ReadType {
  (path: string, file: FileHandle, bytes: Uint8Array, position: number): Promise<number>
}

/** Native object observations protect acquired paths; they are not atomic fd-relative namespace authority. */
function identity(info: BigIntStats): string {
  if (info.dev <= 0n || info.ino <= 0n) {
    throw new Error('Report capture requires observable native object identity.')
  }
  return `${info.dev}:${info.ino}:${info.uid}:${info.gid}`
}

/** Preserves non-Error and cyclic failures without converting them into successful empty observations. */
function failure(value: unknown, seen = new Set<unknown>()): unknown {
  if (!(value instanceof Error)) return { type: typeof value, value: String(value) }
  if (seen.has(value)) return { name: value.name, repeated: true }
  seen.add(value)
  return {
    name: value.name,
    message: value.message,
    ...(value instanceof CaptureError ? { capture: value.capture } : {}),
    ...(Object.hasOwn(value, 'code') ? { code: String(Reflect.get(value, 'code')) } : {}),
    ...(Object.hasOwn(value, 'cause') ? { cause: failure(value.cause, seen) } : {}),
    ...(value instanceof AggregateError
      ? { errors: Array.from(value.errors as Iterable<unknown>, (v) => failure(v, seen)) }
      : {}),
  }
}

/** Captures physical directory ancestors before any child read or destination write. */
async function ancestors(path: string): Promise<Map<string, string>> {
  const acquired = new Map<string, string>()
  for (let current = path;; current = dirname(current)) {
    const info = await lstat(current, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) {
      throw new Error('Report namespace must have physical canonical directory ancestors.')
    }
    acquired.set(current, identity(info))
    if (dirname(current) === current) return acquired
  }
}

/** Refuses observed replacement rather than borrowing a substituted directory or restoring its permissions. */
async function guard(acquired: ReadonlyMap<string, string>, path: string): Promise<void> {
  for (let current = path;; current = dirname(current)) {
    const expected = acquired.get(current)
    if (expected === undefined) {
      throw new Error('Report directory has no acquired capture authority.')
    }
    const info = await lstat(current, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink() || identity(info) !== expected) {
      throw new Error('Acquired report directory or ancestor changed.')
    }
    if (dirname(current) === current) return
  }
}

/**
 * Copies independent regular bytes, recording links and special entries only as inert catalog data.
 *
 * Destination is an exclusive new leaf under an existing physical parent. The uniquely named sibling
 * catalog cannot collide with report filenames. Source directories are visited in sorted order without
 * following aliases. Each entry and each resource retirement retains its own failure; siblings continue.
 * Native file handles check physical identity before reading and after EOF. O_NOFOLLOW is used where
 * the runtime exposes it. These observations do not promise an atomic hostile same-UID path boundary.
 * Catalog rows stream to disk; acquired directory identities, listings and retained errors use memory proportional to their count; file buffers are 64 KiB.
 * Outer release command/container deadlines own an unresponsive native filesystem's final boundary.
 */
export async function copy(
  source: string,
  destination: string,
  read: ReadType = async (_path, file, bytes, position) =>
    (await file.read(bytes, 0, bytes.length, position)).bytesRead,
): Promise<CaptureType> {
  source = resolve(source)
  destination = resolve(destination)
  const within = (from: string, to: string): boolean => {
    const name = relative(from, to)
    return name === '' || (!isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`))
  }
  if (within(source, destination) || within(destination, source)) {
    throw new Error('Diagnostic source and destination trees must be disjoint.')
  }
  const sources = await ancestors(source)
  const targets = await ancestors(dirname(destination))
  await guard(targets, dirname(destination))
  await mkdir(destination, { mode: 0o700 })
  targets.set(destination, identity(await lstat(destination, { bigint: true })))
  const catalogPath = join(dirname(destination), `report-catalog-${crypto.randomUUID()}.ndjson`)
  await guard(targets, dirname(destination))
  const catalog = await open(catalogPath, 'wx', 0o600)
  let catalogIdentity: string | undefined
  const failures: unknown[] = []
  let entries = 0
  let catalogPosition = 0
  const fault = (path: string, phase: string, reason: unknown): CaptureError => {
    const error = new CaptureError(path, phase, reason)
    failures.push(error)
    return error
  }
  async function record(value: unknown): Promise<void> {
    try {
      await guard(targets, dirname(destination))
      const info = await lstat(catalogPath, { bigint: true })
      if (!info.isFile() || info.nlink !== 1n || identity(info) !== catalogIdentity) {
        throw new Error('Acquired report catalog changed.')
      }
      const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`)
      let written = 0
      while (written < bytes.length) {
        const result = await catalog.write(bytes, written, bytes.length - written, catalogPosition)
        if (result.bytesWritten <= 0) throw new Error('Report catalog write made no progress.')
        written += result.bytesWritten
        catalogPosition += result.bytesWritten
      }
    } catch (reason) {
      fault(catalogPath, 'catalog-write', reason)
    }
  }
  try {
    catalogIdentity = identity(await catalog.stat({ bigint: true }))
    await record({
      version: 1,
      representation: 'regular-bytes-and-inert-metadata',
      source,
      destination,
    })
    const visit = async (path: string, name: string): Promise<void> => {
      let info: BigIntStats
      try {
        await guard(sources, dirname(path))
        info = await lstat(path, { bigint: true })
      } catch (reason) {
        await record({ path: name, failure: failure(fault(name, 'observe', reason)) })
        return
      }
      const kind = info.isSymbolicLink()
        ? 'link'
        : info.isDirectory()
        ? 'directory'
        : info.isFile()
        ? 'file'
        : info.isFIFO()
        ? 'fifo'
        : info.isSocket()
        ? 'socket'
        : info.isBlockDevice()
        ? 'block-device'
        : info.isCharacterDevice()
        ? 'character-device'
        : 'special'
      const observation = {
        path: name,
        kind,
        dev: String(info.dev),
        ino: String(info.ino),
        links: String(info.nlink),
        bytes: String(info.size),
        uid: Deno.build.os === 'windows' ? null : String(info.uid),
        gid: Deno.build.os === 'windows' ? null : String(info.gid),
        mode: Deno.build.os === 'windows' ? null : Number(info.mode & 0o7777n),
      }
      entries++
      const target = join(destination, name)
      if (kind === 'link') {
        try {
          // Raw link bytes are metadata, including dangling, cyclic, absolute and escaped spellings.
          // Never resolve, stat the target, or recreate a traversable link in retained diagnostics.
          // Normalize the byte view: compatibility runtimes may return Uint8Array rather than Buffer.
          const raw = await readlink(path, { encoding: 'buffer' })
          const ended = await lstat(path, { bigint: true })
          if (
            !ended.isSymbolicLink() || identity(ended) !== identity(info) ||
            ended.mtimeNs !== info.mtimeNs ||
            ended.ctimeNs !== info.ctimeNs
          ) {
            throw new Error('Report alias metadata changed during observation.')
          }
          await record({
            ...observation,
            rawTargetBase64: Buffer.from(raw).toString('base64'),
            representation: 'inert',
          })
        } catch (reason) {
          await record({ ...observation, failure: failure(fault(name, 'link-metadata', reason)) })
        }
      } else if (kind === 'directory') {
        try {
          sources.set(path, identity(info))
          await guard(sources, path)
          await guard(targets, dirname(target))
          await mkdir(target, { mode: 0o700 })
          targets.set(target, identity(await lstat(target, { bigint: true })))
          const children = (await readdir(path)).sort()
          await record(observation)
          for (const child of children) await visit(join(path, child), `${name}/${child}`)
        } catch (reason) {
          await record({ ...observation, failure: failure(fault(name, 'directory', reason)) })
        }
      } else if (kind === 'file') {
        const errors: unknown[] = []
        let input: FileHandle | undefined, output: FileHandle | undefined
        let position = 0
        let phase = 'file-position'
        let retainedBytes: string | null = null
        const hash = createHash('sha256')
        const observeOutput = async (file: FileHandle): Promise<string> => {
          const retained = await file.stat({ bigint: true })

          await guard(targets, dirname(target))
          const named = await lstat(target, { bigint: true })
          if (
            !named.isFile() || named.isSymbolicLink() || retained.nlink !== 1n ||
            identity(named) !== identity(retained)
          ) {
            throw new Error('Retained report file name or independent storage changed.')
          }
          if (errors.length === 0 && retained.size !== BigInt(position)) {
            throw new Error('Retained report extent differs from completed capture.')
          }
          return String(retained.size)
        }

        try {
          if (info.size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RangeError('Report file position is not exact.')
          }
          await guard(sources, dirname(path))
          phase = 'input-open'
          input = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          phase = 'input-admission'
          const opened = await input.stat({ bigint: true })
          if (!opened.isFile() || identity(opened) !== identity(info)) {
            throw new Error('Report file changed before read.')
          }
          await guard(targets, dirname(target))
          phase = 'output-open'
          output = await open(target, 'wx', 0o600)
          const bytes = new Uint8Array(64 * 1024)
          while (true) {
            phase = 'file-read'
            const count = await read(path, input, bytes, position)
            if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length) {
              throw new Error('Invalid native report read.')
            }
            if (!count) break
            if (BigInt(position) + BigInt(count) > info.size) {
              throw new Error('Report file exceeded its observed extent.')
            }
            let written = 0
            while (written < count) {
              phase = 'file-write'
              const result = await output.write(bytes, written, count - written, position + written)
              if (result.bytesWritten <= 0) throw new Error('Report file write made no progress.')
              written += result.bytesWritten
            }
            hash.update(bytes.subarray(0, count))
            position += count
          }
          phase = 'eof-admission'
          const ended = await input.stat({ bigint: true })
          const named = await lstat(path, { bigint: true })
          if (!named.isFile() || named.isSymbolicLink() || identity(named) !== identity(info)) {
            throw new Error('Report file name changed during capture.')
          }
          if (
            identity(ended) !== identity(info) || BigInt(position) !== info.size ||
            ended.size !== info.size ||
            ended.mtimeNs !== info.mtimeNs || ended.ctimeNs !== info.ctimeNs
          ) throw new Error('Report bytes changed during capture.')
        } catch (reason) {
          errors.push(fault(name, phase, reason))
        } finally {
          if (output) {
            try {
              retainedBytes = await observeOutput(output)
            } catch (reason) {
              errors.push(fault(name, 'output-observation', reason))
            }
          }
          for (const [phase, file] of [['input-close', input], ['output-close', output]] as const) {
            if (file) {
              try {
                await file.close()
              } catch (reason) {
                errors.push(fault(name, phase, reason))
              }
            }
          }
        }
        const completedHash = hash.digest('hex')
        await record({
          ...observation,
          completedReadBytes: position,
          retainedBytes,
          sha256: errors.length ? null : completedHash,
          ...(errors.length ? { failures: errors.map((error) => failure(error)) } : {}),
        })
      } else {
        // Opening a FIFO could hang and a device/socket could borrow unrelated I/O authority.
        await record({ ...observation, representation: 'inert' })
      }
    }
    try {
      await guard(sources, source)
      for (const child of (await readdir(source)).sort()) await visit(join(source, child), child)
    } catch (reason) {
      await record({ path: '', failure: failure(fault('', 'source-root', reason)) })
    }
    try {
      await guard(sources, source)
      await guard(targets, destination)
    } catch (reason) {
      await record({ path: '', failure: failure(fault('', 'after-identity', reason)) })
    }
    await record({
      phase: 'entries-complete',
      entries,
      failures: failures.length,
      entryState: failures.length ? 'partial' : 'complete',
    })
  } catch (reason) {
    fault('', 'capture-boundary', reason)
  } finally {
    try {
      await catalog.close()
    } catch (reason) {
      fault(catalogPath, 'catalog-close', reason)
    }
  }
  let sha256: string | null = null
  let reader: FileHandle | undefined
  try {
    await guard(targets, dirname(destination))
    reader = await open(catalogPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await reader.stat({ bigint: true })
    if (!info.isFile() || info.nlink !== 1n || identity(info) !== catalogIdentity) {
      throw new Error('Retained report catalog changed.')
    }
    const hash = createHash('sha256'), bytes = Buffer.alloc(64 * 1024)
    let position = 0
    while (true) {
      const result = await reader.read(bytes, 0, bytes.length, position)
      if (!result.bytesRead) break
      if (BigInt(position) + BigInt(result.bytesRead) > info.size) {
        throw new Error('Report catalog exceeded its observed extent.')
      }
      hash.update(bytes.subarray(0, result.bytesRead))
      position += result.bytesRead
    }
    const ended = await reader.stat({ bigint: true })
    await guard(targets, dirname(destination))
    const named = await lstat(catalogPath, { bigint: true })
    if (
      !named.isFile() || named.isSymbolicLink() || named.nlink !== 1n ||
      identity(named) !== catalogIdentity
    ) {
      throw new Error('Retained report catalog name changed.')
    }
    if (
      identity(ended) !== catalogIdentity || ended.size !== info.size ||
      BigInt(position) !== info.size ||
      ended.mtimeNs !== info.mtimeNs || ended.ctimeNs !== info.ctimeNs
    ) throw new Error('Report catalog changed during hashing.')
    sha256 = hash.digest('hex')
  } catch (reason) {
    fault(catalogPath, 'catalog-hash', reason)
  } finally {
    if (reader) {
      try {
        await reader.close()
      } catch (reason) {
        fault(catalogPath, 'catalog-reader-close', reason)
      }
    }
  }
  return { catalog: { path: catalogPath, sha256 }, entries, failures }
}
