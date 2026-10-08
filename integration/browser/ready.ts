/** Native document admission, separate from library behavior and test-owned disposal. @module */
import { errors } from '@playwright/test'
import type { Page, Request, Response } from '@playwright/test'
import { finish } from '../releases.ts'

/** Each authored entry adds imports without opening a filesystem or running a consumer scenario. */
export type EntryType = 'consumer' | 'markup' | 'storage'

/** Finite observations retained only while admitting authored document/module capabilities. */
export type FaultType = {
  kind: 'pageerror' | 'requestfailed' | 'http'
  url?: string
  resource?: string
  status?: number
  /** A returned main response remains distinct from an earlier response event. */
  source?: 'response' | 'navigation'
  name?: string
  message?: string
}

/** Structured admission failure preserves native cause without requiring error-prose assertions. */
export class AdmissionError extends Error {
  readonly code = 'browser-admission'
  constructor(
    readonly kind: 'expired' | 'load' | 'shape' | 'operation',
    readonly entry: EntryType,
    readonly phase: string,
    readonly faults: readonly FaultType[],
    readonly omitted: number,
    cause: unknown,
  ) {
    super(`Browser ${entry} admission failed in ${phase}: ${JSON.stringify(faults)}`, { cause })
    this.name = 'AdmissionError'
  }
}

/**
 * Completed acquisition shares a 60 second deadline. The native fixture's 90 second
 * setup/retirement slot leaves a nominal 30 second reserve, less framework overhead;
 * it does not promise that an uncancellable native close completes within 30 seconds.
 */
export const ADMISSION_MS = 60_000
/** Shared setup/retirement slot; the ordinary 30 second behavioral clock is separate. */
export const FIXTURE_MS = 90_000

/** Options change a native fixture admission, never a public package or global runner timeout. */
export type AdmissionOptionsType = {
  /** Navigation defaults to the authored fixture; controls may supply their own same-origin document. */
  url?: string
  /** Reload remains a behavioral operation; its caller retains the ordinary test deadline. */
  reload?: boolean
  /** A control can admit an already loaded borrowed document without repeating navigation. */
  navigate?: false
  /** Total native acquisition time, in milliseconds, shared across every phase. */
  timeoutMs?: number
}

/**
 * Admits one borrowed page through native Playwright navigation and numeric polling.
 *
 * The caller owns disposal. Owner expiry cancels finite native navigation; load
 * events latch until navigation settles, then reject before API dispatch. During
 * API admission, later load faults cancel the pending native wait. Already running
 * JavaScript imports have no separate cancellation
 * authority; the owning fixture retires its page on failure. Listeners stop
 * before behavioral assertions. Only same-origin document/script loads are
 * request authorities; unrelated image/fetch failures cannot replace readiness.
 * Page JavaScript errors during authored setup are retained as load failures.
 */
