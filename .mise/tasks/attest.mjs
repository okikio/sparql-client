/** Known-byte workers wait for independent native post-exec attestation before library work. @module */
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { argv, pid } from 'node:process'
import { Buffer } from 'node:buffer'
import { setTimeout } from 'node:timers/promises'

/** Checks physical private gate entries without touching protected proc files or system-info APIs. */
export async function attest() {
  const [flag, directory, nonce, role] = argv.slice(-4)
  if (
    flag !== '--attest' || !/^\/tmp\/library-attest-[a-f0-9-]{36}$/u.test(directory ?? '') ||
    !/^[a-f0-9-]{36}$/u.test(nonce ?? '') || !['root', 'ordinary'].includes(role)
  ) {
    throw new Error('A supervised worker requires its exact acquired attestation gate.')
  }
  const owner = role === 'root' ? 0 : 1000
  const info = await lstat(directory)
  if (
    !info.isDirectory() || info.isSymbolicLink() || info.uid !== owner || info.gid !== owner ||
    (info.mode & 0o777) !== 0o700 || await realpath(directory) !== directory
  ) {
    throw new Error('Attestation gate is not the physical namespace of this runtime authority.')
  }
  await physical(directory, info, owner)
  const ready = join(directory, 'ready.pending')
  await writeFile(ready, `${pid} ${nonce}\n`, { flag: 'wx', mode: 0o600 })
  await rename(ready, join(directory, 'ready'))
  const deadline = performance.now() + 35_000
  while (true) {
    try {
      await approval(directory, info, { pid, nonce, role, uid: owner, gid: owner })
      argv.splice(-4)
      return { pid, nonce, role }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      if (performance.now() >= deadline) {
        throw new Error('Native attestation approval was not observed.')
      }
      await setTimeout(50)
    }
  }
}

/** Private gate admission is independently testable with real caller-owned files; normal roles still fix IDs. */
export async function approval(directory, identity, expected) {
  await physical(directory, identity, expected.uid, expected.gid)
  const path = join(directory, 'approval')
  const gate = await lstat(path)
  const bytes = `${expected.pid} ${expected.nonce} ${expected.role}\n`
  if (
    !gate.isFile() || gate.nlink !== 1 || gate.uid !== expected.uid || gate.gid !== expected.gid ||
    (gate.mode & 0o777) !== 0o400 || gate.size !== Buffer.byteLength(bytes)
  ) {
    throw new Error('Attestation approval is not the exact owned bounded regular file.')
  }
  if (await readFile(path, 'utf8') !== bytes) {
    throw new Error('Attestation approval identifies another runtime.')
  }
}

/** Rechecks the acquired physical root before reading any approval, without following substituted aliases. */
async function physical(directory, identity, uid, gid = uid) {
  const info = await lstat(directory)
  if (
    ![identity.dev, identity.ino].every((value) => Number.isSafeInteger(value) && value > 0) ||
    !info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev ||
    info.ino !== identity.ino ||
    info.uid !== uid || info.gid !== gid || (info.mode & 0o777) !== 0o700 ||
    await realpath(directory) !== directory
  ) {
    throw new Error('Acquired attestation namespace changed.')
  }
}
