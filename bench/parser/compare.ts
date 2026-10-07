/**
 * Same-dependency comparison of the saved scanner and current Turtle/TriG parser.
 *
 * `PARSER_BASELINE` is a file URL ending in the saved RDF source directory `/`.
 * Prepare the baseline from the same dependency tree, replacing only compact.ts
 * with the pre-change bytes; compare all other module hashes before running.
 * `PARSER_SYNTAX` selects Turtle or TriG; `PARSER_COUNT` defaults to 100000.
 * Example: PARSER_BASELINE=file:///private/tmp/baseline/rdf/ PARSER_SYNTAX=Turtle
 * BENCH_FORMAT=json deno run --v8-flags=--expose-gc --allow-env --allow-read
 * bench/parser/compare.ts. Run the two syntaxes serially in separate processes.
 *
 * Fixture creation and complete independent identity checks stay outside timing.
 * Each timed operation constructs a parser and retains its entire quad array,
 * including N3's whole API. Chunk cases use 4096 ASCII bytes per source chunk.
 * Inner GC is Mitata's explicit before/after batch collection, not production GC.
 */
import { bench, do_not_optimize, group } from 'mitata'
import { Parser as N3Parser } from 'n3'
import { report } from '../report.ts'
import type { Quad } from '../../packages/rdf/term.ts'

const syntax = Deno.env.get('PARSER_SYNTAX') ?? 'Turtle'
const count = Number(Deno.env.get('PARSER_COUNT') ?? 100_000)
const baselineRoot = Deno.env.get('PARSER_BASELINE')
if (
  !['Turtle', 'TriG'].includes(syntax) || !Number.isSafeInteger(count) || count < 1 || !baselineRoot
) {
  throw new TypeError(
    'Requires Turtle/TriG, positive safe count and explicit saved baseline file URL.',
  )
}
const moduleUrl = `${syntax.toLowerCase()}/mod.ts`
const baseline: { parse(source: string | Iterable<string>): AsyncIterable<Quad> } = await import(
  new URL(moduleUrl, baselineRoot).href
)
const current: typeof baseline = await import(
  new URL(`../../packages/rdf/${moduleUrl}`, import.meta.url).href
)
const text = `@prefix ex: <https://example.com/> .\n${
  Array.from({ length: count }, (_, i) => {
    const statement = `ex:s${i} ex:p "value-${i}" .`
    return syntax === 'Turtle' ? statement : `ex:g${i % 8} { ${statement} }`
  }).join('\n')
}`
const chunks = Array.from(
  { length: Math.ceil(text.length / 4096) },
  (_, i) => text.slice(i * 4096, (i + 1) * 4096),
)
for (const parser of [baseline, current]) {
  for (const input of [text, chunks]) verify(await collect(parser.parse(input)))
}
verify(new N3Parser({ format: syntax }).parse(text) as Quad[])
group(`${syntax}: ${count} complete quads, whole array materialization`, () => {
  for (
    const [name, parser] of [['saved scanner', baseline], ['buffered scanner', current]] as const
  ) {
    bench(
      `${name} / whole`,
      async () => do_not_optimize((await collect(parser.parse(text))).length),
    ).gc('inner')
    bench(
      `${name} / 4 KiB`,
      async () => do_not_optimize((await collect(parser.parse(chunks))).length),
    ).gc('inner')
  }
  bench('N3 / whole', () => do_not_optimize(new N3Parser({ format: syntax }).parse(text).length))
    .gc('inner')
})
await report()

/** Retains complete output just as the existing competitive parser workload does. */
async function collect(source: AsyncIterable<Quad>): Promise<Quad[]> {
  const values: Quad[] = []
  for await (const value of source) values.push(value)
  return values
}
/** Checks fixture fields independently, with graph/datatype/language identity and multiplicity. */
function verify(values: readonly Quad[]): void {
  if (values.length !== count) throw new Error('Wrong quad count.')
  for (let i = 0; i < count; i++) {
    const value = values[i]!
    if (
      value.subject.termType !== 'NamedNode' ||
      value.subject.value !== `https://example.com/s${i}` ||
      value.predicate.termType !== 'NamedNode' ||
      value.predicate.value !== 'https://example.com/p' ||
      value.object.termType !== 'Literal' || value.object.value !== `value-${i}` ||
      value.object.language !== '' || (value.object.direction ?? '') !== '' ||
      value.object.datatype.termType !== 'NamedNode' ||
      value.object.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string' ||
      value.graph.termType !== (syntax === 'Turtle' ? 'DefaultGraph' : 'NamedNode') ||
      value.graph.value !== (syntax === 'Turtle' ? '' : `https://example.com/g${i % 8}`)
    ) throw new Error(`Wrong quad identity at ${i}.`)
  }
}
