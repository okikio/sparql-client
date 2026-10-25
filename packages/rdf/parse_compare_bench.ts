/** Competitive parser benchmark across equivalent RDF syntax fixtures and stream chunk shapes. @module */

import { bench, do_not_optimize, group } from 'mitata'
import { Parser as N3Parser } from 'n3'
import { parse as oxigraphParse } from 'oxigraph'
import { report } from '../../bench/report.ts'
import type { Quad } from './term.ts'
import { parse as parseNTriples } from './ntriples/mod.ts'
import { parse as parseNQuads } from './nquads/mod.ts'
import { parse as parseTurtle } from './turtle/mod.ts'
import { parse as parseTriG } from './trig/mod.ts'

interface FormatType {
  readonly name: string
  readonly n3: string
  readonly oxigraph: string
  readonly text: (count: number) => string
  readonly parse: (source: string | Iterable<string>) => AsyncIterable<Quad>
}

const formats: readonly FormatType[] = [
  {
    name: 'N-Triples',
    n3: 'N-Triples',
    oxigraph: 'application/n-triples',
    text: (count) =>
      Array.from(
        { length: count },
        (_, i) => `<https://example.com/s/${i}> <https://example.com/p> "value-${i}" .`,
      ).join('\n'),
    parse: (source) => parseNTriples(source),
  },
  {
    name: 'N-Quads',
    n3: 'N-Quads',
    oxigraph: 'application/n-quads',
    text: (count) =>
      Array.from(
        { length: count },
        (_, i) =>
          `<https://example.com/s/${i}> <https://example.com/p> "value-${i}" <https://example.com/g/${
            i % 8
          }> .`,
      ).join('\n'),
    parse: (source) => parseNQuads(source),
  },
  {
    name: 'Turtle',
    n3: 'Turtle',
    oxigraph: 'text/turtle',
    text: (count) =>
      `@prefix ex: <https://example.com/> .\n${
        Array.from({ length: count }, (_, i) => `ex:s${i} ex:p "value-${i}" .`).join('\n')
      }`,
    parse: (source) => parseTurtle(source, { baseIri: 'https://example.com/base' }),
  },
  {
    name: 'TriG',
    n3: 'TriG',
    oxigraph: 'application/trig',
    text: (count) =>
      `@prefix ex: <https://example.com/> .\n${
        Array.from({ length: count }, (_, i) => `ex:g${i % 8} { ex:s${i} ex:p "value-${i}" . }`)
          .join('\n')
      }`,
    parse: (source) => parseTriG(source, { baseIri: 'https://example.com/base' }),
  },
]

const scales = Deno.env.get('BENCH_LARGE') === '1'
  ? [100, 10_000, 100_000, 1_000_000]
  : [100, 10_000, 100_000]
const chunkSizes = [64, 1024, 4096, 65_536] as const
/** Workspace tasks isolate each matrix cell so completed fixtures can be reclaimed. */
const selectedFormat = Deno.env.get('BENCH_PARSE_FORMAT')
const selectedCount = Deno.env.get('BENCH_PARSE_COUNT')
if (selectedFormat !== undefined && !formats.some((value) => value.name === selectedFormat)) {
  throw new Error('Unknown BENCH_PARSE_FORMAT.')
}
if (selectedCount !== undefined && !scales.includes(Number(selectedCount))) {
  throw new Error('Unknown BENCH_PARSE_COUNT.')
}

for (const format of formats) {
  if (selectedFormat !== undefined && format.name !== selectedFormat) continue
  for (const count of scales) {
    if (selectedCount !== undefined && count !== Number(selectedCount)) continue
    const text = format.text(count)
    const digest = await nativeKey(format.parse(text))
    const n3 = n3Key(format, text, count)
    if (n3.digest !== digest) {
      throw new Error(`${format.name} N3 oracle differs at ${count} quads.`)
    }
    if (oxigraphKey(format, text) !== digest) {
      throw new Error(`${format.name} Oxigraph oracle differs at ${count} quads.`)
    }
    const chunks = new Map(chunkSizes.map((size) => [size, split(text, size)] as const))
    const random = hostile(text, 0x20260817)
    if (await first(format.parse(chunks.get(4096)!)) !== n3.first) {
      throw new Error(`${format.name} independent first-result oracle differs.`)
    }
    for (const [size, source] of chunks) {
      if (await nativeKey(format.parse(source)) !== digest) {
        throw new Error(`${format.name} ${size}-byte chunk oracle differs.`)
      }
    }
    if (await nativeKey(format.parse(random)) !== digest) {
      throw new Error(`${format.name} hostile chunk oracle differs.`)
    }

    group(`${format.name} parse: ${count.toLocaleString()} quads`, () => {
      bench(
        '@okikio whole',
        async () => do_not_optimize((await collect(format.parse(text))).length),
      ).gc('inner')
      bench(
        'N3 whole',
        () => do_not_optimize(new N3Parser({ format: format.n3 }).parse(text).length),
      ).gc('inner')
      bench('Oxigraph whole', () => do_not_optimize(oxigraphCount(format, text))).gc('inner')
      for (const size of chunkSizes) {
        const source = chunks.get(size)!
        bench(
          `@okikio ${size} B chunks`,
          async () => do_not_optimize((await collect(format.parse(source))).length),
        ).gc('inner')
      }
      bench(
        '@okikio hostile chunks',
        async () => do_not_optimize((await collect(format.parse(random))).length),
      ).gc('inner')
      bench(
        '@okikio first quad / 4 KiB',
        async () => do_not_optimize(await first(format.parse(chunks.get(4096)!))),
      ).gc('inner')
    })
  }
}

