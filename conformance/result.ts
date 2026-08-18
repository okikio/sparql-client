/** Normalized conformance result records. @module */

export type StatusType = 'pass' | 'fail' | 'skip'

export interface CaseType {
  readonly suite: string
  readonly revision: string
  readonly profile: string
  readonly id: string
  readonly kind: string
  readonly status: StatusType
  readonly input?: string
  readonly expected?: string
  readonly actual?: string
  readonly reason?: string
  readonly durationMs: number
}

export interface ReportType {
  readonly version: 1
  readonly createdAt: string
  readonly cases: readonly CaseType[]
  readonly totals: { readonly pass: number; readonly fail: number; readonly skip: number }
}

export function report(cases: readonly CaseType[]): ReportType {
  let pass = 0
  let fail = 0
  let skip = 0
  for (const value of cases) {
    if (value.status === 'pass') pass++
    else if (value.status === 'fail') fail++
    else skip++
  }
  return { version: 1, createdAt: new Date().toISOString(), cases, totals: { pass, fail, skip } }
}
