import { own, test as base } from './fixture.ts'
import { FIXTURE_MS } from './ready.ts'
import type { BrowserContext } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export { finish } from '../releases.ts'
import { finish } from '../releases.ts'

/**
 * Workers own disposable persistent contexts; tests own pages and unique store roots.
 * WebKit ephemeral contexts do not expose OPFS on the tested macOS host. This
 * fixture admits a real persistent profile without hiding absent capabilities.
 */
export const test = base.extend<object, { persistent: BrowserContext }>({
  persistent: [async ({ playwright, browserName }, use, worker) => {
    await finish(async (releases) => {
      const profile = await mkdtemp(join(tmpdir(), 'rdf-browser-'))
      releases.push(() => rm(profile, { recursive: true, force: true }))
      const context = await playwright[browserName].launchPersistentContext(profile, {
        headless: true,
        ...(worker.project.use.baseURL ? { baseURL: worker.project.use.baseURL } : {}),
      })
      releases.push(() => context.close())
      await use(context)
    })
  }, { scope: 'worker' }],
  context: async ({ persistent }, use) => {
    await use(persistent)
  },
  page: [async ({ context, entry }, use, info) => {
    await own(context, entry, use, info)
  }, { scope: 'test', timeout: FIXTURE_MS }],
})