await report()

/** Materialized oracle arrays die with this activation before another processor starts. */
async function nativeKey(source: AsyncIterable<Quad>): Promise<string> {
  return keys(await collect(source))
}
/** Keeps the independent N3 materialization out of long-lived benchmark closures. */
function n3Key(format: FormatType, text: string, count: number): { digest: string; first: string } {
  const values = new N3Parser({ format: format.n3 }).parse(text)
  if (values.length !== count) throw new Error('Independent parser fixture count differs.')
  const initial = quadKey(values[0])
  return { digest: keys(values), first: initial }
}
/** Keeps the independent Wasm materialization out of long-lived benchmark closures. */
function oxigraphKey(format: FormatType, text: string): string {
  const values = oxigraphParse(text, { format: format.oxigraph })
  if (!Array.isArray(values)) throw new Error('Oxigraph returned a non-array parser result.')
  return keys(values)
}

async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of source) output.push(value)
  return output
}

async function first(source: AsyncIterable<Quad>): Promise<string> {
  const iterator = source[Symbol.asyncIterator]()
  try {
    const value = await iterator.next()
    if (value.done) throw new Error('Nonempty first-result fixture yielded no quad.')
    return quadKey(value.value)
  } finally {
    await iterator.return?.()
  }
}

function split(value: string, size: number): string[] {
  const output: string[] = []
  for (let offset = 0; offset < value.length; offset += size) {
    output.push(value.slice(offset, offset + size))
  }
  return output
}

function hostile(value: string, seed: number): string[] {
  const output: string[] = []
  let offset = 0
  let state = seed >>> 0
  while (offset < value.length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const size = 1 + (state % 257)
    output.push(value.slice(offset, offset + size))
    offset += size
  }
  return output
}

/** Releases only temporary competitor wrappers owned by this benchmark, never the engine. */
function release(value: unknown): void {
  if (
    typeof value === 'object' && value !== null && 'free' in value &&
    typeof value.free === 'function'
  ) {
    value.free()
  }
}

/** Counts and retires a complete Wasm result; garbage collection need not schedule finalizers first. */
function oxigraphCount(format: FormatType, text: string): number {
  const values = oxigraphParse(text, { format: format.oxigraph })
  if (!Array.isArray(values)) throw new Error('Oxigraph returned a non-array parser result.')
  try {
    return values.length
  } finally {
    for (const value of values) release(value)
  }
}

/** Complete first-result identity uses the same semantic fields as the full preflight. */
function quadKey(
  value: {
    readonly subject: unknown
    readonly predicate: unknown
    readonly object: unknown
    readonly graph: unknown
  },
): string {
  return JSON.stringify([
    key(value.subject),
    key(value.predicate),
    key(value.object),
    key(value.graph),
  ])
}

function keys(
  values: Iterable<
    {
      readonly subject: unknown
      readonly predicate: unknown
      readonly object: unknown
      readonly graph: unknown
    }
  >,
): string {
  return [...values].map((value) => {
    try {
      return quadKey(value)
    } finally {
      release(value)
    }
  }).sort().join('\n')
}

function key(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const term = value as {
    termType?: string
    value?: string
    language?: string
    direction?: string
    datatype?: unknown
    subject?: unknown
    predicate?: unknown
    object?: unknown
    graph?: unknown
  }
  try {
    if (term.termType === 'Literal') {
      return JSON.stringify([
        'Literal',
        term.value,
        term.language?.toLowerCase() ?? '',
        term.direction ?? '',
        key(term.datatype),
      ])
    }
    if (term.termType === 'Quad') {
      return `Q(${key(term.subject)},${key(term.predicate)},${key(term.object)},${key(term.graph)})`
    }
    return `${term.termType ?? '?'}:${term.value ?? ''}`
  } finally {
    release(value)
  }
}
