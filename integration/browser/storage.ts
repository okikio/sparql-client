import { type FileSystemType, open } from '@okikio/triplestore'
import * as rdf from '@okikio/rdf'

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
  const fileSystem = await opfs.openFileSystem()
  try {
    const store = await open(fileSystem, { path })
    try {
      await store.add(
        rdf.quad(
          rdf.namedNode('urn:browser:s'),
          rdf.namedNode('urn:browser:p'),
          rdf.literal('零 café 😀', 'fr'),
          rdf.namedNode('urn:browser:g'),
        ),
      )
      await store.compact()
    } finally {
      await store.close()
    }
    const borrowed = await fileSystem.exists(path)
    const reopened = await open(fileSystem, { path })
    try {
      const values = Array.from(reopened.snapshot())
      return {
        supported: true,
        size: reopened.size,
        borrowed,
        object: values[0]?.object.value,
        graph: values[0]?.graph.value,
      }
    } finally {
      await reopened.close()
    }
  } catch (error) {
    // A failed write can already have created durable files; the test must not
    // wait for a successful return before acquiring cleanup responsibility.
    try {
      await fileSystem.remove(path, { recursive: true })
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Browser store write and cleanup failed.', {
        cause: error,
      })
    }
    throw error
  } finally {
    await fileSystem.close()
  }
}

/** A new document must reconstruct exactly the committed RDF identity. */
export async function read(path: string) {
  const opfs = await module()
  const fileSystem = await opfs.openFileSystem()
  try {
    const store = await open(fileSystem, { path })
    try {
      const values = Array.from(store.snapshot())
      return {
        size: store.size,
        object: values[0]?.object.value,
        graph: values[0]?.graph.value,
        language: values[0]?.object.termType === 'Literal' ? values[0].object.language : null,
      }
    } finally {
      await store.close()
    }
  } finally {
    await fileSystem.close()
  }
}

/** Removes only the unique synthetic store directory created by its test. */
export async function remove(path: string) {
  const opfs = await module()
  const fileSystem = await opfs.openFileSystem()
  try {
    await fileSystem.remove(path, { recursive: true })
  } finally {
    await fileSystem.close()
  }
}
