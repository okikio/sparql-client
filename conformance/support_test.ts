import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { report } from './result.ts'
import { validateSupport } from './support.ts'

const original = {
  suite: 'rdf',
  revision: 'pinned',
  profile: 'example',
  id: 'urn:case',
  kind: 'evaluation',
}
const current = {
  expected: [original],
  inputs: 'a'.repeat(64),
  revisions: { rdf: 'pinned' },
  profiles: { example: 'rdf' },
}
const claims = { version: 1, profiles: [{ id: 'native', evidence: 'example', kind: 'native' }] }
const passing = report([{
  suite: 'rdf',
  revision: 'pinned',
  profile: 'example',
  id: 'urn:case',
  kind: 'evaluation',
  status: 'pass',
  durationMs: 0,
}], current.inputs)

/** Clone fixtures before mutation so every control starts from independently valid evidence. */
function copy(): Record<string, unknown> {
  return structuredClone(passing) as unknown as Record<string, unknown>
}

describe('current support evidence', () => {
  it('accepts current evidence independently of claim and case order', () => {
    expect(validateSupport(claims, passing, current)).toEqual([])
    const expandedClaims = {
      ...claims,
      profiles: [...claims.profiles, { id: 'second', evidence: 'other', kind: 'native' }],
    }
    const expandedCurrent = {
      ...current,
      profiles: { example: 'rdf', other: 'rdf' },
      expected: [original, { ...original, id: 'urn:second', profile: 'other' }],
    }
    const expandedReport = report([
      passing.cases[0]!,
      { ...passing.cases[0]!, id: 'urn:second', profile: 'other' },
    ], current.inputs)
    expect(validateSupport(expandedClaims, expandedReport, expandedCurrent)).toEqual([])
    expect(validateSupport(
      { ...expandedClaims, profiles: [...expandedClaims.profiles].reverse() },
      { ...expandedReport, cases: [...expandedReport.cases].reverse() },
      expandedCurrent,
    )).toEqual([])
    const reused = report([
      { ...passing.cases[0]!, input: 'expand/0001.jsonld', actual: '', expected: '' },
      { ...passing.cases[0]!, input: 'remote-doc/0001.jsonld', kind: 'html evaluation' },
    ], current.inputs)
    expect(validateSupport(claims, reused, { ...current, expected: reused.cases })).toEqual([])
  })

  it('rejects removed or substituted assertions even when source identity and totals match', () => {
    const second = { ...original, id: 'urn:second', input: 'second.nt' }
    const authority = { ...current, expected: [original, second] }
    const complete = report(
      [passing.cases[0]!, { ...second, status: 'pass', durationMs: 0 }],
      current.inputs,
    )
    expect(validateSupport(claims, complete, authority)).toEqual([])
    expect(validateSupport(claims, report([passing.cases[0]!], current.inputs), authority).length)
      .toBeGreaterThan(0)
    for (
      const change of [{ id: 'urn:substitution' }, { input: 'wrong.nt' }, { kind: 'parse-only' }]
    ) {
      const substituted = report(
        [passing.cases[0]!, { ...complete.cases[1]!, ...change }],
        current.inputs,
      )
      expect(substituted.totals).toEqual(complete.totals)
      expect(validateSupport(claims, substituted, authority).length).toBeGreaterThan(0)
    }
  })

  it('rejects malformed reports, unknown status, and stale source or revision', () => {
    for (
      const input of [null, {}, { ...passing, version: 1 }, { ...passing, inputs: 'stale' }, {
        ...passing,
        createdAt: 'not a date',
      }, { ...passing, cases: [] }]
    ) {
      expect(validateSupport(claims, input, current).length).toBeGreaterThan(0)
    }
    for (
      const change of [
        { status: 'unknown' },
        { revision: 'old' },
        { suite: 'unknown' },
        { profile: 'unknown' },
        { durationMs: NaN },
        { durationMs: -1 },
        { id: '' },
        { reason: {} },
      ]
    ) {
      const value = copy()
      value.cases = [{ ...passing.cases[0], ...change }]
      expect(validateSupport(claims, value, current).length).toBeGreaterThan(0)
    }
    const mixed = copy()
    mixed.cases = [...passing.cases, { ...passing.cases[0], id: 'urn:second', status: 'invalid' }]
    expect(validateSupport(claims, mixed, current).length).toBeGreaterThan(0)
  })

  it('rejects fail, skip, missing profiles, duplicate cases, and inconsistent totals', () => {
    for (const status of ['fail', 'skip'] as const) {
      const value = report([{ ...passing.cases[0]!, status }], current.inputs)
      expect(validateSupport(claims, value, current).length).toBeGreaterThan(0)
    }
    expect(validateSupport(claims, passing, { ...current, profiles: { example: 'jsonld' } }).length)
      .toBeGreaterThan(0)
    expect(
      validateSupport(
        {
          ...claims,
          profiles: [...claims.profiles, {
            id: 'missing',
            kind: 'native',
            evidence: 'other',
          }],
        },
        passing,
        { ...current, profiles: { ...current.profiles, other: 'rdf' } },
      ).length,
    )
      .toBeGreaterThan(0)
    expect(
      validateSupport(claims, { ...passing, cases: [...passing.cases, ...passing.cases] }, current)
        .length,
    )
      .toBeGreaterThan(0)
    expect(
      validateSupport(claims, { ...passing, totals: { pass: 2, fail: 0, skip: 0 } }, current)
        .length,
    )
      .toBeGreaterThan(0)
  })

  it('rejects invalid or oversized claims and excessive case arrays without accepting partial evidence', () => {
    for (
      const input of [null, {}, { ...claims, version: 9 }, { ...claims, profiles: [] }, {
        ...claims,
        profiles: [claims.profiles[0], claims.profiles[0]],
      }, { ...claims, profiles: Array.from({ length: 1001 }, () => claims.profiles[0]) }]
    ) {
      expect(validateSupport(input, passing, current).length).toBeGreaterThan(0)
    }
    expect(validateSupport(claims, { ...passing, cases: Array(100_001) }, current).length)
      .toBeGreaterThan(0)
  })
})
