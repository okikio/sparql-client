/** Fresh-process storage measurements through installed npm artifacts. @module */
import assert from 'node:assert/strict'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { argv, versions } from 'node:process'
import { fileURLToPath } from 'node:url'
import type { FileSystemType } from '@okikio/triplestore'

/** Only the child owns its concrete filesystem; the store borrows it. */
interface StorageType extends FileSystemType {
  /** Reads exact bytes, including bounded ranges used by the independent oracle. */
  readFile(path: string, options?: { at?: number; length?: number }): Promise<Uint8Array>
  /** Ends this child's filesystem operations without closing unrelated resources. */
  close(): Promise<void>
}

/** This fixture intentionally resolves runtime imports from the installed consumer. */
const storagePackage = '@okikio/opfs'
const rdfPackage = '@okikio/rdf'
const parsePackage = '@okikio/rdf/nquads'
const storePackage = '@okikio/triplestore'
/** Each native runtime reopens the same portable on-disk fixture through its own adapter. */
const runtime = 'Deno' in globalThis ? 'deno' : 'Bun' in globalThis ? 'bun' : 'node'
const nativePackage = `@okikio/opfs/adapter/${runtime}`
const factoryName = runtime === 'deno'
  ? 'createDenoAdapter'
  : runtime === 'bun'
  ? 'createBunAdapter'
  : 'createNodeAdapter'
const [mode, root] = argv.slice(2)
if (!root || !['prepare', 'sample'].includes(mode ?? '')) {
  throw new Error('Expected cold.ts prepare|sample ABSOLUTE_FIXTURE_DIRECTORY.')
}

/** Fixed bytes include zeroes and non-ASCII octets; the trailing range spans the final seven bytes. */
const expectedBytes = Uint8Array.from({ length: 65_537 }, (_, index) => (index * 37 + 11) % 256)
/** One compacted snapshot plus one newer delta exercises actual recovery rather than a new empty store. */
const text = Array.from(
  { length: 65 },
  (_, index) => `<urn:cold:${index}> <urn:p> "value ${index} 雪 😀"@ja <urn:g> .`,
).join('\n')
/** Fixture construction and deterministic expected values are outside the import/open/read timers. */
const childStart = performance.now()
const importStart = performance.now()
const storage: {
  createFileSystem(adapter: unknown, options: { coordination: 'local' }): StorageType
} = await import(storagePackage)
const native: Record<string, (options: { root: string }) => unknown> = await import(nativePackage)
const opfsImportMs = performance.now() - importStart
const adapter = native[factoryName]
assert.equal(typeof adapter, 'function')
if (mode === 'prepare') await mkdir(root, { recursive: true })

