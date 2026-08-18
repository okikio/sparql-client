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

for (const format of formats) {
  for (const count of scales) {
    const text = format.text(count)
    const expected = await collect(format.parse(text))
    const digest = keys(expected)
    const n3 = new N3Parser({ format: format.n3 }).parse(text)
    const oxigraph = oxigraphParse(text, { format: format.oxigraph })
    if (keys(n3) !== digest) throw new Error(`${format.name} N3 oracle differs at ${count} quads.`)
    if (!Array.isArray(oxigraph) || keys(oxigraph) !== digest) {
      throw new Error(`${format.name} Oxigraph oracle differs at ${count} quads.`)
    }
    const chunks = new Map(chunkSizes.map((size) => [size, split(text, size)] as const))
    const random = hostile(text, 0x20260817)
    for (const [size, source] of chunks) {
      if (keys(await collect(format.parse(source))) !== digest) {
        throw new Error(`${format.name} ${size}-byte chunk oracle differs.`)
      }
    }
    if (keys(await collect(format.parse(random))) !== digest) {
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
      bench('Oxigraph whole', () => {
        const values = oxigraphParse(text, { format: format.oxigraph })
        do_not_optimize(Array.isArray(values) ? values.length : 0)
      }).gc('inner')
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

async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const output: Quad[] = []
  for await (const value of source) output.push(value)
  return output
}

async function first(source: AsyncIterable<Quad>): Promise<string> {
  const iterator = source[Symbol.asyncIterator]()
  try {
    const value = await iterator.next()
    return value.done ? '' : key(value.value)
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
  return [...values].map((value) =>
    `${key(value.subject)} ${key(value.predicate)} ${key(value.object)} ${key(value.graph)}`
  ).sort().join('\n')
}

function key(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const term = value as {
    termType?: string
    value?: string
    language?: string
    datatype?: unknown
    subject?: unknown
    predicate?: unknown
    object?: unknown
    graph?: unknown
  }
  if (term.termType === 'Literal') {
    return `L${term.value ?? ''}@${term.language ?? ''}^^${key(term.datatype)}`
  }
  if (term.termType === 'Quad') {
    return `Q(${key(term.subject)},${key(term.predicate)},${key(term.object)},${key(term.graph)})`
  }
  return `${term.termType ?? '?'}:${term.value ?? ''}`
}
