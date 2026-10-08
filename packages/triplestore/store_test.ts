import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad } from '@okikio/rdf'
import { StoreError } from './mod.ts'
import { MemoryFileSystem, use } from './_memory_test.ts'

const predicate = namedNode('https://example.com/p')
const first = quad(namedNode('https://example.com/a'), predicate, literal('one'))
const second = quad(namedNode('https://example.com/b'), predicate, literal('two'))

describe('@okikio/triplestore', () => {
  it('rejects pre-aborted mutations even when no publication is needed', () =>
    use(async (open) => {
      const store = await open(new MemoryFileSystem(), { path: '/db' })
      await store.add(first)
      await expect(store.clear({ signal: AbortSignal.abort(null) })).rejects.toBe(null)
      const reason = new Error('stop before admission')
      const signal = AbortSignal.abort(reason)
      let acquired = 0
      const empty: Iterable<typeof first> = {
        [Symbol.iterator]() {
          acquired++
          return [][Symbol.iterator]()
        },
      }
      {
        await expect(store.add(first, { signal })).rejects.toBe(reason)
        await expect(store.delete(second, { signal })).rejects.toBe(reason)
        await expect(store.addAll(empty, { signal })).rejects.toBe(reason)
        await expect(store.deleteMatches(second.subject, null, null, null, { signal })).rejects
          .toBe(
            reason,
          )
        await expect(store.import(empty, { signal })).rejects.toBe(reason)
        expect(acquired).toBe(0)
        expect(store.generation).toBe(1)
        expect(store.has(first)).toBe(true)
        await store.clear()
        await expect(store.clear({ signal })).rejects.toBe(reason)
        expect(store.generation).toBe(2)
      }
    }))
  it('rejects imports on inadmissible handles before acquiring even an empty source', () =>
    use(async (open) => {
      for (const readonly of [false, true]) {
        const store = await open(new MemoryFileSystem(), {
          path: '/db',
          mode: readonly ? 'read' : 'write',
        })
        if (!readonly) await store.close()
        let acquired = 0
        const source: Iterable<typeof first> = {
          [Symbol.iterator]() {
            acquired++
            return [][Symbol.iterator]()
          },
        }
        {
          await expect(store.import(source)).rejects.toMatchObject({
            kind: readonly ? 'migration-required' : 'closed',
          })
          expect(acquired).toBe(0)
        }
      }
    }))
  it(
    'cancels a stalled import and admits the next mutation on the same store',
    { timeout: 5_000 },
    () =>
      use(async (open) => {
        const fs = new MemoryFileSystem()
        const store = await open(fs, { path: '/db' })
        const controller = new AbortController()
        let returned = 0
        let entered!: () => void
        const started = new Promise<void>((resolve) => {
          entered = resolve
        })
        const source: AsyncIterable<typeof first> = {
          [Symbol.asyncIterator]() {
            return {
              next() {
                entered()
                return new Promise<IteratorResult<typeof first>>(() => {})
              },
              return() {
                returned++
                return Promise.resolve({ done: true as const, value: undefined })
              },
            }
          },
        }
        const pending = store.import(source, { signal: controller.signal })
        await started
        const reason = new Error('stop stalled store import')
        controller.abort(reason)
        await expect(pending).rejects.toBe(reason)
        expect(returned).toBe(1)
        expect(store.generation).toBe(0)
        await store.add(first)
        expect(store.generation).toBe(1)
        expect(store.has(first)).toBe(true)
        await store.close()
      }),
  )
  it('recovers the newest complete committed generation after an interrupted commit publication', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.add(first)

      const fault = new Error('simulated publication crash')
      fs.writeFault = (path, text, target) => {
        if (!path.endsWith('/commits/0000000000000002.json')) return
        target.files.set(path, text.slice(0, Math.max(1, Math.floor(text.length / 2))))
        throw fault
      }
      await expect(store.add(second)).rejects.toMatchObject({
        kind: 'outcome-unknown',
        cause: fault,
      })
      fs.writeFault = undefined

      const reopened = await open(fs, { path: '/db' })
      expect(reopened.generation).toBe(1)
      expect(reopened.has(first)).toBe(true)
      expect(reopened.has(second)).toBe(false)
      expect(reopened.recovery[0]?.kind).toBe('incomplete-commit')
    }))

  it('fences torn publication and continues above occupied generations after reopening', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      let faulted = false
      const fault = new Error('simulated torn commit')

      fs.writeFault = (path, text, target) => {
        if (faulted || !path.endsWith('/commits/0000000000000001.json')) return
        faulted = true
        target.files.set(path, text.slice(0, Math.max(1, Math.floor(text.length / 2))))
        throw fault
      }

      await expect(store.add(first)).rejects.toMatchObject({
        kind: 'outcome-unknown',
        cause: fault,
      })
      fs.writeFault = undefined
      await expect(store.add(first)).rejects.toMatchObject({ kind: 'outcome-unknown' })
      const torn = fs.files.get('/db/commits/0000000000000001.json')
      await store.settlement
      await store.close()
      const fresh = await open(fs, { path: '/db' })
      await fresh.add(first)
      expect(fresh.generation).toBe(2)
      expect(fs.files.get('/db/commits/0000000000000001.json')).toBe(torn)
      const reopened = await open(fs, { path: '/db' })
      expect(reopened.generation).toBe(2)
      expect(reopened.has(first)).toBe(true)
    }))

  it('keeps a valid same-generation commit as a competing-writer conflict', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const left = await open(fs, { path: '/db' })
      const right = await open(fs, { path: '/db' })

      await left.add(first)
      await expect(right.add(second)).rejects.toMatchObject({ kind: 'writer-conflict' })
      expect(right.generation).toBe(0)
    }))

  it('never converts a corrupt authoritative committed generation into an empty database', () =>
    use(async (open) => {
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
    }))

  it('borrows rather than owns the injected filesystem', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.close()
      expect(await fs.exists('/db/format.json')).toBe(true)
    }))

  it('reopens homogeneous add and delete deltas with exact RDF terms', () =>
    use(async (open) => {
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
    }))

  it('falls back from a corrupt newer generation but never invents an empty authoritative store', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.add(first)
      await store.add(second)
      fs.files.set('/db/segments/0000000000000002.delta.nq', 'corrupt\n')

      const fallback = await open(fs, { path: '/db' })
      expect(fallback.generation).toBe(1)
      expect(fallback.has(first)).toBe(true)
      expect(fallback.has(second)).toBe(false)
    }))

  it('recovers from a compacted snapshot without older delta segments', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.addAll([first, second])
      await store.compact()
      fs.files.delete('/db/segments/0000000000000001.delta.nq')

      const reopened = await open(fs, { path: '/db' })
      expect(reopened.size).toBe(2)
      expect(reopened.has(first)).toBe(true)
      expect(reopened.has(second)).toBe(true)
    }))

  it('prevents mutations after close without disposing the borrowed filesystem', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.close()
      expect(await fs.exists('/db/format.json')).toBe(true)
      await expect(store.add(first)).rejects.toThrow()
    }))

  it('treats an incomplete first commit as interrupted publication rather than authoritative data', () =>
    use(async (open) => {
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
    }))
})
