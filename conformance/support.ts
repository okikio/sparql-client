/** Pure bounded validation of support claims and current conformance evidence. @module */

interface CurrentType {
  readonly inputs: string
  readonly revisions: Readonly<Record<string, string>>
  readonly profiles: Readonly<Record<string, string>>
}

/**
 * Returns reasons evidence cannot establish the claims. Unknown JSON is validated before use;
 * status counts never substitute for valid records, current revisions, or current source content.
 * Bounds cover this repository's corpus with room for additions while rejecting oversized input.
 */
export function validateSupport(support: unknown, report: unknown, current: CurrentType): string[] {
  const errors: string[] = []
  if (
    !record(support) || support.version !== 1 || !Array.isArray(support.profiles) ||
    support.profiles.length === 0 || support.profiles.length > 1000
  ) {
    return ['Support claims have an invalid version or profiles array.']
  }
  const claims = new Map<string, string>()
  const ids = new Set<string>()
  for (const claim of support.profiles) {
    if (
      !record(claim) || !text(claim.id) || !text(claim.evidence) || !text(claim.kind) ||
      ids.has(claim.id) || claims.has(claim.evidence) || !(claim.evidence in current.profiles)
    ) {
      return ['Support claims contain malformed, duplicate, or unknown profiles.']
    }
    ids.add(claim.id)
    claims.set(claim.evidence, claim.id)
  }
  if (
    !record(report) || report.version !== 2 || !text(report.createdAt) ||
    !Number.isFinite(Date.parse(report.createdAt)) || report.inputs !== current.inputs ||
    !Array.isArray(report.cases) || report.cases.length === 0 || report.cases.length > 100_000 ||
    !record(report.totals)
  ) {
    return ['Conformance report has invalid schema or stale source identity.']
  }
  const totals = { pass: 0, fail: 0, skip: 0 }
  const counts = new Map<string, number>()
  const cases = new Set<string>()
  for (const item of report.cases) {
    if (
      !record(item) || !text(item.suite) || !text(item.profile) || !text(item.id) ||
      !text(item.kind) || !text(item.revision) ||
      typeof item.status !== 'string' || !['pass', 'fail', 'skip'].includes(item.status) ||
      typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) ||
      item.durationMs < 0 ||
      item.revision !== current.revisions[item.suite] || !(item.profile in current.profiles) ||
      (item.profile in current.profiles && item.suite !== current.profiles[item.profile]) ||
      ['input', 'expected', 'actual', 'reason'].some((field) =>
        item[field] !== undefined &&
        (typeof item[field] !== 'string' || item[field].length > 16_384)
      )
    ) {
      return ['Conformance report contains malformed status, case, revision, or suite identity.']
    }
    const id = JSON.stringify([
      item.suite,
      item.profile,
      item.id,
      item.input,
      item.expected,
      item.kind,
    ])
    if (cases.has(id)) return ['Conformance report contains duplicate cases.']
    cases.add(id)
    const status = item.status as keyof typeof totals
    totals[status]++
    if (status !== 'pass') errors.push(`${item.profile}: ${status} case ${item.id}`)
    counts.set(item.profile, (counts.get(item.profile) ?? 0) + 1)
  }
  for (const status of ['pass', 'fail', 'skip'] as const) {
    if (report.totals[status] !== totals[status]) {
      errors.push(`Report ${status} total differs from cases.`)
    }
  }
  for (const [evidence, id] of claims) {
    if (!counts.has(evidence)) errors.push(`${id}: no conformance cases for '${evidence}'.`)
  }
  return errors
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384
}
