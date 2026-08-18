/** File-oriented vocabulary compiler task. @module */

import { parse as parseNQuads } from '@okikio/rdf/nquads'
import { parse as parseNTriples } from '@okikio/rdf/ntriples'
import { parse as parseTriG } from '@okikio/rdf/trig'
import { parse as parseTurtle } from '@okikio/rdf/turtle'
import { compile, type OntologySourceType } from '@okikio/vocab'
import type { Quad } from '@okikio/rdf'

interface OptionsType {
  readonly inputs: readonly string[]
  readonly out: string
  readonly vocabulary: string
  readonly namespace: string
  readonly prefix: string
  readonly format?: FormatType
}

type FormatType = 'nquads' | 'ntriples' | 'turtle' | 'trig'

const options = parseArgs(Deno.args)
const sources: OntologySourceType[] = []
for (const path of options.inputs) {
  const text = await Deno.readTextFile(path)
  const format = options.format ?? inferFormat(path)
  sources.push({ id: path, quads: parse(text, format) })
}

const result = await compile(sources, {
  vocabulary: options.vocabulary,
  namespace: options.namespace,
  prefix: options.prefix,
})

await Deno.mkdir(options.out, { recursive: true })
await Deno.writeTextFile(join(options.out, 'mod.ts'), result.source)
await Deno.writeTextFile(
  join(options.out, 'manifest.json'),
  `${JSON.stringify(result.manifest, null, 2)}\n`,
)

/** Selects a standards parser without letting file I/O enter the vocabulary compiler library. */
function parse(source: string, format: FormatType): AsyncIterable<Quad> {
  switch (format) {
    case 'nquads':
      return parseNQuads(source)
    case 'ntriples':
      return parseNTriples(source)
    case 'turtle':
      return parseTurtle(source)
    case 'trig':
      return parseTriG(source)
  }
}

/** Parses the intentionally small internal task interface. */
function parseArgs(args: readonly string[]): OptionsType {
  const inputs: string[] = []
  let out: string | undefined
  let vocabulary: string | undefined
  let namespace: string | undefined
  let prefix: string | undefined
  let format: FormatType | undefined

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const value = args[index + 1]
    if (arg === '--input' && value) {
      inputs.push(value)
      index++
    } else if (arg === '--out' && value) {
      out = value
      index++
    } else if (arg === '--name' && value) {
      vocabulary = value
      index++
    } else if (arg === '--namespace' && value) {
      namespace = value
      index++
    } else if (arg === '--prefix' && value) {
      prefix = value
      index++
    } else if (arg === '--format' && value) {
      if (value !== 'nquads' && value !== 'ntriples' && value !== 'turtle' && value !== 'trig') {
        throw new TypeError(`Unsupported --format '${value}'.`)
      }
      format = value
      index++
    } else {
      throw new TypeError(`Unknown or incomplete vocabulary task option '${arg}'.`)
    }
  }

  if (inputs.length === 0) throw new TypeError('At least one --input is required.')
  if (!out) throw new TypeError('--out is required.')
  if (!vocabulary) throw new TypeError('--name is required.')
  if (!namespace) throw new TypeError('--namespace is required.')
  if (!prefix) throw new TypeError('--prefix is required.')

  return format === undefined
    ? { inputs, out, vocabulary, namespace, prefix }
    : { inputs, out, vocabulary, namespace, prefix, format }
}

/** Infers one supported RDF serialization from a source filename. */
function inferFormat(path: string): FormatType {
  const lower = path.toLowerCase()
  if (lower.endsWith('.nq')) return 'nquads'
  if (lower.endsWith('.nt')) return 'ntriples'
  if (lower.endsWith('.ttl')) return 'turtle'
  if (lower.endsWith('.trig')) return 'trig'
  throw new TypeError(`Cannot infer RDF format for '${path}'. Pass --format explicitly.`)
}

/** Joins the task's output directory without introducing a filesystem/path runtime dependency. */
function join(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/u, '')}/${name}`
}
