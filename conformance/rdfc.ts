/** Official RDF Dataset Canonicalization 1.0 suite runner. @module */

import { canonicalize, type DigestType } from '@okikio/rdf/canon'
import { parse as parseNQuads } from '@okikio/rdf/nquads'
import type { Quad } from '@okikio/rdf'
import { localPath, readTree } from './manifest.ts'
import type { CaseType } from './result.ts'
import { source, sourceDir } from './source.ts'

export async function runRdfc(): Promise<CaseType[]> {
  const spec = source('canon')
  const entries = await readTree(`${sourceDir('canon')}/tests/manifest.ttl`)
  const output: CaseType[] = []
  for (const entry of entries) {
    const started = performance.now()
    const common = {
      suite: 'canon',
      revision: spec.revision,
      profile: 'RDFC-1.0',
      id: entry.id,
      kind: entry.types.join(' '),
      ...(entry.action ? { input: entry.action } : {}),
      ...(entry.result ? { expected: entry.result } : {}),
    }
    const kind = entry.types.join(' ')
    const negative = kind.includes('Negative')
    if (!entry.action || (!entry.result && !negative)) {
      output.push({
        ...common,
        status: 'skip',
        reason: 'Manifest entry lacks action or result.',
        durationMs: performance.now() - started,
      })
      continue
    }
    try {
      const quads = await quadsFrom(localPath(entry.action))
      const messageDigestAlgorithm = digest(entry.hashAlgorithm)
      if (negative) {
        let rejected = false
        try {
          // The poison vector specifies bounded-work rejection. Removing the
          // bound makes the test exponential instead of exercising its contract.
          await canonicalize(quads, { messageDigestAlgorithm })
        } catch (error) {
          rejected = error instanceof RangeError && error.message.includes('work limit')
        }
        output.push(
          rejected ? { ...common, status: 'pass', durationMs: performance.now() - started } : {
            ...common,
            status: 'fail',
            reason: 'Negative canonicalization case was accepted.',
            durationMs: performance.now() - started,
          },
        )
        continue
      }
      if (kind.includes('MapTest')) {
        const canonicalIdMap = new Map<string, string>()
        await canonicalize(quads, {
          canonicalIdMap,
          messageDigestAlgorithm,
          maxWorkFactor: Infinity,
        })
        const actual = Object.fromEntries([...canonicalIdMap].sort(([a], [b]) => codepoint(a, b)))
        const expectedRaw = JSON.parse(await Deno.readTextFile(localPath(entry.result!))) as Record<
          string,
          string
        >
        const expected = Object.fromEntries(
          Object.entries(expectedRaw).sort(([a], [b]) => codepoint(a, b)),
        )
        output.push(
          JSON.stringify(actual) === JSON.stringify(expected)
            ? { ...common, status: 'pass', durationMs: performance.now() - started }
            : {
              ...common,
              status: 'fail',
              actual: JSON.stringify(actual),
              reason: 'Canonical identifier map differs.',
              durationMs: performance.now() - started,
            },
        )
        continue
      }
      const actual = await canonicalize(quads, { messageDigestAlgorithm, maxWorkFactor: Infinity })
      const expected = await Deno.readTextFile(localPath(entry.result!))
      output.push(
        actual === expected
          ? { ...common, status: 'pass', durationMs: performance.now() - started }
          : {
            ...common,
            status: 'fail',
            actual: actual.slice(0, 4096),
            reason: 'Canonical N-Quads differs.',
            durationMs: performance.now() - started,
          },
      )
    } catch (error) {
      output.push({
        ...common,
        status: 'fail',
        reason: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - started,
      })
    }
  }
  return output
}

/** Manifest digest names are protocol data; an unknown value must not silently use SHA-256. */
function digest(value: string | undefined): DigestType {
  const normalized = (value ?? 'SHA256').toLowerCase().replaceAll('-', '')
  if (normalized === 'sha256' || normalized === 'sha384' || normalized === 'sha512') {
    return normalized
  }
  throw new TypeError(`Unsupported RDFC manifest hash algorithm '${value}'.`)
}

/** Compares strings by Unicode scalar value for specification-defined deterministic ordering. */
function codepoint(left: string, right: string): number {
  if (left === right) return 0
  const a = left[Symbol.iterator](), b = right[Symbol.iterator]()
  while (true) {
    const av = a.next(), bv = b.next()
    if (av.done) return bv.done ? 0 : -1
    if (bv.done) return 1
    const ac = av.value.codePointAt(0)!, bc = bv.value.codePointAt(0)!
    if (ac !== bc) return ac < bc ? -1 : 1
  }
}

async function quadsFrom(path: string): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of parseNQuads(await Deno.readTextFile(path))) output.push(value)
  return output
}