const initStart = performance.now()
let fs: StorageType | undefined = storage.createFileSystem(adapter!({ root }), {
  coordination: 'local',
})
const opfsInitMs = performance.now() - initStart
let store: Awaited<ReturnType<typeof import('@okikio/triplestore').open>> | undefined
/** Membership retains even an undefined failure while both owned releases are attempted. */
const failures: unknown[] = []
try {
  if (mode === 'prepare') await fs.writeFile('/bytes.bin', expectedBytes)
  const readStart = performance.now()
  const bytes = await fs.readFile('/bytes.bin')
  const range = await fs.readFile('/bytes.bin', { at: 65_530, length: 7 })
  const opfsReadMs = performance.now() - readStart
  assert.deepEqual(bytes, expectedBytes)
  assert.deepEqual(range, expectedBytes.slice(65_530))
  const closeStart = performance.now()
  await fs.close()
  fs = undefined
  const opfsCloseMs = performance.now() - closeStart

  const storeImportStart = performance.now()
  const triple: typeof import('@okikio/triplestore') = await import(storePackage)
  const rdf: typeof import('@okikio/rdf') = await import(rdfPackage)
  const storeImportMs = performance.now() - storeImportStart
  const expected = Array.from({ length: 65 }, (_, index) =>
    rdf.quad(
      rdf.namedNode(`urn:cold:${index}`),
      rdf.namedNode('urn:p'),
      rdf.literal(`value ${index} 雪 😀`, 'ja'),
      rdf.namedNode('urn:g'),
    ))
  const added = rdf.quad(
    rdf.namedNode('urn:cold:added'),
    rdf.namedNode('urn:p'),
    rdf.literal('after snapshot 零 😀', 'zh'),
    rdf.namedNode('urn:g'),
  )
  const storeFsStart = performance.now()
  fs = storage.createFileSystem(adapter!({ root }), { coordination: 'local' })
  const storeFsInitMs = performance.now() - storeFsStart
  const recoveryStart = performance.now()
  store = await triple.open(fs)
  const storeRecoveryMs = performance.now() - recoveryStart
  if (mode === 'prepare') {
    const nquads: typeof import('@okikio/rdf/nquads') = await import(parsePackage)
    await store.import(nquads.parse(text), { batchSize: 16 })
    assert.equal(store.generation, 5)
    await store.delete(expected[17]!)
    await store.compact()
    await store.add(added)
  }
  expected.splice(17, 1)
  expected.push(added)
  const verifyStart = performance.now()
  assert.equal(store.size, 65)
  assert.equal(store.generation, 8)
  assert.deepEqual([...store.snapshot()].map(rdf.key).sort(), expected.map(rdf.key).sort())
  const storeVerifyMs = performance.now() - verifyStart
  const storeCloseStart = performance.now()
  await store.close()
  store = undefined
  const storeCloseMs = performance.now() - storeCloseStart
  // Store closure leaves the borrowed filesystem usable; this is an assertion, not a timing shortcut.
  assert.deepEqual(await fs.readFile('/bytes.bin', { at: 65_530, length: 7 }), range)
  const fsCloseStart = performance.now()
  await fs.close()
  fs = undefined
  const storeFsCloseMs = performance.now() - fsCloseStart
  // Check provenance after measured imports so this cannot warm their resolver caches.
  const modules = await installed([
    storagePackage,
    nativePackage,
    rdfPackage,
    parsePackage,
    storePackage,
    '@okikio/sparql',
    '@okikio/comunica',
    '@okikio/oxigraph',
    '@okikio/vocab',
  ])
  console.log(JSON.stringify({
    mode,
    runtime,
    versions,
    modules,
    oracle: { bytes: 65_537, rangeBytes: 7, quads: 65, generation: 8, borrowedFsUsable: true },
    timings: {
      opfsImportMs,
      opfsInitMs,
      opfsReadMs,
      opfsCloseMs,
      storeImportMs,
      storeFsInitMs,
      storeRecoveryMs,
      storeVerifyMs,
      storeCloseMs,
      storeFsCloseMs,
      childTotalMs: performance.now() - childStart,
    },
  }))
} catch (error) {
  failures.push(error)
} finally {
  for (const close of [() => store?.close(), () => fs?.close()]) {
    try {
      await close()
    } catch (error) {
      failures.push(error)
    }
  }
}
if (failures.length) throw new AggregateError(failures, 'Packed cold consumer failed.')

/** Bare imports must resolve within this consumer's installed dependency tree, including symlink targets. */
async function installed(specifiers: readonly string[]): Promise<Readonly<Record<string, string>>> {
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), 'node_modules'))
  const result: Record<string, string> = {}
  for (const specifier of specifiers) {
    const url = import.meta.resolve(specifier)
    assert(url.startsWith('file:'), `${specifier}: expected an installed file URL, got ${url}`)
    const path = await realpath(fileURLToPath(url))
    const within = relative(root, path)
    assert(
      within !== '' && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within),
      `${specifier}: resolved outside the installed consumer: ${path}`,
    )
    result[specifier] = path
  }
  return result
}
