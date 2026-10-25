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

if (import.meta.main) await create(Deno.args)

/** Writes the pinned vocabulary only after its complete source identity is verified. */
async function create(args: readonly string[]): Promise<void> {
  const out = parseArgs(args)
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
}

/** Parses the task's only optional output argument. */
function parseArgs(args: readonly string[]): string {
  if (args.length === 0) return DEFAULT_OUT
  if (args.length === 2 && args[0] === '--out' && args[1]) return args[1]
  throw new TypeError('Usage: deno task vocab:schema [--out <directory>]')
}

/** Task-owned HTTP policy; injected fetches must honor the supplied abort signal. */
export interface DownloadOptionsType {
  /** Fetch boundary used by controlled fixtures; native Fetch is the default. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** Maximum retained decoded response bytes; defaults to four MiB. */
  readonly maxBytes?: number
  /** Request and body deadline in milliseconds; defaults to thirty seconds. */
  readonly timeoutMs?: number
  /** Caller cancellation is borrowed and never aborted by this task. */
  readonly signal?: AbortSignal
}

/**
 * Reads one authoritative source without redirects. The byte cap applies before
 * each chunk is retained, even without a truthful Content-Length. Fetch may allocate
 * its delivered chunk internally; this is a retained-body cap, not a process RSS cap.
 * The deadline stays active through body consumption. Failed reads cancel and unlock
 * the reader, preserving independent cleanup failures. An uncooperative injected
 * fetch or stream cancellation can still delay its own cleanup.
 */
export async function download(
  url: string,
  options: DownloadOptionsType = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const timeoutMs = options.timeoutMs ?? 30_000
  for (const [name, value] of [['maxBytes', maxBytes], ['timeoutMs', timeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`)
    }
  }
  options.signal?.throwIfAborted()
  const deadline = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([deadline.signal, options.signal])
    : deadline.signal
  const timer = setTimeout(
    () => deadline.abort(new DOMException('Schema.org source deadline exceeded.', 'TimeoutError')),
    timeoutMs,
  )
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const errors: unknown[] = []
  let result: Uint8Array | undefined
  try {
    response = await (options.fetch ?? fetch)(url, { redirect: 'error', signal })
    signal.throwIfAborted()
    if (!response.ok) {
      throw new Error(`Schema.org source request failed with HTTP ${response.status}.`)
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > maxBytes) {
      throw new RangeError(`Schema.org source exceeds the configured ${maxBytes} byte limit.`)
    }
    const parts: Uint8Array[] = []
    let length = 0
    if (response.body) {
      reader = response.body.getReader()
      while (true) {
        const next = await read(reader, signal)
        signal.throwIfAborted()
        if (next.done) break
        if (next.value.byteLength > maxBytes - length) {
          throw new RangeError(`Schema.org source exceeds the configured ${maxBytes} byte limit.`)
        }
        length += next.value.byteLength
        parts.push(next.value)
      }
    }
    result = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.byteLength
    }
  } catch (error) {
    errors.push(error)
  } finally {
    if (errors.length) {
      try {
        if (reader) await reader.cancel(errors[0])
        else await response?.body?.cancel(errors[0])
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      reader?.releaseLock()
    } catch (error) {
      errors.push(error)
    }
    clearTimeout(timer)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length) {
    throw new AggregateError(errors, 'Schema.org source and cleanup failed.', { cause: errors[0] })
  }
  return result!
}

/** One abort listener belongs to one pending body read and is removed on settlement. */
function read(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    reader.read().then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
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
