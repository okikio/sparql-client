/// <reference lib="deno.unstable" />
/** Real OPFS filesystem composition and crash recovery, without a production dependency. @module */

import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { join, toFileUrl } from '@std/path'
import { Dataset, key, literal, namedNode, type Quad, quad } from '@okikio/rdf'
import { parse } from '@okikio/rdf/nquads'
import { type FileSystemType, open } from '@okikio/triplestore'

/** This integration needs only the structural store contract plus consumer lifecycle operations. */
interface StorageType extends FileSystemType {
  /** Consumers can remove obsolete segments after a compacted snapshot has been published. */
  remove(path: string): Promise<void>
  /** The consumer, rather than the store, releases its filesystem. */
  close(): Promise<void>
}

/** The dynamic source selection is explicit and isolated from published package dependencies. */
interface ModuleType {
  createFileSystem(adapter: unknown, options?: { coordination: 'local' }): StorageType
}

/** A backend factory retains resource ownership so every failed test still cleans up. */
interface FixtureType {
  fs: StorageType
  close(): Promise<void>
}

/** OPFS_SOURCE is supplied by the task, so missing sibling source fails with a concrete path. */
const source = Deno.env.get('OPFS_SOURCE')
if (!source) {
  throw new Error(
    'Run deno task integration:storage with OPFS_SOURCE pointing to the OPFS checkout.',
  )
}
/** Runtime imports exercise the current checked-out implementation, including staged changes. */
const opfs: ModuleType = await import(toFileUrl(join(source, 'mod.ts')).href)

/** Opens one real storage backend under an isolated namespace or temporary directory. */
async function fixture(backend: 'memory' | 'node' | 'deno' | 'kv'): Promise<FixtureType> {
  const temporary = await Deno.makeTempDir({ prefix: `rdf-opfs-${backend}-` })
  let database: Deno.Kv | undefined
  let fs: StorageType | undefined
  try {
    let adapter: unknown
    if (backend === 'memory') {
      const module: { createMemoryAdapter(): unknown } = await import(
        toFileUrl(join(source!, 'src/adapter/memory.ts')).href
      )
      adapter = module.createMemoryAdapter()
    } else if (backend === 'kv') {
      database = await Deno.openKv(join(temporary, 'db'))
      const module: { createDenoKvAdapter(database: Deno.Kv, options: unknown): unknown } =
        await import(toFileUrl(join(source!, 'src/adapter/deno-kv.ts')).href)
      adapter = module.createDenoKvAdapter(database, {
        prefix: 'rdf',
        inlineBytes: 1024,
        partBytes: 4096,
      })
    } else {
      const module: Record<string, (options: { root: string }) => unknown> = await import(
        toFileUrl(join(source!, `src/adapter/${backend}.ts`)).href
      )
      adapter = module[backend === 'node' ? 'createNodeAdapter' : 'createDenoAdapter']!({
        root: temporary,
      })
    }
    fs = opfs.createFileSystem(adapter, { coordination: 'local' })
    const storage = fs
    return {
      fs: storage,
      async close() {
        await close(storage, database, temporary)
      },
    }
  } catch (error) {
    try {
      await close(fs, database, temporary)
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Storage fixture acquisition and cleanup failed.',
        {
          cause: error,
        },
      )
    }
    throw error
  }
}

