import { type FileSystemType, open } from '@okikio/triplestore'
import * as rdf from '@okikio/rdf'
import { finish } from '../releases.ts'

/** This seam is structural, matching triplestore's borrowed filesystem ownership. */
interface ModuleType {
  openFileSystem(): Promise<
    FileSystemType & {
      close(): Promise<void>
      remove(path: string, options: { recursive: boolean }): Promise<void>
    }
  >
  probeOpfs(): Promise<{ readonly rootAvailable: boolean }>
}

/** An explicit import map selects the inspected OPFS root when this optional lane runs. */
async function module(): Promise<ModuleType> {
  const specifier = '@okikio/opfs'
  return await import(/* @vite-ignore */ specifier)
}

/** Writes RDF, compacts, closes, reopens, and proves the filesystem remains borrowed. */
export async function write(path: string) {
  const opfs = await module()
  const probe = await opfs.probeOpfs()
  if (!probe.rootAvailable) return { supported: false, probe }
  return await finish(async (releases) => {
    const fileSystem = await opfs.openFileSystem()
    releases.push(() => fileSystem.close())
    try {
      await finish(async (stores) => {
        const store = await open(fileSystem, { path })
        stores.push(() => store.close())
        await store.add(
          rdf.quad(
            rdf.namedNode('urn:browser:s'),
            rdf.namedNode('urn:browser:p'),
            rdf.literal('零 café 😀', 'fr'),
            rdf.namedNode('urn:browser:g'),
          ),
        )
        await store.compact()
      })
      const borrowed = await fileSystem.exists(path)
      return await finish(async (stores) => {
        const reopened = await open(fileSystem, { path })
        stores.push(() => reopened.close())
        const values = Array.from(reopened.snapshot())
        return {
          supported: true,
          size: reopened.size,
          borrowed,
          object: values[0]?.object.value,
          graph: values[0]?.graph.value,
        }
      })
    } catch (error) {
      // A failed acquisition or write can already have created persistent files.
      // Remove those while the filesystem is live, retaining each failure.
      try {
        await fileSystem.remove(path, { recursive: true })
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Browser store write and cleanup failed.', {
          cause: error,
        })
      }
      throw error
    }
  })
}

/** A new document must reconstruct exactly the committed RDF identity. */
export async function read(path: string) {
  const opfs = await module()
  return await finish(async (releases) => {
    const fileSystem = await opfs.openFileSystem()
    releases.push(() => fileSystem.close())
    const store = await open(fileSystem, { path })
    releases.push(() => store.close())
    const values = Array.from(store.snapshot())
    return {
      size: store.size,
      object: values[0]?.object.value,
      graph: values[0]?.graph.value,
      language: values[0]?.object.termType === 'Literal' ? values[0].object.language : null,
    }
  })
}

/** Removes only the unique synthetic store directory created by its test. */
export async function remove(path: string) {
  const opfs = await module()
  await finish(async (releases) => {
    const fileSystem = await opfs.openFileSystem()
    releases.push(() => fileSystem.close())
    await fileSystem.remove(path, { recursive: true })
  })
}
