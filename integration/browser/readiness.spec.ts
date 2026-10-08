/** Native admission controls protect fixture setup without invoking library scenarios. @module */
import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BrowserContext, Page } from '@playwright/test'
import { ADMISSION_MS, AdmissionError, httpFailure, open } from './ready.ts'
import { own } from './fixture.ts'
import { finish } from '../releases.ts'

/** These controls exercise acquisition inside their body, so they own a finite operational
 * budget for the 60 second native admission and retirement. Ordinary consumer bodies keep 30 seconds.
 * This test limit is not a performance requirement or a hard native close guarantee.
 */
const CONTROL_MS = 120_000

/** The controlled module implements the independently authored required capability family. */
const api = 'globalThis.browserTest = {run: () => 41, worker: () => 42, storage: () => 43}'

/** Route bytes model an authored page while the native browser owns module fetching and evaluation. */
async function document(context: BrowserContext, source: string): Promise<void> {
  await context.route('**/integration/browser/index.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><script type="module">${source}</script>`,
    }))
}

/** Captures arbitrary rejections, including undefined, without accepting a fulfilled operation. */
async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation
  } catch (error) {
    return error
  }
  throw new Error('Expected native fixture admission to reject.')
}

test(
  'admission waits for an actual requested module before handing over its owned page',
  async ({ context }, info) => {
    test.setTimeout(CONTROL_MS)
    let arrived!: () => void
    let rejectArrival!: (reason: unknown) => void
    let approve!: () => void
    const arrival = new Promise<void>((resolve, reject) => {
      arrived = resolve
      rejectArrival = reject
    })
    const approval = new Promise<void>((resolve) => approve = resolve)
    await document(context, "await import('/fixture-ready.js')")
    await context.route('**/fixture-ready.js', async (route) => {
      arrived()
      await approval
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: api })
    })
    const initial = context.pages().length
    let invoked = false
    // The gate is released even if an assertion fails; native owner still retires the page.
    await finish(async (releases) => {
      releases.push(() => approve())
      const pending = own(context, 'consumer', async (page) => {
        invoked = true
        expect(
          await page.evaluate(() => {
            const value: unknown = Reflect.get(globalThis, 'browserTest')
            if (!value || typeof value !== 'object') throw new TypeError('Fixture API missing.')
            return Reflect.get(value, 'run')()
          }),
        ).toBe(41)
      }, info)
      // Observe setup rejection immediately, including undefined/null reasons,
      // so a failed page/module cannot leave the unrelated arrival gate pending.
      let failed = false
      let failure: unknown
      let observed = false
      const settlement = pending.then(() => {}, (error: unknown) => {
        failed = true
        failure = error
        rejectArrival(error)
      })
      releases.push(async () => {
        approve()
        await settlement
        if (failed && !observed) throw failure
      })
      try {
        await arrival
        expect(invoked).toBe(false)
        approve()
        await settlement
        if (failed) throw failure
      } catch (error) {
        if (failed && error === failure) observed = true
        throw error
      }
    })
    expect(invoked).toBe(true)
    expect(context.pages()).toHaveLength(initial)
  },
)

test(
  'a truthy malformed API rejects and retires only the acquired page',
  async ({ context }, info) => {
    test.setTimeout(CONTROL_MS)
    await document(context, 'globalThis.browserTest = {run: true, worker() {}, storage() {}}')
    const initial = context.pages().length
    let invoked = false
    const error = await rejection(own(context, 'consumer', () => {
      invoked = true
    }, info))
    expect(error).toBeInstanceOf(AdmissionError)
    if (!(error instanceof AdmissionError)) throw error
    expect(error.kind).toBe('shape')
    expect(error.phase).toBe('root')
    expect(invoked).toBe(false)
    expect(context.pages()).toHaveLength(initial)
    await finish(async (releases) => {
      const next = await context.newPage()
      releases.push(() => next.close())
      await next.setContent('<p>borrowed context is usable</p>')
      expect(await next.locator('p').textContent()).toBe('borrowed context is usable')
    })
  },
)

