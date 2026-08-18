/** JSON-LD 1.1 API conformance runner over the public `@okikio/rdf/jsonld` facade. @module */

import * as jsonld from '@okikio/rdf/jsonld'
import { parse as parseNQuads } from '@okikio/rdf/nquads'
import type { Quad } from '@okikio/rdf'
import type { CaseType } from './result.ts'
import { isomorphic } from './equal.ts'
import { matchJson } from './json.ts'
import { source, sourceDir } from './source.ts'

interface ManifestType {
  readonly name?: string
  readonly baseIri?: string
  readonly sequence?: readonly (string | TestType)[]
}

interface TestType {
  readonly '@id'?: string
  readonly '@type'?: string | readonly string[]
  readonly name?: string
  readonly input?: string
  readonly expect?: string
  readonly context?: string
  readonly frame?: string
  readonly expectErrorCode?: string
  readonly option?: Readonly<Record<string, unknown>>
}

export async function runJsonLd(): Promise<CaseType[]> {
  const root = await json<ManifestType>(`${sourceDir('jsonld')}/tests/manifest.jsonld`)
  const output: CaseType[] = []
  for (const item of root.sequence ?? []) {
    if (typeof item !== 'string') continue
    const path = `${sourceDir('jsonld')}/tests/${item}`
    const manifest = await json<ManifestType>(path)
    for (const test of manifest.sequence ?? []) {
      if (typeof test === 'string') continue
      output.push(await runCase(test, manifest, item))
    }
  }
  return output
}

