import { expect, test } from '@playwright/test'
import type { browserTest } from './window.ts'

/** Optional fixture entrypoints become available after module initialization. */
type FixtureType = typeof globalThis & { browserTest: typeof browserTest }

test('real OPFS-backed RDF store compacts and reopens across page reload', async ({ page }) => {
  await page.goto('/integration/browser/index.html')
  await page.waitForFunction(() => Boolean((globalThis as Partial<FixtureType>).browserTest))
  const available = await page.evaluate(async () =>
    (await (await fetch('/__sparql/capability')).json()).storage
  )
  test.skip(
    !available,
    'Set OPFS_SOURCE to the inspected OPFS checkout for the cross-repository storage lane.',
  )
  const path = `/browser-rdf-${crypto.randomUUID()}`
  let created = false
  try {
    const written = await page.evaluate(
      ({ path }) => (globalThis as FixtureType).browserTest.storage('write', path),
      { path },
    )
    test.skip(
      !('supported' in written) || !written.supported,
      'Native OPFS is unavailable in this actual browser context.',
    )
    created = true
    expect(written).toMatchObject({
      supported: true,
      size: 1,
      borrowed: true,
      object: '零 café 😀',
      graph: 'urn:browser:g',
    })
    await page.reload()
    await page.waitForFunction(() => Boolean((globalThis as Partial<FixtureType>).browserTest))
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
  } finally {
    if (created) {
      await page.evaluate(
        ({ path }) => (globalThis as FixtureType).browserTest.storage('remove', path),
        { path },
      )
    }
  }
})