test(
  'a completed authored script404 retains its actual selected-resource load failure',
  async ({ context }, info) => {
    test.setTimeout(CONTROL_MS)
    const path = '/fixture-missing.js'
    await document(context, `await import('${path}')`)
    let handling: Promise<void> | undefined
    let fulfilled = 0
    await finish(async (releases) => {
      // own() retires its acquired page before this scope drains a failed fulfillment.
      releases.push(async () => {
        if (handling !== undefined) await handling
      })
      await context.route(`**${path}`, (route) => {
        handling = (async () => {
          await route.fulfill({ status: 404, contentType: 'text/javascript', body: '' })
          fulfilled += 1
        })()
        void handling.catch(() => {})
        return handling
      })
      let invoked = false
      const error = await rejection(own(context, 'consumer', () => {
        invoked = true
      }, info))
      if (handling !== undefined) await handling
      expect(error).toBeInstanceOf(AdmissionError)
      if (!(error instanceof AdmissionError)) throw error
      expect(error.kind).toBe('load')
      expect(invoked).toBe(false)
      expect(fulfilled).toBe(1)
      // Firefox can surface selected-script404 as request failure instead of a Response.
      // Unrelated page exceptions cannot stand in for that exact native resource observation.
      expect(error.faults.some((fault) =>
        fault.resource === 'script' && fault.url !== undefined &&
        new URL(fault.url).pathname === path &&
        ((fault.kind === 'http' && fault.status === 404) || fault.kind === 'requestfailed')
      )).toBe(true)
    })
  },
)

test('an authored script exception retains native failure diagnostics', async ({ context, page }) => {
  test.setTimeout(CONTROL_MS)
  await document(context, 'throw new TypeError("authored script fault")')
  const error = await rejection(open(page, 'consumer'))
  expect(error).toBeInstanceOf(AdmissionError)
  if (!(error instanceof AdmissionError)) throw error
  expect(error.kind).toBe('load')
  expect(error.faults).toContainEqual(
    expect.objectContaining({ kind: 'pageerror', name: 'TypeError' }),
  )
})

test('missing publication expires instead of admitting an empty document', async ({ context, page }) => {
  test.setTimeout(CONTROL_MS)
  await document(context, 'globalThis.fixtureLoaded = true')
  await page.goto('/integration/browser/index.html', { waitUntil: 'domcontentloaded' })
  expect(await page.evaluate(() => Reflect.get(globalThis, 'fixtureLoaded'))).toBe(true)
  const error = await rejection(open(page, 'consumer', { navigate: false, timeoutMs: 1000 }))
  expect(error).toBeInstanceOf(AdmissionError)
  if (!(error instanceof AdmissionError)) throw error
  expect(error.kind).toBe('expired')
  expect(error.phase).toBe('root')
  expect(await page.evaluate(() => Reflect.get(globalThis, 'fixtureLoaded'))).toBe(true)
})

test('optional markup import fails admission before semantic comparison', async ({ context, page }) => {
  test.setTimeout(CONTROL_MS)
  await document(context, api)
  await context.route('**/packages/rdf/markup.ts', (route) => route.abort('failed'))
  const error = await rejection(open(page, 'markup'))
  expect(error).toBeInstanceOf(AdmissionError)
  if (!(error instanceof AdmissionError)) throw error
  expect(error.kind).toBe('load')
  expect(error.phase).toBe('markup')
  expect(error.faults).toContainEqual(
    expect.objectContaining({ kind: 'requestfailed', resource: 'script' }),
  )
})

test('an unrelated image request failure does not replace authored readiness', async ({ context, page }) => {
  test.setTimeout(CONTROL_MS)
  await document(
    context,
    `
    globalThis.imageSettled = new Promise((resolve) => {
      const image = new Image()
      image.onerror = () => resolve(true)
      image.src = '/fixture-image.png'
    })
    await globalThis.imageSettled
    ${api}
  `,
  )
  await context.route('**/fixture-image.png', (route) => route.abort('failed'))
  await open(page, 'consumer')
  expect(await page.evaluate(() => Reflect.get(globalThis, 'imageSettled'))).toBe(true)
})

