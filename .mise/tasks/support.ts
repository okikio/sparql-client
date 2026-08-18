/** Verifies that every standards claim backed by conformance evidence has passing cases and no skips. @module */

interface ProfileType {
  readonly id: string
  readonly package?: string
  readonly kind: string
  readonly evidence: string
}
interface SupportType {
  readonly version: number
  readonly profiles: readonly ProfileType[]
}
interface CaseType {
  readonly profile: string
  readonly status: 'pass' | 'fail' | 'skip'
}
interface ReportType {
  readonly cases: readonly CaseType[]
}

const support = JSON.parse(await Deno.readTextFile('support.json')) as SupportType
const report = JSON.parse(await Deno.readTextFile('.tmp/reports/conformance.json')) as ReportType
const errors: string[] = []
for (const profile of support.profiles) {
  const cases = report.cases.filter((value) => value.profile === profile.evidence)
  const fail = cases.filter((value) => value.status === 'fail').length
  const skip = cases.filter((value) => value.status === 'skip').length
  const pass = cases.filter((value) => value.status === 'pass').length
  if (cases.length === 0) {
    errors.push(`${profile.id}: no conformance cases for '${profile.evidence}'`)
  } else if (fail > 0 || skip > 0 || pass === 0) {
    errors.push(`${profile.id}: ${pass} pass, ${fail} fail, ${skip} skip`)
  }
}
if (errors.length > 0) {
  throw new Error(
    `Support evidence is incomplete:\n${errors.map((value) => `- ${value}`).join('\n')}`,
  )
}
console.log(`Verified ${support.profiles.length} support profiles against conformance evidence.`)
export {}