export async function open(
  page: Page,
  entry: EntryType,
  options: AdmissionOptionsType = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? ADMISSION_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > ADMISSION_MS) {
    throw new RangeError(
      'Browser admission timeout must be a positive integer no larger than 60,000 ms.',
    )
  }
  const deadline = performance.now() + timeoutMs
  const controller = new AbortController()
  const faults: FaultType[] = []
  let omitted = 0
  let phase = options.navigate === false ? 'root' : options.reload ? 'reload' : 'navigate'
  let kind: AdmissionError['kind'] = 'operation'
  let origin: string | undefined
  // A response event precedes native document commit/lifecycle settlement. Faults
  // latch during goto/reload; only a settled navigation hands cancellation to API waits.
  let navigating = false
  let loadFailed = false
  let loadCause: unknown
  const text = (value: string): string => value.slice(0, 4096)
  const observe = (
    fault: FaultType,
    cause: unknown = new Error('Authored browser fixture load failed.'),
  ): void => {
    if (faults.length < 16) faults.push(fault)
    else omitted += 1
    if (!loadFailed) {
      loadFailed = true
      loadCause = cause
    }
    kind = 'load'
    if (!navigating && !controller.signal.aborted) controller.abort(loadCause)
  }
  const authored = (request: Request): boolean => {
    if (!['document', 'script'].includes(request.resourceType())) return false
    const url = new URL(request.url())
    if (origin === undefined && request.isNavigationRequest()) origin = url.origin
    return url.origin === origin
  }
  const requested = (request: Request): void => {
    authored(request)
  }
  const failed = (request: Request): void => {
    if (authored(request)) {
      observe({
        kind: 'requestfailed',
        url: text(request.url()),
        resource: request.resourceType(),
        message: text(request.failure()?.errorText ?? ''),
      })
    }
  }
  const response = (value: Response): void => {
    if (value.status() >= 400 && authored(value.request())) {
      observe({
        kind: 'http',
        url: text(value.url()),
        resource: value.request().resourceType(),
        status: value.status(),
        source: 'response',
      })
    }
  }
  const error = (value: Error): void => {
    observe({ kind: 'pageerror', name: text(value.name), message: text(value.message) }, value)
  }
  const remaining = (): number => {
    const value = Math.ceil(deadline - performance.now())
    if (value <= 0) {
      if (!loadFailed) kind = 'expired'
      controller.abort(new Error('Browser fixture admission deadline expired.'))
      throw controller.signal.reason
    }
    return value
  }
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      if (!loadFailed) kind = 'expired'
      controller.abort(new Error('Browser fixture admission deadline expired.'))
    }
  }, timeoutMs)
  page.on('request', requested)
  page.on('requestfailed', failed)
  page.on('response', response)
  page.on('pageerror', error)
  try {
    if (options.reload || options.navigate === false) origin = new URL(page.url()).origin
    navigating = options.navigate !== false
    let navigation: Response | null
    try {
      navigation = options.navigate === false ? null : options.reload
        ? await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: remaining(),
          signal: controller.signal,
        })
        : await page.goto(options.url ?? '/integration/browser/index.html', {
          waitUntil: 'domcontentloaded',
          timeout: remaining(),
          signal: controller.signal,
        })
    } finally {
      navigating = false
    }
    // Retain the returned main response independently, even after an earlier load event.
    if (navigation && !navigation.ok()) {
      observe({
        kind: 'http',
        url: text(navigation.url()),
        resource: 'document',
        status: navigation.status(),
        source: 'navigation',
      })
    }
    // A faulty document never reaches API admission, even if it published callable methods.
    if (loadFailed) throw loadCause
    origin = new URL(page.url()).origin
    phase = 'root'
    await finish(async (releases) => {
      const root = await page.waitForFunction(
        () => {
          const api = (globalThis as typeof globalThis & { browserTest?: unknown }).browserTest
          if (api === undefined) return false
          const names = ['run', 'storage', 'worker']
          const valid = api !== null && typeof api === 'object' &&
            Object.keys(api).sort().join(',') === names.join(',') &&
            names.every((name) => typeof Reflect.get(api, name) === 'function')
          return { valid }
        },
        undefined,
        { polling: 50, timeout: remaining(), signal: controller.signal },
      )
      releases.push(() => root.dispose())
      const value = await root.jsonValue()
      if (!value || !value.valid) {
        kind = 'shape'
        throw new TypeError(
          'Authored browserTest requires exactly run, worker and storage functions.',
        )
      }
    })
    if (entry !== 'consumer') {
      phase = entry
      await finish(async (releases) => {
        const imported = await page.waitForFunction(
          async (entry) => {
            const uri = entry === 'markup'
              ? '/packages/rdf/markup.ts'
              : '/integration/browser/storage.ts'
            if (entry === 'storage') {
              const response = await fetch('/__sparql/capability')
              if (!response.ok) throw new Error('Storage capability admission failed.')
              const capability: unknown = await response.json()
              if (
                !capability || typeof capability !== 'object' ||
                typeof Reflect.get(capability, 'storage') !== 'boolean'
              ) {
                return { valid: false }
              }
              if (!Reflect.get(capability, 'storage')) return { valid: true }
            }
            const module: object = await import(/* @vite-ignore */ uri)
            const keys = entry === 'markup' ? ['parseMarkup'] : ['write', 'read', 'remove']
            if (!keys.every((key) => typeof Reflect.get(module, key) === 'function')) {
              return { valid: false }
            }
            if (entry === 'storage') {
              const specifier = '@okikio/opfs'
              const opfs: object = await import(/* @vite-ignore */ specifier)
              if (
                !['openFileSystem', 'probeOpfs'].every((key) =>
                  typeof Reflect.get(opfs, key) === 'function'
                )
              ) {
                return { valid: false }
              }
            }
            return { valid: true }
          },
          entry,
          { polling: 50, timeout: remaining(), signal: controller.signal },
        )
        releases.push(() => imported.dispose())
        if (!(await imported.jsonValue()).valid) {
          kind = 'shape'
          throw new TypeError('Authored optional module does not expose its selected capabilities.')
        }
      })
    }
    // A fault observed during a successful native operation still rejects admission.
    if (controller.signal.aborted) throw controller.signal.reason
  } catch (cause) {
    if (loadFailed) kind = 'load'
    if (
      !loadFailed && !controller.signal.aborted &&
      (performance.now() >= deadline || cause instanceof errors.TimeoutError)
    ) {
      kind = 'expired'
    }
    const retained = loadFailed && cause !== loadCause
      ? new AggregateError([loadCause, cause], 'Browser load and native operation failed.', {
        cause: loadCause,
      })
      : cause
    throw new AdmissionError(kind, entry, phase, faults, omitted, retained)
  } finally {
    clearTimeout(timer)
    page.off('request', requested)
    page.off('requestfailed', failed)
    page.off('response', response)
    page.off('pageerror', error)
  }
}