async function runCase(
  test: TestType,
  manifest: ManifestType,
  manifestName: string,
): Promise<CaseType> {
  const spec = source('jsonld')
  const started = performance.now()
  const types = Array.isArray(test['@type'])
    ? test['@type']
    : [test['@type']].filter((value): value is string => typeof value === 'string')
  const operation = operationOf(types)
  const id = test['@id'] ?? `${manifestName}:${test.name ?? 'unnamed'}`
  const common = {
    suite: 'jsonld',
    revision: spec.revision,
    profile: `JSON-LD 1.1 ${operation}`,
    id,
    kind: types.join(' '),
    ...(test.input ? { input: test.input } : {}),
    ...(test.expect ? { expected: test.expect } : {}),
  }
  if (!operation || !test.input) {
    return {
      ...common,
      status: 'skip',
      reason: 'Unknown JSON-LD operation or missing input.',
      durationMs: performance.now() - started,
    }
  }

  try {
    const actual = await apply(operation, test, manifest)
    if (test.expectErrorCode) {
      return {
        ...common,
        status: 'fail',
        reason: `Expected JSON-LD error '${test.expectErrorCode}' but operation succeeded.`,
        durationMs: performance.now() - started,
      }
    }
    const passed = await compare(operation, actual, test)
    return passed ? { ...common, status: 'pass', durationMs: performance.now() - started } : {
      ...common,
      status: 'fail',
      actual: preview(actual),
      reason: 'JSON-LD result differs from the official expected result.',
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

type OperationType = 'expand' | 'compact' | 'flatten' | 'toRdf' | 'fromRdf'

function operationOf(types: readonly string[]): OperationType | undefined {
  if (types.some((value) => value.endsWith('ExpandTest'))) return 'expand'
  if (types.some((value) => value.endsWith('CompactTest'))) return 'compact'
  if (types.some((value) => value.endsWith('FlattenTest'))) return 'flatten'
  if (types.some((value) => value.endsWith('ToRDFTest') || value.endsWith('ToRdfTest'))) {
    return 'toRdf'
  }
  if (types.some((value) => value.endsWith('FromRDFTest') || value.endsWith('FromRdfTest'))) {
    return 'fromRdf'
  }
  return undefined
}

async function apply(
  operation: OperationType,
  test: TestType,
  manifest: ManifestType,
): Promise<unknown> {
  const baseIri = manifest.baseIri ?? 'https://w3c.github.io/json-ld-api/tests/'
  const inputUrl = new URL(test.input!, baseIri).href
  const options = optionsFor(test.option, baseIri, test)
  if (operation === 'fromRdf') {
    const quads = await quadsFrom(file(test.input!))
    return await jsonld.fromRdf(quads, options)
  }
  const remoteManifest = inputUrl.includes('/remote-doc/')
  const input = remoteManifest ? inputUrl : await json<unknown>(file(test.input!))
  if (operation === 'expand') return await jsonld.expand(input, options)
  if (operation === 'toRdf') return await jsonld.toRdf(input, options)
  if (operation === 'compact') {
    const context = test.context ? await json<unknown>(file(test.context)) : {}
    return await jsonld.compact(input, context, options)
  }
  const context = test.context ? await json<unknown>(file(test.context)) : undefined
  return await jsonld.flatten(input, context, options)
}

function optionsFor(
  option: Readonly<Record<string, unknown>> | undefined,
  base: string,
  test: TestType,
): jsonld.OptionsType {
  const value = option ?? {}
  return {
    base: typeof value.base === 'string' ? value.base : base,
    remote: true,
    fetch: suiteFetch(test, base),
    maxDocuments: 256,
    maxBytes: 16 * 1024 * 1024,
    maxRedirects: 16,
    ...(typeof value.processingMode === 'string'
      ? { processingMode: value.processingMode as jsonld.ProcessingModeType }
      : {}),
    ...(typeof value.compactArrays === 'boolean' ? { compactArrays: value.compactArrays } : {}),
    ...(typeof value.compactToRelative === 'boolean'
      ? { compactToRelative: value.compactToRelative }
      : {}),
    ...(value.expandContext === undefined ? {} : { expandContext: asJsonLd(value.expandContext) }),
    ...(typeof value.extractAllScripts === 'boolean'
      ? { extractAllScripts: value.extractAllScripts }
      : {}),
    ...(typeof value.ordered === 'boolean' ? { ordered: value.ordered } : {}),
    ...(typeof value.produceGeneralizedRdf === 'boolean'
      ? { produceGeneralizedRdf: value.produceGeneralizedRdf }
      : {}),
    ...(typeof value.rdfDirection === 'string'
      ? { rdfDirection: value.rdfDirection as jsonld.RdfDirectionType }
      : {}),
    ...(typeof value.useNativeTypes === 'boolean' ? { useNativeTypes: value.useNativeTypes } : {}),
    ...(typeof value.useRdfType === 'boolean' ? { useRdfType: value.useRdfType } : {}),
  }
}

/** Converts manifest JSON into the recursive JSON-LD value contract used by the native processor. */
function asJsonLd(value: unknown): jsonld.JsonLdValueType {
  if (
    value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number'
  ) return value
  if (Array.isArray(value)) return value.map(asJsonLd)
  if (typeof value === 'object') {
    const output: Record<string, jsonld.JsonLdValueType> = {}
    for (const [key, item] of Object.entries(value)) output[key] = asJsonLd(item)
    return output
  }
  throw new TypeError('JSON-LD conformance option is not JSON-compatible.')
}

function suiteFetch(test: TestType, base: string): typeof fetch {
  const initial = new URL(test.input!, base).href
  return async (input) => {
    const url = new URL(String(input))
    const isInitial = url.href === initial
    const option = isInitial ? test.option ?? {} : {}
    const redirectTo = typeof option.redirectTo === 'string' ? option.redirectTo : undefined
    if (redirectTo) {
      return new Response(null, {
        status: typeof option.httpStatus === 'number' ? option.httpStatus : 302,
        headers: { location: new URL(redirectTo, url).href },
      })
    }
    const local = localJsonLd(url)
    let bytes: Uint8Array
    try {
      bytes = await Deno.readFile(local)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return new Response('not found', { status: 404 })
      throw error
    }
    const headers = new Headers()
    headers.set(
      'content-type',
      typeof option.contentType === 'string' ? option.contentType : media(local),
    )
    const links = option.httpLink
    if (typeof links === 'string') headers.set('link', links)
    else if (Array.isArray(links)) headers.set('link', links.join(', '))
    return new Response(bytes, { status: 200, headers })
  }
}

function localJsonLd(url: URL): string {
  const roots = ['/json-ld-api/tests/', '/tests/']
  for (const marker of roots) {
    const index = url.pathname.indexOf(marker)
    if (index >= 0) {
      return `${sourceDir('jsonld')}/tests/${url.pathname.slice(index + marker.length)}`
    }
  }
  throw new TypeError(`JSON-LD test URL is outside the pinned suite: ${url.href}`)
}

function media(path: string): string {
  if (path.endsWith('.jsonld')) return 'application/ld+json'
  if (path.endsWith('.json') || path.endsWith('.jldt')) return 'application/json'
  if (path.endsWith('.html') || path.endsWith('.xhtml')) return 'text/html'
  return 'application/octet-stream'
}

async function compare(
  operation: OperationType,
  actual: unknown,
  test: TestType,
): Promise<boolean> {
  if (!test.expect) return true
  if (operation === 'toRdf') {
    const expected = await quadsFrom(file(test.expect))
    return Array.isArray(actual) && isomorphic(actual as Quad[], expected)
  }
  const expected = await json<unknown>(file(test.expect))
  return matchJson(actual, expected, Boolean(test.option?.ordered))
}

async function quadsFrom(path: string): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of parseNQuads(await Deno.readTextFile(path))) output.push(value)
  return output
}

function file(relative: string): string {
  return `${sourceDir('jsonld')}/tests/${relative}`
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