test(
  'a required document HTTP failure settles navigation before owned page retirement',
  async ({ context }, info) => {
    test.setTimeout(CONTROL_MS)
    await context.route('**/integration/browser/index.html', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: `<!doctype html><script>${api}</script>`,
      }))
    const initial = context.pages().length
    let acquired = 0
    let closed = 0
    let invoked = false
    const onPage = (page: Page): void => {
      acquired += 1
      page.once('close', () => closed += 1)
    }
    context.on('page', onPage)
    let error: unknown
    try {
      error = await rejection(own(context, 'consumer', () => {
        invoked = true
      }, info))
    } finally {
      context.off('page', onPage)
    }
    expect(error).toBeInstanceOf(AdmissionError)
    if (!(error instanceof AdmissionError)) throw error
    expect(error.kind).toBe('load')
    expect(error.phase).toBe('navigate')
    expect(error.faults).toContainEqual(
      expect.objectContaining({
        kind: 'http',
        resource: 'document',
        status: 404,
        source: 'navigation',
      }),
    )
    expect(invoked).toBe(false)
    expect(acquired).toBe(1)
    expect(closed).toBe(1)
    expect(context.pages()).toHaveLength(initial)
    await finish(async (releases) => {
      const next = await context.newPage()
      releases.push(() => next.close())
      await next.setContent('<p>borrowed context remains usable</p>')
      expect(await next.locator('p').textContent()).toBe('borrowed context remains usable')
    })
  },
)

/** Pure protocol boundaries remain covered even when an engine chooses unconditional reload. */
test('HTTP admission classifies revalidation independently of the browser reload policy', () => {
  const cases = [
    [200, false],
    [299, false],
    [300, false],
    [304, false],
    [399, false],
    [400, true],
    [404, true],
    [500, true],
    [599, true],
  ] as const
  for (const [status, failed] of cases) {
    expect(httpFailure({ status: () => status })).toBe(failed)
  }
})

