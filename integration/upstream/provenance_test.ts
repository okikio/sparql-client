/** Keeps pinned datastore source and license attribution part of the maintained suite. @module */

import { after, it } from 'node:test'
import { expect } from '@std/expect'
import { inspectSources } from '../../bench/upstream/provenance.ts'

const original = await inspectSources()
after(async () => {
  expect(await inspectSources()).toEqual(original)
})
it('retains all pinned datastore and benchmark source bytes without extra snapshots', async () => {
  expect((await inspectSources()).count).toBeGreaterThan(0)
})
