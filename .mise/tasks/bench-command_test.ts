import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { createHash } from 'node:crypto'
import { finish } from '../../integration/releases.ts'
import { collect, read, spool } from './bench-command.ts'
import { nodeTerminate, terminate } from './termination_fixture.ts'

describe('benchmark child lifetime', () => {
  it('retains complete output after the actual child exits', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'console.log("fixture stdout"); console.error("fixture stderr")',
    ])
    expect(result.success).toBe(true)
    expect(result.code).toBe(0)
    expect(new TextDecoder().decode(result.stdout).trim()).toBe('fixture stdout')
    expect(new TextDecoder().decode(result.stderr).trim()).toBe('fixture stderr')
  })
  it('preserves raw diagnostic bytes without UTF-8 replacement', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'await Deno.stdout.write(new Uint8Array([0,255,128])); await Deno.stderr.write(new Uint8Array([254,1]))',
    ])
    expect(result.success).toBe(true)
    expect([...result.stdout]).toEqual([0, 255, 128])
    expect([...result.stderr]).toEqual([254, 1])
  })
  it('retains an unsuccessful reported exit and its diagnostics', async () => {
    const result = await collect(Deno.execPath(), [
      'eval',
      'console.error("child rejected workload"); Deno.exit(7)',
    ])
    expect(result.success).toBe(false)
    expect(result.code).toBe(7)
    expect(result.error).toBeInstanceOf(Error)
    expect(new TextDecoder().decode(result.stderr)).toContain('child rejected workload')
  })
  it('reports a startup failure without inventing an exit status', async () => {
    const result = await collect(`missing-benchmark-${crypto.randomUUID()}`, [])
    expect(result.success).toBe(false)
    expect(result.code).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
  it('terminates a child that never finishes, without treating elapsed time as performance', async () => {
    const native = await nodeTerminate()
    const result = await collect(Deno.execPath(), [
      'eval',
      'await new Promise(() => setInterval(() => {}, 1000))',
    ], { timeoutMs: 250 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(native.code)
    expect(result.error).toMatchObject({ killed: true, signal: native.signal })
  })
})

/** Small owned directory scope; spool owns its files and direct child inside it. */
async function fixture<Value>(
  body: (paths: { stdout: string; stderr: string }) => Promise<Value>,
): Promise<Value> {
  return await finish(async (release) => {
    const directory = await Deno.makeTempDir({ prefix: 'benchmark-spool-' })
    release.push(() => Deno.remove(directory, { recursive: true }))
    return await body({ stdout: `${directory}/stdout`, stderr: `${directory}/stderr` })
  })
}

/** Real child writes every accepted suffix, without assuming one native write consumes a chunk. */
const binary = `
async function write(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
}
`

describe('native benchmark file capture', () => {
  it('retains more than the old 32MiB memory cap without dropping samples or binary bytes', async () => {
    await fixture(async (paths) => {
      const repetitions = 513
      const part = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251)
      const expected = createHash('sha256')
      for (let index = 0; index < repetitions; index++) expected.update(part)
      const result = await spool(Deno.execPath(), [
        'eval',
        `${binary}
const part = Uint8Array.from({length: 64 * 1024}, (_, index) => index % 251);
for (let index = 0; index < ${repetitions}; index++) await write(Deno.stdout, part);
await write(Deno.stderr, new Uint8Array([0,255,128,254,1]));`,
      ], paths)
      expect(result.success).toBe(true)
      expect(result.code).toBe(0)
      expect(result.failures).toEqual([])
      expect(result.stdout).toMatchObject({
        retainedBytes: part.byteLength * repetitions,
        observedBytes: part.byteLength * repetitions,
        complete: true,
        quotaBytes: 128 * 1024 * 1024,
      })
      const actual = createHash('sha256')
      await finish(async (release) => {
        const file = await Deno.open(paths.stdout)
        release.push(() => file.close())
        const buffer = new Uint8Array(64 * 1024)
        for (;;) {
          const count = await file.read(buffer)
          if (count === null) break
          actual.update(buffer.subarray(0, count))
        }
      })
      expect(actual.digest('hex')).toBe(expected.digest('hex'))
      expect([...await read(paths.stderr, result.stderr.quotaBytes)]).toEqual([0, 255, 128, 254, 1])
    })
  })
  it('admits exact independent stream quotas and rejects the first extra byte', async () => {
    await fixture(async (paths) => {
      const result = await spool(
        Deno.execPath(),
        [
          'eval',
          `${binary}
await write(Deno.stdout, new Uint8Array(4096).fill(19));
await write(Deno.stderr, new Uint8Array(4096).fill(37));`,
        ],
        paths,
        { quotaBytes: 4096 },
      )
      expect(result.success).toBe(true)
      expect(result.stdout.retainedBytes).toBe(4096)
      expect(result.stderr.retainedBytes).toBe(4096)
      expect([...await read(paths.stdout, 4096)]).toEqual(new Array(4096).fill(19))
      expect([...await read(paths.stderr, 4096)]).toEqual(new Array(4096).fill(37))
    })
    for (const stream of ['stdout', 'stderr'] as const) {
      await fixture(async (paths) => {
        const result = await spool(
          Deno.execPath(),
          [
            'eval',
            `${binary}
await write(Deno.${stream}, new Uint8Array(4097).fill(23));`,
          ],
          paths,
          { quotaBytes: 4096 },
        )
        expect(result.success).toBe(false)
        expect(result[stream].retainedBytes).toBe(4096)
        expect(result[stream].observedBytes).toBeGreaterThan(4096)
        expect(result[stream].complete).toBe(false)
        expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'quota', stream }))
        expect([...await read(paths[stream], 4096)]).toEqual(new Array(4096).fill(23))
        await expect(read(paths[stream], 4095)).rejects.toBeInstanceOf(AggregateError)
      })
    }
  })
  it('preserves an unsuccessful actual exit separately from successful pipe capture', async () => {
    await fixture(async (paths) => {
      const result = await spool(Deno.execPath(), [
        'eval',
        `${binary}
await write(Deno.stderr, new Uint8Array([0,255,7])); Deno.exit(7);`,
      ], paths)
      expect(result.success).toBe(false)
      expect(result.code).toBe(7)
      expect(result.stdout.complete).toBe(true)
      expect(result.stderr.complete).toBe(true)
      expect(result.failures).toEqual([])
      expect([...await read(paths.stderr, result.stderr.quotaBytes)]).toEqual([0, 255, 7])
    })
  })
  it('retains startup failure and closes both files without inventing an exit', async () => {
    await fixture(async (paths) => {
      const closed: string[] = []
      const result = await spool(`missing-spooled-child-${crypto.randomUUID()}`, [], paths, {
        async open(path) {
          const file = await Deno.open(path, { createNew: true, write: true })
          return {
            write: (bytes) => file.write(bytes),
            close() {
              file.close()
              closed.push(path)
            },
          }
        },
      })
      expect(result.success).toBe(false)
      expect(result.code).toBeNull()
      expect(result.stdout.complete).toBe(false)
      expect(result.stderr.complete).toBe(false)
      expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'startup' }))
      expect(closed.toSorted()).toEqual([paths.stderr, paths.stdout].toSorted())
      expect((await Deno.stat(paths.stdout)).size).toBe(0)
      expect((await Deno.stat(paths.stderr)).size).toBe(0)
    })
  })
  it('expires only after real output admission, retires the child and disarms the watchdog', async () => {
    await fixture(async (paths) => {
      const native = await terminate()
      let expire: (() => void) | undefined
      let disarmed = false
      const result = await spool(
        Deno.execPath(),
        [
          'eval',
          `${binary}
await write(Deno.stdout, new Uint8Array([41]));
await new Promise(() => setInterval(() => {}, 1000));`,
        ],
        paths,
        {
          watchdog(callback) {
            expire = callback
            return () => {
              disarmed = true
            }
          },
          async open(path) {
            const file = await Deno.open(path, { createNew: true, write: true })
            return {
              async write(bytes) {
                const count = await file.write(bytes)
                if (path === paths.stdout) expire!()
                return count
              },
              close: () => file.close(),
            }
          },
        },
      )
      expect(result.success).toBe(false)
      expect({ code: result.code, signal: result.signal }).toEqual({
        code: native.code,
        signal: native.signal,
      })
      expect(result.code).not.toBeNull()
      expect(result.failures).toContainEqual(expect.objectContaining({ stage: 'deadline' }))
      expect([...await read(paths.stdout, result.stdout.quotaBytes)]).toEqual([41])
      expect(disarmed).toBe(true)
    })
  })
  it('retries partial disk writes and retains the full suffix in both directions', async () => {
    await fixture(async (paths) => {
      const result = await spool(
        Deno.execPath(),
        [
          'eval',
          `${binary}
await write(Deno.stdout, new Uint8Array([1,2,3,4,5,6,7,8]));
await write(Deno.stderr, new Uint8Array([8,7,6,5,4,3,2,1]));`,
        ],
        paths,
        {
          async open(path) {
            const file = await Deno.open(path, { createNew: true, write: true })
            return { write: (bytes) => file.write(bytes.subarray(0, 3)), close: () => file.close() }
          },
        },
      )
      expect(result.success).toBe(true)
      expect([...await read(paths.stdout, result.stdout.quotaBytes)]).toEqual([
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
      ])
      expect([...await read(paths.stderr, result.stderr.quotaBytes)]).toEqual([
        8,
        7,
        6,
        5,
        4,
        3,
        2,
        1,
      ])
    })
  })
  it('rejects disk failure and zero progress while retaining both independent close failures', async () => {
    const native = await terminate()
    for (const mode of ['zero', 'invalid', 'undefined', 'error'] as const) {
      await fixture(async (paths) => {
        const failure = mode === 'error' ? new Error('owned write rejected') : undefined
        const closed: string[] = []
        const firstClose = new Error('stdout retirement failed')
        const secondClose = new Error('stderr retirement failed')
        const result = await spool(
          Deno.execPath(),
          [
            'eval',
            `${binary}
await write(Deno.stdout, new Uint8Array([1,2,3]));
await new Promise(() => setInterval(() => {}, 1000));`,
          ],
          paths,
          {
            async open(path) {
              const file = await Deno.open(path, { createNew: true, write: true })
              return {
                write(bytes) {
                  if (path === paths.stdout) {
                    if (mode === 'zero') return Promise.resolve(0)
                    if (mode === 'invalid') return Promise.resolve(bytes.byteLength + 1)
                    return Promise.reject(failure)
                  }
                  return file.write(bytes)
                },
                close() {
                  file.close()
                  closed.push(path)
                  throw path === paths.stdout ? firstClose : secondClose
                },
              }
            },
          },
        )
        expect(result.success).toBe(false)
        expect({ code: result.code, signal: result.signal }).toEqual({
          code: native.code,
          signal: native.signal,
        })
        expect(result.failures).toContainEqual(
          expect.objectContaining({ stage: 'write', stream: 'stdout' }),
        )
        if (mode === 'error' || mode === 'undefined') {
          expect(result.failures.some((item) => item.stage === 'write' && item.reason === failure))
            .toBe(true)
        }
        expect(result.failures).toContainEqual({
          stage: 'close',
          stream: 'stdout',
          reason: firstClose,
        })
        expect(result.failures).toContainEqual({
          stage: 'close',
          stream: 'stderr',
          reason: secondClose,
        })
        expect(closed.toSorted()).toEqual([paths.stderr, paths.stdout].toSorted())
      })
    }
  })
  it('does not promote an exit-zero child when only file retirement failed', async () => {
    await fixture(async (paths) => {
      const failure = new Error('file retirement rejected')
      const result = await spool(Deno.execPath(), ['eval', ''], paths, {
        async open(path) {
          const file = await Deno.open(path, { createNew: true, write: true })
          return {
            write: (bytes) => file.write(bytes),
            close() {
              file.close()
              if (path === paths.stderr) throw failure
            },
          }
        },
      })
      expect(result.success).toBe(false)
      expect(result.code).toBe(0)
      expect(result.stdout.complete).toBe(true)
      expect(result.stderr.complete).toBe(true)
      expect(result.failures).toEqual([{ stage: 'close', stream: 'stderr', reason: failure }])
    })
  })
  it('refuses oversized native timers and invalid quotas before acquiring files or children', async () => {
    for (const timeoutMs of [0, NaN, Infinity, 2 ** 31, 1.5]) {
      expect(() => collect('unused-child', [], { timeoutMs })).toThrow(RangeError)
      await expect(spool('unused-child', [], { stdout: 'unused-out', stderr: 'unused-err' }, {
        timeoutMs,
        open() {
          throw new Error('Files must not be acquired')
        },
      })).rejects.toBeInstanceOf(RangeError)
    }
    for (const quotaBytes of [0, NaN, Infinity, 1.5]) {
      await expect(spool('unused-child', [], { stdout: 'unused-out', stderr: 'unused-err' }, {
        quotaBytes,
        open() {
          throw new Error('Files must not be acquired')
        },
      })).rejects.toBeInstanceOf(RangeError)
    }
    await fixture(async (paths) => {
      const result = await spool(Deno.execPath(), ['eval', ''], paths, { timeoutMs: 2 ** 31 - 1 })
      expect(result.success).toBe(true)
    })
  })
  it('does not clobber an existing raw file or leak the first file when the second acquisition fails', async () => {
    await fixture(async (paths) => {
      const first = Uint8Array.from([91, 255, 0])
      await Deno.writeFile(paths.stderr, first)
      const closed: string[] = []
      const opened: Deno.FsFile[] = []
      let openFailure: unknown
      const result = await spool(Deno.execPath(), ['eval', ''], paths, {
        async open(path) {
          let file: Deno.FsFile
          try {
            file = await Deno.open(path, { createNew: true, write: true })
          } catch (error) {
            openFailure = error
            throw error
          }
          opened.push(file)
          return {
            write: (bytes) => file.write(bytes),
            close() {
              file.close()
              closed.push(path)
            },
          }
        },
      })
      expect(result.success).toBe(false)
      expect(result.code).toBeNull()
      expect(openFailure).toBeInstanceOf(Deno.errors.AlreadyExists)
      expect(result.failures.find((item) => item.stage === 'open')?.reason).toBe(openFailure)
      expect([...await Deno.readFile(paths.stderr)]).toEqual([...first])
      expect(closed).toEqual([paths.stdout])
      expect(opened.length).toBe(1)
      await expect(opened[0]!.stat()).rejects.toBeInstanceOf(Deno.errors.BadResource)
    })
  })
  it('retires the acquired child and both native files after watchdog admission throws', async () => {
    await fixture(async (paths) => {
      const native = await terminate()
      const failure = new Error('watchdog admission failed')
      const closed: string[] = []
      const opened: Deno.FsFile[] = []
      const result = await spool(
        Deno.execPath(),
        [
          'eval',
          'await new Promise(() => setInterval(() => {}, 1000))',
        ],
        paths,
        {
          watchdog() {
            throw failure
          },
          async open(path) {
            const file = await Deno.open(path, { createNew: true, write: true })
            opened.push(file)
            return {
              write: (bytes) => file.write(bytes),
              close() {
                file.close()
                closed.push(path)
              },
            }
          },
        },
      )
      expect(result.success).toBe(false)
      expect({ code: result.code, signal: result.signal }).toEqual({
        code: native.code,
        signal: native.signal,
      })
      expect(result.code).not.toBeNull()
      expect(result.failures.find((item) => item.stage === 'deadline')?.reason).toBe(failure)
      expect(closed.toSorted()).toEqual([paths.stderr, paths.stdout].toSorted())
      expect(opened.length).toBe(2)
      for (const file of opened) {
        await expect(file.stat()).rejects.toBeInstanceOf(Deno.errors.BadResource)
      }
    })
  })
})
