/** Checks claims against validated, current conformance source and pinned revisions. @module */
import { identity } from '../../conformance/identity.ts'
import { sources } from '../../conformance/source.ts'
import { validateSupport } from '../../conformance/support.ts'
import { profiles, readCatalog } from '../../conformance/catalog.ts'
import { checkCache } from '../../conformance/cache.ts'
import { sourceDir } from '../../conformance/source.ts'

const support: unknown = JSON.parse(await Deno.readTextFile('support.json'))
const report: unknown = JSON.parse(await Deno.readTextFile('.tmp/reports/conformance.json'))
for (const item of sources) await checkCache(sourceDir(item.id), item.revision)
const errors = validateSupport(support, report, {
  inputs: await identity(),
  revisions: Object.fromEntries(sources.map(({ id, revision }) => [id, revision])),
  profiles,
  expected: await readCatalog(),
})
if (errors.length) {
  throw new Error(
    `Support evidence is incomplete:\n${errors.map((value) => `- ${value}`).join('\n')}`,
  )
}
console.log('Verified support profiles against current conformance evidence.')