/** Attempts every owned cleanup even when an earlier release fails. */
async function close(
  fs: StorageType | undefined,
  database: Deno.Kv | undefined,
  temporary: string,
): Promise<void> {
  const errors: unknown[] = []
  try {
    await fs?.close()
  } catch (error) {
    errors.push(error)
  }
  try {
    database?.close()
  } catch (error) {
    errors.push(error)
  }
  try {
    await Deno.remove(temporary, { recursive: true })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new AggregateError(errors, 'Storage fixture cleanup failed.')
}

/** Dataset keys retain RDF term identity and permit order-independent exact comparison. */
function keys(values: Iterable<Quad>): string[] {
  return [...values].map(key).sort()
}

/** The wrapper changes only publication fault timing; actual bytes still go through OPFS. */
function fault(fs: StorageType, target: 'segment' | 'commit', reason: Error): FileSystemType {
  return {
    exists: (path, options) => fs.exists(path, options),
    ensureDir: (path, options) => fs.ensureDir(path, options),
    readDir: (path, options) => fs.readDir(path, options),
    readText: (path, options) => fs.readText(path, options),
    stat: (path, options) => fs.stat(path, options),
    async writeFile(path, data, options) {
      const selected = target === 'commit'
        ? path.endsWith('/commits/0000000000000002.json')
        : path.endsWith('/segments/0000000000000002.delta.nq')
      if (selected) {
        const prefix = typeof data === 'string' ? data.slice(0, 12) : data.subarray(0, 12)
        await fs.writeFile(path, prefix, options)
        throw reason
      }
      await fs.writeFile(path, data, options)
    },
  }
}

for (const backend of ['memory', 'node', 'deno', 'kv'] as const) {
  describe(`real OPFS ${backend} -> RDF triplestore`, () => {
    it('retains completed import batches after a source failure and discards the unfinished batch', async () => {
      const target = await fixture(backend)
      try {
        const values = [0, 1, 2].map((index) =>
          quad(namedNode(`urn:batch:${index}`), namedNode('urn:p'), literal(`value ${index}`))
        )
        let returned = 0
        const reason = new Error('source failed after incomplete batch')
        const input = async function* () {
          try {
            yield* values
            throw reason
          } finally {
            returned++
          }
        }
        let store = await open(target.fs)
        await expect(store.import(input(), { batchSize: 2 })).rejects.toBe(reason)
        expect(returned).toBe(1)
        expect(store.generation).toBe(1)
        expect(keys(store.snapshot())).toEqual(keys(values.slice(0, 2)))
        await store.close()
        store = await open(target.fs)
        expect(keys(store.snapshot())).toEqual(keys(values.slice(0, 2)))
        await store.add(values[2]!)
        expect(store.generation).toBe(2)
        expect(keys(store.snapshot())).toEqual(keys(values))
        await store.close()
      } finally {
        await target.close()
      }
    })

    it('cancels a stalled source after an acknowledged batch and releases its iterator', {
      timeout: 5_000,
    }, async () => {
      const target = await fixture(backend)
      try {
        const values = [0, 1].map((index) =>
          quad(namedNode(`urn:abort:${index}`), namedNode('urn:p'), literal(`value ${index}`))
        )
        let entered!: () => void
        const started = new Promise<void>((resolve) => {
          entered = resolve
        })
        let returned = 0
        const input: AsyncIterable<Quad> = {
          [Symbol.asyncIterator]() {
            let index = 0
            return {
              next() {
                if (index < values.length) {
                  return Promise.resolve({ done: false as const, value: values[index++]! })
                }
                entered()
                return new Promise<IteratorResult<Quad>>(() => {})
              },
              return() {
                returned++
                return Promise.resolve({ done: true as const, value: undefined })
              },
            }
          },
        }
        let store = await open(target.fs)
        const controller = new AbortController()
        const pending = store.import(input, { batchSize: 2, signal: controller.signal })
        await started
        const reason = new Error('cancel stalled source after batch')
        controller.abort(reason)
        await expect(pending).rejects.toBe(reason)
        expect(returned).toBe(1)
        expect(store.generation).toBe(1)
        await store.close()
        store = await open(target.fs)
        expect(keys(store.snapshot())).toEqual(keys(values))
        await store.clear()
        expect(store.size).toBe(0)
        await store.close()
      } finally {
        await target.close()
      }
    })
    it('parses, imports in bounded batches, mutates, compacts and reopens exact RDF terms', async () => {
      const target = await fixture(backend)
      try {
        const text = Array.from(
          { length: 300 },
          (_, index) => `<urn:s:${index}> <urn:p> "value ${index} 雪"@en <urn:g> .`,
        ).join('\n')
        // Derive every expected term independently; repeating the parser would
        // admit the same wrong literal, language, graph or predicate in both lanes.
        const expected = new Dataset(
          Array.from({ length: 300 }, (_, index) =>
            quad(
              namedNode(`urn:s:${index}`),
              namedNode('urn:p'),
              literal(`value ${index} 雪`, 'en'),
              namedNode('urn:g'),
            )),
        )
        let store = await open(target.fs)
        await store.import(parse(text), { batchSize: 73 })
        expect(store.generation).toBe(5)
        expect(keys(store.snapshot())).toEqual(keys(expected))
        const removed = quad(
          namedNode('urn:s:17'),
          namedNode('urn:p'),
          literal('value 17 雪', 'en'),
          namedNode('urn:g'),
        )
        expected.delete(removed)
        await store.delete(removed)
        await store.compact()
        await store.close()
        expect(await target.fs.exists('/rdf/format.json')).toBe(true)
        for await (const entry of target.fs.readDir('/rdf/segments')) {
          if (entry.name.endsWith('.delta.nq')) {
            await target.fs.remove(`/rdf/segments/${entry.name}`)
          }
        }
        store = await open(target.fs)
        expect(keys(store.snapshot())).toEqual(keys(expected))
        expect(store.size).toBe(299)
        await store.close()
        await expect(store.add(removed)).rejects.toMatchObject({ kind: 'closed' })
      } finally {
        await target.close()
      }
    })

    for (const stage of ['segment', 'commit'] as const) {
      it(`rejects torn ${stage} publication and reopens only acknowledged state`, async () => {
        const target = await fixture(backend)
        try {
          const first = quad(namedNode('urn:first'), namedNode('urn:p'), literal('first'))
          const second = quad(namedNode('urn:second'), namedNode('urn:p'), literal('second'))
          const reason = new Error(`injected torn ${stage}`)
          const store = await open(fault(target.fs, stage, reason))
          await store.add(first)
          await expect(store.add(second)).rejects.toBe(reason)
          expect(store.generation).toBe(1)
          expect(store.has(second)).toBe(false)
          await store.close()
          const reopened = await open(target.fs)
          expect(reopened.generation).toBe(1)
          expect(keys(reopened.snapshot())).toEqual([key(first)])
          await reopened.close()
          await target.fs.writeFile('/owner.txt', 'filesystem still owned by consumer')
        } finally {
          await target.close()
        }
      })
    }

    it('falls back from corrupt newer data and rejects corrupt sole authoritative data', async () => {
      const target = await fixture(backend)
      try {
        const first = quad(namedNode('urn:first'), namedNode('urn:p'), literal('first'))
        const second = quad(namedNode('urn:second'), namedNode('urn:p'), literal('second'))
        const store = await open(target.fs)
        await store.add(first)
        await store.add(second)
        await store.close()
        await target.fs.writeFile('/rdf/segments/0000000000000002.delta.nq', 'corrupt\n')
        const recovered = await open(target.fs)
        expect(recovered.generation).toBe(1)
        expect(recovered.recovery[0]?.kind).toBe('corrupt-generation')
        await recovered.close()
        await target.fs.writeFile('/rdf/segments/0000000000000001.delta.nq', 'corrupt\n')
        await expect(open(target.fs)).rejects.toMatchObject({ kind: 'corrupt' })
      } finally {
        await target.close()
      }
    })

    it('does not publish a pre-aborted mutation and accepts the next mutation', async () => {
      const target = await fixture(backend)
      try {
        const value = quad(namedNode('urn:s'), namedNode('urn:p'), literal('value'))
        const store = await open(target.fs)
        const reason = new Error('cancel before store mutation')
        await expect(store.add(value, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
        expect(store.generation).toBe(0)
        await store.add(value)
        await store.close()
        const reopened = await open(target.fs)
        expect(reopened.has(value)).toBe(true)
        await reopened.close()
      } finally {
        await target.close()
      }
    })
  })
}