test(
  'a native reload admits fresh or revalidated fixture representations',
  async ({ context }, info) => {
    test.setTimeout(CONTROL_MS)
    await finish(async (releases) => {
      const path = `/conditional-${crypto.randomUUID()}.html`
      const tag = '"native-cache-v1"'
      const body = `<!doctype html><p id="oracle">cached authored representation</p><script>
      ${api}
      globalThis.fixtureRealm = crypto.randomUUID()
    </script>`
      const bytes = new TextEncoder().encode(body)
      const requests: Array<{ method: string; condition: string | undefined }> = []
      const completed: number[] = []
      const finishes: Promise<void>[] = []
      const failures: unknown[] = []
      let omitted = 0
      const retain = (error: unknown): void => {
        if (failures.length < 16) failures.push(error)
        else omitted += 1
      }
      const server = createServer((request: IncomingMessage, response: ServerResponse) => {
        request.on('error', retain)
        response.on('error', retain)
        if (request.url !== path) {
          response.writeHead(204)
          response.end()
          return
        }
        // Admit only finite selected responses and observe finish/error/close before sending.
        if (finishes.length < 8) {
          const finishing = new Promise<void>((resolve, reject) => {
            let finished = false
            response.once('finish', () => {
              finished = true
              completed.push(response.statusCode)
              resolve()
            })
            response.once('error', reject)
            response.once('close', () => {
              if (!finished) reject(new Error('Conditional response closed before native finish.'))
            })
          })
          void finishing.catch(() => {})
          finishes.push(finishing)
        }
        const condition = request.headers['if-none-match']
        if (requests.length >= 8 || (condition !== undefined && typeof condition !== 'string')) {
          retain(new Error('Conditional fixture request admission exceeded its finite shape.'))
          response.writeHead(400)
          response.end()
          return
        }
        requests.push({ method: request.method ?? '', condition })
        const headers = {
          'Content-Type': 'text/html; charset=utf-8',
          ETag: tag,
          'Cache-Control': 'no-cache',
        }
        if (condition === tag) {
          response.writeHead(304, headers)
          response.end()
        } else {
          response.writeHead(200, { ...headers, 'Content-Length': String(bytes.byteLength) })
          response.end(bytes)
        }
      })
      server.on('error', retain)
      server.on('clientError', (error, socket) => {
        retain(error)
        socket.destroy()
      })
      // Acquire retirement before listen. LIFO closes the later acquired page first.
      releases.push(async () => {
        const cleanup: unknown[] = []
        let closing: Promise<void> | undefined
        if (server.listening) {
          closing = new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve())
          })
          void closing.catch(() => {})
        }
        // Stop acceptance first, then retire only this server's established sockets.
        try {
          server.closeAllConnections()
        } catch (error) {
          cleanup.push(error)
        }
        if (closing !== undefined) {
          try {
            await closing
          } catch (error) {
            cleanup.push(error)
          }
        }
        for (const result of await Promise.allSettled(finishes)) {
          if (result.status === 'rejected' && !failures.includes(result.reason)) {
            cleanup.push(result.reason)
          }
        }
        cleanup.unshift(...failures)
        if (omitted > 0) {
          cleanup.push(new Error(`${omitted} further conditional fixture failures were observed.`))
        }
        if (cleanup.length === 1) throw cleanup[0]
        if (cleanup.length > 1) {
          throw new AggregateError(cleanup, 'Conditional fixture native failures.')
        }
      })
      await new Promise<void>((resolve, reject) => {
        const failed = (error: unknown): void => {
          server.off('listening', listening)
          reject(error)
        }
        const listening = (): void => {
          server.off('error', failed)
          resolve()
        }
        server.once('error', failed)
        server.once('listening', listening)
        server.listen(0, '127.0.0.1')
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Conditional fixture has no native TCP address.')
      }
      const url = `http://127.0.0.1:${address.port}${path}`
      const initial = context.pages().length
      let closed = 0
      const deadline = performance.now() + ADMISSION_MS
      await finish(async (pages) => {
        const page = await context.newPage()
        pages.push(() => page.close())
        page.once('close', () => closed += 1)
        const statuses: number[] = []
        page.on('response', (response) => {
          if (response.url() === url && response.request().isNavigationRequest()) {
            statuses.push(response.status())
          }
        })
        const remaining = (): number => {
          const value = Math.floor(deadline - performance.now())
          if (value <= 0) {
            throw new RangeError('Conditional fixture native admission deadline expired.')
          }
          return value
        }
        await open(page, 'consumer', { url, timeoutMs: remaining() })
        const read = async (): Promise<
          { realm: unknown; values: unknown[]; text: string | null }
        > => {
          return await page.evaluate(() => {
            const value: unknown = Reflect.get(globalThis, 'browserTest')
            if (!value || typeof value !== 'object') throw new TypeError('Fixture API missing.')
            return {
              realm: Reflect.get(globalThis, 'fixtureRealm'),
              values: ['run', 'worker', 'storage'].map((key) => Reflect.get(value, key)()),
              text: globalThis.document.querySelector('#oracle')?.textContent ?? null,
            }
          })
        }
        const first = await read()
        expect(first.values).toEqual([41, 42, 43])
        expect(first.text).toBe('cached authored representation')
        expect(typeof first.realm).toBe('string')
        await open(page, 'consumer', { reload: true, timeoutMs: remaining() })
        const second = await read()
        expect(second.values).toEqual(first.values)
        expect(second.text).toBe(first.text)
        expect(typeof second.realm).toBe('string')
        expect(second.realm).not.toBe(first.realm)
        expect(requests).toHaveLength(2)
        expect(requests.map((request) => request.method)).toEqual(['GET', 'GET'])
        expect(requests[0]?.condition).toBeUndefined()
        expect([undefined, tag]).toContain(requests[1]?.condition)
        await Promise.all(finishes)
        // The server owns this protocol oracle; reload policy remains the browser's authority.
        expect(completed).toEqual([200, requests[1]?.condition === tag ? 304 : 200])
        // Browser cache instrumentation may expose the network304 or reconstructed200.
        expect(statuses.length).toBeGreaterThanOrEqual(2)
        expect(statuses.every((status) => status === 200 || status === 304)).toBe(true)
        await info.attach('conditional-navigation', {
          body: JSON.stringify({
            requests,
            completed,
            statuses,
            freshRealm: second.realm !== first.realm,
          }),
          contentType: 'application/json',
        })
      })
      expect(closed).toBe(1)
      expect(context.pages()).toHaveLength(initial)
    })
  },
)

test('required fixture functions admit independent callable and metadata extensions', async ({ context, page }) => {
  test.setTimeout(CONTROL_MS)
  await document(
    context,
    `${api}; browserTest.extra = () => 44; browserTest.metadata = {version: 1}`,
  )
  await open(page, 'consumer')
  expect(
    await page.evaluate(() => {
      const value: unknown = Reflect.get(globalThis, 'browserTest')
      if (!value || typeof value !== 'object') throw new TypeError('Fixture API missing.')
      return {
        required: ['run', 'worker', 'storage'].map((name) => Reflect.get(value, name)()),
        extra: Reflect.get(value, 'extra')(),
        metadata: Reflect.get(value, 'metadata'),
      }
    }),
  ).toEqual({ required: [41, 42, 43], extra: 44, metadata: { version: 1 } })
})
