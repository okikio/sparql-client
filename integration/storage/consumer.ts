/** Reopens RDF state through the actual OPFS and triplestore npm artifacts. @module */
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { key, literal, namedNode, quad } from '@okikio/rdf'
import { parse } from '@okikio/rdf/nquads'
import { type FileSystemType, open } from '@okikio/triplestore'

/** Only this consumer owns the filesystem; the store borrows its structural contract. */
interface StorageType extends FileSystemType {
  close(): Promise<void>
  remove(path: string): Promise<void>
}
/** The source workspace need not depend on a published version of its sibling package. */
const storagePackage = '@okikio/opfs'
const memoryPackage = '@okikio/opfs/adapter/memory'
const nodePackage = '@okikio/opfs/adapter/node'
const installed = realpathSync(fileURLToPath(new URL('./node_modules/', import.meta.url)))
const resolutions = Object.fromEntries([
  '@okikio/rdf',
  '@okikio/rdf/nquads',
  '@okikio/triplestore',
  storagePackage,
  memoryPackage,
  nodePackage,
].map((specifier) => {
  const path = realpathSync(fileURLToPath(import.meta.resolve(specifier)))
  const owned = relative(installed, path)
  assert.ok(
    owned !== '' && owned !== '..' && !owned.startsWith(`..${sep}`) && !isAbsolute(owned),
    `${specifier} resolves outside installed artifacts: ${path}`,
  )
  return [specifier, path]
}))
console.log(`Installed storage module paths: ${JSON.stringify(resolutions)}`)
const storage: {
  createFileSystem(adapter: unknown, options: { coordination: 'local' }): StorageType
} = await import(storagePackage)
const memory: { createMemoryAdapter(): unknown } = await import(memoryPackage)
const native: { createNodeAdapter(options: { root: string }): unknown } = await import(nodePackage)

for (const backend of ['memory', 'node'] as const) {
  const root = await mkdtemp(join(tmpdir(), 'packed-rdf-opfs-'))
  let fs: StorageType | undefined
  const failures: unknown[] = []
  let store: Awaited<ReturnType<typeof open>> | undefined
  try {
    fs = storage.createFileSystem(
      backend === 'memory' ? memory.createMemoryAdapter() : native.createNodeAdapter({ root }),
      { coordination: 'local' },
    )
    const text = Array.from(
      { length: 65 },
      (_, index) => `<urn:s:${index}> <urn:p> "value ${index} 雪 😀"@ja <urn:g> .`,
    ).join('\n')
    const expected = Array.from(
      { length: 65 },
      (_, index) =>
        quad(
          namedNode(`urn:s:${index}`),
          namedNode('urn:p'),
          literal(`value ${index} 雪 😀`, 'ja'),
          namedNode('urn:g'),
        ),
    )
    store = await open(fs)
    await store.import(parse(text), { batchSize: 16 })
    assert.equal(store.generation, 5)
    assert.deepEqual([...store.snapshot()].map(key).sort(), expected.map(key).sort())
    await store.delete(expected[17]!)
    expected.splice(17, 1)
    await store.compact()
    await store.close()
    store = undefined
    for await (const entry of fs.readDir('/rdf/segments')) {
      if (entry.name.endsWith('.delta.nq')) await fs.remove(`/rdf/segments/${entry.name}`)
    }
    store = await open(fs)
    assert.equal(store.size, 64)
    assert.deepEqual([...store.snapshot()].map(key).sort(), expected.map(key).sort())
    const controller = new AbortController()
    const reason = new Error('packed mutation cancelled')
    controller.abort(reason)
    await assert.rejects(store.clear({ signal: controller.signal }), (error) => error === reason)
    assert.equal(store.size, 64)
    await store.clear()
    assert.equal(store.size, 0)
    await store.close()
    store = undefined
    assert.equal(await fs.exists('/rdf/format.json'), true)
    console.log(`Packed OPFS -> triplestore ${backend} import/compact/reopen/abort passed.`)
  } catch (error) {
    failures.push(error)
  } finally {
    // Attempt all owned releases, including when filesystem acquisition fails.
    for (
      const close of [
        () => store?.close(),
        () => fs?.close(),
        () => rm(root, { recursive: true, force: true }),
      ]
    ) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, `Packed ${backend} fixture or cleanup failed.`, {
      cause: failures[0],
    })
  }
}
