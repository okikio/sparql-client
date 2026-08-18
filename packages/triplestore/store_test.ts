import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad } from '@okikio/rdf'
import { open, StoreError } from './mod.ts'
import { MemoryFileSystem } from './_memory_test.ts'

const predicate = namedNode('https://example.com/p')
const first = quad(namedNode('https://example.com/a'), predicate, literal('one'))
const second = quad(namedNode('https://example.com/b'), predicate, literal('two'))

describe('@okikio/triplestore', () => {
  it('recovers the newest complete committed generation after an interrupted commit publication', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.add(first)

    fs.writeFault = (path, text, target) => {
      if (!path.endsWith('/commits/0000000000000002.json')) return
      target.files.set(path, text.slice(0, Math.max(1, Math.floor(text.length / 2))))
      throw new Error('simulated publication crash')
    }
    await expect(store.add(second)).rejects.toThrow('simulated publication crash')
    fs.writeFault = undefined

    const reopened = await open(fs, { path: '/db' })
    expect(reopened.generation).toBe(1)
    expect(reopened.has(first)).toBe(true)
    expect(reopened.has(second)).toBe(false)
    expect(reopened.recovery[0]?.kind).toBe('incomplete-commit')
  })

  it('never converts a corrupt authoritative committed generation into an empty database', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.add(first)
    fs.files.set('/db/segments/0000000000000001.delta.nq', 'corrupt\n')

    try {
      await open(fs, { path: '/db' })
      throw new Error('Expected corrupt store open to fail.')
    } catch (error) {
      expect(error instanceof StoreError).toBe(true)
      if (!(error instanceof StoreError)) return
      expect(error.kind).toBe('corrupt')
    }
  })

  it('borrows rather than owns the injected filesystem', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.close()
    expect(await fs.exists('/db/format.json')).toBe(true)
  })

  it('reopens homogeneous add and delete deltas with exact RDF terms', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.addAll([first, second])
    await store.delete(first)
    await store.close()

    const reopened = await open(fs, { path: '/db' })
    expect(reopened.generation).toBe(2)
    expect(reopened.size).toBe(1)
    expect(reopened.has(first)).toBe(false)
    expect(reopened.has(second)).toBe(true)
  })

  it('falls back from a corrupt newer generation but never invents an empty authoritative store', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.add(first)
    await store.add(second)
    fs.files.set('/db/segments/0000000000000002.delta.nq', 'corrupt\n')

    const fallback = await open(fs, { path: '/db' })
    expect(fallback.generation).toBe(1)
    expect(fallback.has(first)).toBe(true)
    expect(fallback.has(second)).toBe(false)
  })

  it('recovers from a compacted snapshot without older delta segments', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.addAll([first, second])
    await store.compact()
    fs.files.delete('/db/segments/0000000000000001.delta.nq')

    const reopened = await open(fs, { path: '/db' })
    expect(reopened.size).toBe(2)
    expect(reopened.has(first)).toBe(true)
    expect(reopened.has(second)).toBe(true)
  })

  it('prevents mutations after close without disposing the borrowed filesystem', async () => {
    const fs = new MemoryFileSystem()
    const store = await open(fs, { path: '/db' })
    await store.close()
    expect(await fs.exists('/db/format.json')).toBe(true)
    await expect(store.add(first)).rejects.toThrow()
  })

  it('treats an incomplete first commit as interrupted publication rather than authoritative data', async () => {
    const fs = new MemoryFileSystem()
    await fs.ensureDir('/db/segments')
    await fs.ensureDir('/db/commits')
    await fs.writeFile(
      '/db/format.json',
      '{"version":2,"store":"@okikio/triplestore","segment":2}\n',
    )
    await fs.writeFile('/db/segments/0000000000000001.delta.nq', 'orphan\n')
    await fs.writeFile('/db/commits/0000000000000001.json', '{"version":2')

    const reopened = await open(fs, { path: '/db' })
    expect(reopened.generation).toBe(0)
    expect(reopened.size).toBe(0)
    expect(reopened.recovery[0]?.kind).toBe('incomplete-commit')
  })
})
