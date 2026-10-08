/** Native admission controls protect fixture setup without invoking library scenarios. @module */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { AdmissionError, open } from './ready.ts'
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
