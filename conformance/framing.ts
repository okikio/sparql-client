/** JSON-LD 1.1 Framing conformance runner over the public facade. @module */

import * as jsonld from '@okikio/rdf/jsonld'
import type { CaseType } from './result.ts'
import { matchJson } from './json.ts'
import { source, sourceDir } from './source.ts'

interface ManifestType {
  readonly baseIri?: string
  readonly sequence?: readonly TestType[]
}
interface TestType {
  readonly '@id'?: string
  readonly '@type'?: string | readonly string[]
  readonly name?: string
  readonly input?: string
  readonly frame?: string
  readonly expect?: string
  readonly expectErrorCode?: string
  readonly option?: Readonly<Record<string, unknown>>
}

/** Runs every case in the pinned W3C JSON-LD Framing manifest. */
export async function runFraming(): Promise<CaseType[]> {
  const manifest = await json<ManifestType>(`${sourceDir('framing')}/tests/frame-manifest.jsonld`)
  const output: CaseType[] = []
  for (const test of manifest.sequence ?? []) output.push(await runCase(test, manifest))
  return output
}

async function runCase(test: TestType, manifest: ManifestType): Promise<CaseType> {
  const spec = source('framing')
  const started = performance.now()
  const id = test['@id'] ?? test.name ?? 'unnamed'
  const common = {
    suite: 'framing',
    revision: spec.revision,
    profile: 'JSON-LD 1.1 Framing',
    id,
    kind: types(test).join(' '),
    ...(test.input ? { input: test.input } : {}),
    ...(test.expect ? { expected: test.expect } : {}),
  }
  if (!test.input || !test.frame) {
    return {
      ...common,
      status: 'skip',
      reason: 'Framing case has no input or frame.',
      durationMs: performance.now() - started,
    }
  }
  try {
    const base = manifest.baseIri ?? source('framing').web
    const input = await json<unknown>(file(test.input))
    const frame = await json<unknown>(file(test.frame))
    const actual = await jsonld.frame(input, frame, options(test.option, base))
    if (test.expectErrorCode) {
      return {
        ...common,
        status: 'fail',
        reason: `Expected JSON-LD error '${test.expectErrorCode}' but framing succeeded.`,
        durationMs: performance.now() - started,
      }
    }
    if (!test.expect) return { ...common, status: 'pass', durationMs: performance.now() - started }
    const expected = await json<unknown>(file(test.expect))
    return matchJson(actual, expected, Boolean(test.option?.ordered))
      ? { ...common, status: 'pass', durationMs: performance.now() - started }
      : {
        ...common,
        status: 'fail',
        actual: preview(actual),
        reason: 'Framing result differs from the official expected result.',
        durationMs: performance.now() - started,
      }
  } catch (error) {
    if (test.expectErrorCode) {
      const code = errorCode(error)
      return code === test.expectErrorCode
        ? { ...common, status: 'pass', durationMs: performance.now() - started }
        : {
          ...common,
          status: 'fail',
          reason: `Expected error '${test.expectErrorCode}', received '${code ?? message(error)}'.`,
          durationMs: performance.now() - started,
        }
    }
    return {
      ...common,
      status: 'fail',
      reason: message(error),
      durationMs: performance.now() - started,
    }
  }
}

function options(
  value: Readonly<Record<string, unknown>> | undefined,
  base: string,
): jsonld.OptionsType {
  const option = value ?? {}
  return {
    base: typeof option.base === 'string' ? option.base : base,
    remote: true,
    fetch: suiteFetch(),
    maxDocuments: 256,
    maxBytes: 16 * 1024 * 1024,
    maxRedirects: 16,
    ...(typeof option.processingMode === 'string'
      ? { processingMode: option.processingMode as jsonld.ProcessingModeType }
      : {}),
    ...(typeof option.compactArrays === 'boolean' ? { compactArrays: option.compactArrays } : {}),
    ...(typeof option.ordered === 'boolean' ? { ordered: option.ordered } : {}),
    ...(typeof option.embed === 'string' || typeof option.embed === 'boolean'
      ? { embed: option.embed as jsonld.EmbedType }
      : {}),
    ...(typeof option.explicit === 'boolean' ? { explicit: option.explicit } : {}),
    ...(typeof option.frameDefault === 'boolean' ? { frameDefault: option.frameDefault } : {}),
    ...(typeof option.omitDefault === 'boolean' ? { omitDefault: option.omitDefault } : {}),
    ...(typeof option.omitGraph === 'boolean' ? { omitGraph: option.omitGraph } : {}),
    ...(typeof option.requireAll === 'boolean' ? { requireAll: option.requireAll } : {}),
  }
}

function suiteFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(String(input))
    const local = localPath(url)
    let bytes: Uint8Array
    try {
      bytes = await Deno.readFile(local)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return new Response('not found', { status: 404 })
      throw error
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': media(local) } })
  }
}

function localPath(url: URL): string {
  const framing = '/json-ld-framing/tests/'
  const api = '/json-ld-api/tests/'
  const frameIndex = url.pathname.indexOf(framing)
  if (frameIndex >= 0) {
    return `${sourceDir('framing')}/tests/${url.pathname.slice(frameIndex + framing.length)}`
  }
  const apiIndex = url.pathname.indexOf(api)
  if (apiIndex >= 0) {
    return `${sourceDir('jsonld')}/tests/${url.pathname.slice(apiIndex + api.length)}`
  }
  throw new TypeError(`Framing test URL is outside pinned suites: ${url.href}`)
}

function media(path: string): string {
  if (path.endsWith('.jsonld')) return 'application/ld+json'
  if (path.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}
function types(test: TestType): readonly string[] {
  const value = test['@type']
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
}
function file(path: string): string {
  return `${sourceDir('framing')}/tests/${path}`
}
async function json<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T
}
function preview(value: unknown): string {
  return JSON.stringify(value)?.slice(0, 4096) ?? String(value)
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = error as { code?: unknown; details?: { code?: unknown } }
  if (typeof value.details?.code === 'string') return value.details.code
  return typeof value.code === 'string' ? value.code : undefined
}
