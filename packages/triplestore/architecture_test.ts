import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad } from '@okikio/rdf'
import { migrate } from './mod.ts'
import { MemoryFileSystem, use } from './_memory_test.ts'

const first = quad(namedNode('urn:first'), namedNode('urn:p'), literal('one'))
const second = quad(namedNode('urn:second'), namedNode('urn:p'), literal('two'))

function gate<Value = void>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void
  return {
    promise: new Promise<Value>((yes) => {
      resolve = yes
    }),
    get resolve() {
      return resolve
    },
  }
}

describe('triplestore recovery and publication authority', () => {
  it('preserves pending recovery abort and filesystem failure instead of returning empty state', {
    timeout: 5000,
  }, () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.add(first)
      const original = fs.readText.bind(fs)
      const entered = gate()
      const release = gate<string>()
      fs.readText = (path, options) => {
        if (path.endsWith('/commits/0000000000000001.json')) {
          entered.resolve()
          return release.promise
        }
        return original(path, options)
      }
      const controller = new AbortController()
      const opening = open(fs, { path: '/db', signal: controller.signal })
      await entered.promise
      controller.abort(null)
      await expect(opening).rejects.toBe(null)
      release.resolve('{}')
      const unavailable = new Error('storage denied')
      fs.readText = (path, options) =>
        path.includes('/commits/') ? Promise.reject(unavailable) : original(path, options)
      await expect(open(fs, { path: '/db' })).rejects.toBe(unavailable)
    }))

  it('continues recovery above occupied corrupt history with a self-contained snapshot', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const original = await open(fs, { path: '/db' })
      await original.add(first)
      await original.add(second)
      const damaged = 'torn segment'
      fs.files.set('/db/segments/0000000000000002.delta.nq', damaged)
      const recovered = await open(fs, { path: '/db' })
      expect(recovered.generation).toBe(1)
      await recovered.add(second)
      expect(recovered.generation).toBe(3)
      expect(fs.files.get('/db/segments/0000000000000002.delta.nq')).toBe(damaged)
      const record = JSON.parse(fs.files.get('/db/commits/0000000000000003.json')!)
      expect(record).toMatchObject({ version: 3, parent: 1, mode: 'snapshot' })
      // Snapshot ancestry is provenance: its complete dataset does not require the old parent.
      fs.files.delete('/db/commits/0000000000000001.json')
      fs.files.delete('/db/segments/0000000000000001.delta.nq')
      const reopened = await open(fs, { path: '/db' })
      expect(reopened.generation).toBe(3)
      expect(reopened.size).toBe(2)
      expect(reopened.has(first)).toBe(true)
      expect(reopened.has(second)).toBe(true)
    }))

  it('admits legacy state read-only and gates interrupted migration until verified readiness', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const legacy = await open(fs, { path: '/old' })
      await legacy.add(first)
      for (const [path, text] of fs.files) {
        if (path.endsWith('.json')) fs.files.set(path, text.replace('"version":3', '"version":2'))
      }
      const before = new Map(fs.files)
      const read = await open(fs, { path: '/old' })
      expect(read.writable).toBe(false)
      await expect(read.add(second)).rejects.toMatchObject({ kind: 'migration-required' })
      const fault = new Error('readiness publication interrupted')
      fs.writeFault = (path) => {
        if (path.endsWith('/ready.json')) throw fault
      }
      await expect(migrate(fs, { from: '/old', to: '/new' })).rejects.toBe(fault)
      await expect(open(fs, { path: '/new' })).rejects.toMatchObject({
        kind: 'migration-incomplete',
      })
      fs.writeFault = undefined
      const receipt = await migrate(fs, { from: '/old', to: '/new' })
      expect(receipt).toMatchObject({ path: '/new', generation: 1, quadCount: 1 })
      for (const [path, text] of before) expect(fs.files.get(path)).toBe(text)
      const ready = fs.files.get('/new/ready.json')
      const active = await open(fs, { path: '/new' })
      await active.add(second)
      await active.close()
      const reopened = await open(fs, { path: '/new' })
      expect(reopened.size).toBe(2)
      expect(reopened.has(first)).toBe(true)
      expect(reopened.has(second)).toBe(true)
      expect(fs.files.get('/new/ready.json')).toBe(ready)
      expect(await migrate(fs, { from: '/old', to: '/new' })).toEqual(receipt)
      expect((await open(fs, { path: '/new' })).size).toBe(2)
    }))

  it('rejects protocol mixing and invalid controls before acquiring storage', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      for (const value of [0, -1, NaN, Infinity, 1.5]) {
        await expect(open(fs, { maxReplayQuads: value })).rejects.toBeInstanceOf(RangeError)
      }
      expect(fs.files.size).toBe(0)
      const store = await open(fs, { path: '/db' })
      await store.add(first)
      fs.files.set('/db/format.json', '{"version":2,"store":"@okikio/triplestore","segment":2}\n')
      await expect(open(fs, { path: '/db' })).rejects.toMatchObject({ kind: 'format' })
      fs.files.set('/db/format.json', '{"version":3,"store":"@okikio/triplestore","segment":2}\n')
      const commit = fs.files.get('/db/commits/0000000000000001.json')!
      fs.files.set(
        '/db/commits/0000000000000001.json',
        commit.replace('"version":3', '"version":4'),
      )
      await expect(open(fs, { path: '/db' })).rejects.toMatchObject({ kind: 'format' })
    }))

  it('caps actual streamed bytes despite understated metadata and releases the reader once', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.add(first)
      let cancelled = 0
      let body: ReadableStream<Uint8Array> | undefined
      const streamed = Object.assign(fs, {
        openReadStream(path: string): Promise<ReadableStream<Uint8Array>> {
          const bytes = new TextEncoder().encode(fs.files.get(path)!)
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
            },
            cancel() {
              cancelled++
            },
          }, { highWaterMark: 0 })
          if (path.includes('/segments/')) body = stream
          else {
            // Non-segment records remain ordinary complete streams.
            return Promise.resolve(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes)
                  controller.close()
                },
              }),
            )
          }
          return Promise.resolve(stream)
        },
      })
      const stat = fs.stat.bind(fs)
      fs.stat = (path, options) =>
        path.includes('/segments/')
          ? Promise.resolve({ kind: 'file', size: 1 })
          : stat(path, options)
      await expect(open(streamed, { path: '/db', maxSegmentBytes: 1 })).rejects.toBeInstanceOf(
        RangeError,
      )
      expect(cancelled).toBe(1)
      expect(body?.locked).toBe(false)
    }))

  it('caches immutable recovery artifacts and bounds replay work across rejected counts', () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      await store.add(first)
      await store.add(second)
      await store.add(quad(namedNode('urn:third'), namedNode('urn:p'), literal('three')))
      for (const generation of [2, 3]) {
        const path = `/db/commits/${String(generation).padStart(16, '0')}.json`
        const record = JSON.parse(fs.files.get(path)!)
        fs.files.set(path, JSON.stringify({ ...record, quadCount: 999 }))
      }
      const read = fs.readText.bind(fs)
      const counts = new Map<string, number>()
      fs.readText = (path, options) => {
        if (path.includes('/segments/')) counts.set(path, (counts.get(path) ?? 0) + 1)
        return read(path, options)
      }
      const recovered = await open(fs, { path: '/db', maxReplayQuads: 5 })
      expect(recovered.generation).toBe(1)
      expect(recovered.has(first)).toBe(true)
      expect([...counts.values()]).toEqual([1, 1, 1])
      await expect(open(fs, { path: '/db', maxReplayQuads: 4 })).rejects.toBeInstanceOf(RangeError)
    }))

  it('does not wait for an uncooperative write to terminate cancellation but exposes settlement', {
    timeout: 5000,
  }, () =>
    use(async (open) => {
      const fs = new MemoryFileSystem()
      const store = await open(fs, { path: '/db' })
      const entered = gate()
      const release = gate()
      fs.writeFault = async (path) => {
        if (path.includes('/segments/')) {
          entered.resolve()
          await release.promise
        }
      }
      const controller = new AbortController()
      const writing = store.add(first, { signal: controller.signal })
      await entered.promise
      const reason = new Error('stop publication')
      controller.abort(reason)
      await expect(writing).rejects.toMatchObject({ kind: 'outcome-unknown', cause: reason })
      let settled = false
      const settlement = store.settlement.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      await expect(store.add(second)).rejects.toMatchObject({ kind: 'outcome-unknown' })
      release.resolve()
      await settlement
      await store.close()
      const recovered = await open(fs, { path: '/db' })
      await recovered.add(first)
      expect(recovered.generation).toBe(2)
      expect(recovered.has(first)).toBe(true)
    }))
})
