/**
 * Reproduces the generated Schema.org vocabulary from the pinned upstream release.
 *
 * Network and file-system access live in this task rather than `@okikio/vocab`.
 * The upstream bytes are pinned by size and Git blob SHA so a mutable URL cannot
 * silently change generated public types.
 *
 * @module
 */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { compile } from '@okikio/vocab'

const RELEASE = '30.0'
const SOURCE_COMMIT = '420231f6bfac8372fc564abb121fae57ccb36a0c'
const SOURCE_URL =
  `https://raw.githubusercontent.com/schemaorg/schemaorg/${SOURCE_COMMIT}/data/releases/${RELEASE}/schemaorg-all-https.nq`
const SOURCE_SIZE = 2_839_024
const SOURCE_GIT_SHA = '1939bb7fba73928894e03a13f9df3116f0f4172f'
const SOURCE_ID = `schema.org-${RELEASE}`
const DEFAULT_OUT = 'packages/vocab/schema'
const MAX_BYTES = 4 * 1024 * 1024

const out = parseArgs(Deno.args)
const bytes = await download(SOURCE_URL)
if (bytes.byteLength !== SOURCE_SIZE) {
  throw new Error(
    `Schema.org ${RELEASE} source size changed: expected ${SOURCE_SIZE}, received ${bytes.byteLength}.`,
  )
}

const gitSha = await gitBlobSha(bytes)
if (gitSha !== SOURCE_GIT_SHA) {
  throw new Error(
    `Schema.org ${RELEASE} Git blob changed: expected ${SOURCE_GIT_SHA}, received ${gitSha}.`,
  )
}

const sha256 = await digest('SHA-256', bytes)
const text = new TextDecoder().decode(bytes)
const result = await compile([{
  id: SOURCE_ID,
  iri: SOURCE_URL,
  version: RELEASE,
  hash: `sha256:${sha256}`,
  quads: parseNQuads(text),
}], {
  vocabulary: 'Schema.org',
  namespace: 'https://schema.org/',
  prefix: 'Schema',
})

await Deno.mkdir(out, { recursive: true })
await Deno.writeTextFile(join(out, 'mod.ts'), result.source)
await Deno.writeTextFile(
  join(out, 'manifest.json'),
  `${JSON.stringify(result.manifest, null, 2)}\n`,
)
console.log(
  `Generated Schema.org ${RELEASE}: ${result.manifest.symbols.length} symbols, sha256:${sha256}.`,
)

/** Parses the task's only optional output argument. */
function parseArgs(args: readonly string[]): string {
  if (args.length === 0) return DEFAULT_OUT
  if (args.length === 2 && args[0] === '--out' && args[1]) return args[1]
  throw new TypeError('Usage: deno task vocab:schema [--out <directory>]')
}

/** Downloads one bounded authoritative source without redirects to another origin. */
async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) {
    throw new Error(`Schema.org source request failed with HTTP ${response.status}.`)
  }
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > MAX_BYTES) {
    throw new RangeError(`Schema.org source exceeds the configured ${MAX_BYTES} byte limit.`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) {
    throw new RangeError(`Schema.org source exceeds the configured ${MAX_BYTES} byte limit.`)
  }
  return bytes
}

/** Computes the exact Git blob SHA used to pin the upstream release artifact. */
async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const input = new Uint8Array(prefix.byteLength + bytes.byteLength)
  input.set(prefix)
  input.set(bytes, prefix.byteLength)
  return await digest('SHA-1', input)
}

/** Computes one Web Crypto digest as lowercase hexadecimal text. */
async function digest(algorithm: 'SHA-1' | 'SHA-256', bytes: Uint8Array): Promise<string> {
  const value = new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes).buffer))
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Joins the task's output directory without adding a runtime path dependency. */
function join(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/u, '')}/${name}`
}
