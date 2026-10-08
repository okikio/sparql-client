/** Test-owned page acquisition with native fixture time and independent retirement. @module */
import { test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { finish } from '../releases.ts'
import { ADMISSION_MS, AdmissionError, FIXTURE_MS, open } from './ready.ts'
import type { EntryType } from './ready.ts'

/** One selected authored module graph is admitted before the ordinary behavioral test clock. */
export type FixtureType = { entry: EntryType }

/**
 * Creates exactly one page, registers close before setup, and borrows the context.
 * Native pending newPage and close have no local cancellation option; the
 * framework fixture deadline and outer runner own those terminal observations.
 * The runner owns attachment paths. A failed attachment and page close cannot
 * replace the original admission failure or suppress one another.
 */
export async function own(
  context: BrowserContext,
  entry: EntryType,
  use: (page: Page) => void | PromiseLike<void>,
  info: TestInfo,
): Promise<void> {
  await finish(async (releases) => {
    const started = performance.now()
    const page = await context.newPage()
    releases.push(() => page.close())
    try {
      const remaining = Math.floor(ADMISSION_MS - (performance.now() - started))
      if (remaining <= 0) {
        throw new AdmissionError(
          'expired',
          entry,
          'page',
          [],
          0,
          new Error('Native page acquisition exhausted admission.'),
        )
      }
      await open(page, entry, { timeoutMs: remaining })
    } catch (error) {
      if (error instanceof AdmissionError) {
        releases.push(() =>
          info.attach('browser-admission', {
            body: JSON.stringify({
              code: error.code,
              kind: error.kind,
              entry: error.entry,
              phase: error.phase,
              faults: error.faults,
              omitted: error.omitted,
            }),
            contentType: 'application/json',
          })
        )
      }
      throw error
    }
    await use(page)
  })
}

/** Default pages preload only the authored consumer; optional graphs require an explicit option. */
export const test = base.extend<FixtureType>({
  entry: ['consumer', { option: true }],
  page: [async ({ context, entry }, use, info) => {
    await own(context, entry, use, info)
  }, { scope: 'test', timeout: FIXTURE_MS }],
})
