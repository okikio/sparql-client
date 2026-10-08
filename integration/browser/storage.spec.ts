import { expect } from '@playwright/test'
import { finish, test } from './profile.ts'
import type { browserTest } from './window.ts'
import { AdmissionError, open } from './ready.ts'

/** Optional fixture entrypoints become available after module initialization. */
type FixtureType = typeof globalThis & { browserTest: typeof browserTest }

test.use({ entry: 'storage' })

test(
  'real OPFS-backed RDF store compacts and reopens across page reload',
  async ({ page }, info) => {
    const deadline = performance.now() + info.timeout
    const available = await page.evaluate(async () =>
      (await (await fetch('/__sparql/capability')).json()).storage
    )
    test.skip(
      !available,
      'Set OPFS_SOURCE to the inspected OPFS checkout for the cross-repository storage lane.',
    )
    const path = `/browser-rdf-${crypto.randomUUID()}`
    await finish(async (releases) => {
      const written = await page.evaluate(
        ({ path }) => (globalThis as FixtureType).browserTest.storage('write', path),
        { path },
      )
      test.skip(
        !('supported' in written) || !written.supported,
        'Native OPFS is unavailable in this actual browser context.',
      )
      releases.push(() =>
        page.evaluate(
          ({ path }) => (globalThis as FixtureType).browserTest.storage('remove', path),
          { path },
        ).then(() => {})
      )
      expect(written).toMatchObject({
        supported: true,
        size: 1,
        borrowed: true,
        object: '零 café 😀',
        graph: 'urn:browser:g',
      })
      // Reload is still asserted behavior under the ordinary 30 second test clock.
      const remaining = Math.floor(deadline - performance.now())
      if (remaining <= 0) {
        throw new AdmissionError(
          'expired',
          'storage',
          'reload',
          [],
          0,
          new Error('Browser storage body deadline expired before reload.'),
        )
      }
      await open(page, 'storage', { reload: true, timeoutMs: remaining })
      const reopened = await page.evaluate(
        ({ path }) => (globalThis as FixtureType).browserTest.storage('read', path),
        { path },
      )
      expect(reopened).toEqual({
        size: 1,
        object: '零 café 😀',
        graph: 'urn:browser:g',
        language: 'fr',
      })
    })
  },
)
