/**
 * Focused CPU/allocation diagnostic for the competitive Turtle/TriG fixture.
 *
 * Run each syntax/input shape in its own process. Example:
 * `PARSER_SYNTAX=Turtle PARSER_COUNT=100000 PARSER_PROFILE=cpu deno run
 * --v8-flags=--expose-gc --allow-env --allow-read --allow-write bench/parser/profile.ts`.
 * This is a profiler, not a replacement for the package-owned Mitata matrix.
 * Allocation sampling and CPU profiling run separately from plain observations.
 * Every completed result is checked against independently constructed RDF terms
 * after its timer. Fixture creation, validation, explicit GC and report writing
 * are outside parse intervals. Parsing includes construction and full array
 * materialization, matching the native competitive whole-document consumer.
 */
import { Session } from 'node:inspector'
import process from 'node:process'
import { cpus, release, totalmem } from 'node:os'
import { createHash } from 'node:crypto'
import { Parser as N3Parser } from 'n3'
import { validateObservation } from './resources.ts'
import type { Quad } from '../../packages/rdf/term.ts'

const syntax = Deno.env.get('PARSER_SYNTAX') ?? 'Turtle'
const count = Number(Deno.env.get('PARSER_COUNT') ?? 100_000)
const chunkSize = Number(Deno.env.get('PARSER_CHUNK') ?? 0)
const mode = Deno.env.get('PARSER_PROFILE') ?? 'off'
const iterations = Number(Deno.env.get('PARSER_ITERATIONS') ?? (mode === 'off' ? 5 : 1))
const implementation = Deno.env.get('PARSER_IMPLEMENTATION') ?? 'native'
if (!['Turtle', 'TriG'].includes(syntax) || !['off', 'cpu', 'heap'].includes(mode)) {
  throw new TypeError('Unknown syntax/profile mode.')
}
for (const [name, value] of Object.entries({ count, chunkSize, iterations })) {
  if (!Number.isSafeInteger(value) || value < (name === 'chunkSize' ? 0 : 1)) {
    throw new TypeError(`Invalid ${name}.`)
  }
}
if (!['native', 'n3'].includes(implementation) || (implementation === 'n3' && chunkSize !== 0)) {
  throw new TypeError('N3 diagnostic uses its whole-document array API only.')
}
const moduleUrl = Deno.env.get('PARSER_MODULE') ??
  new URL(`../../packages/rdf/${syntax.toLowerCase()}/mod.ts`, import.meta.url).href
const parser: { parse(source: string | Iterable<string>): AsyncIterable<Quad> } = await import(
  moduleUrl
)
const text = `@prefix ex: <https://example.com/> .\n${
  Array.from({ length: count }, (_, i) => {
    const statement = `ex:s${i} ex:p "value-${i}" .`
    return syntax === 'Turtle' ? statement : `ex:g${i % 8} { ${statement} }`
  }).join('\n')
}`
const input = chunkSize === 0 ? text : Array.from(
  { length: Math.ceil(text.length / chunkSize) },
  (_, i) => text.slice(i * chunkSize, (i + 1) * chunkSize),
)
const session = new Session()
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
if (!gc) throw new Error('Exposed GC required; use --v8-flags=--expose-gc.')
const output = Deno.env.get('PARSER_REPORT') ??
  `.tmp/reports/parser/${syntax}-${count}-${chunkSize}-${mode}.json`
await Deno.mkdir(output.slice(0, output.lastIndexOf('/')), { recursive: true })
let connected = false
let profile: unknown
const observations: Record<string, unknown>[] = []
const measuredPaths = [
  'compact.ts',
  'language.ts',
  'iri.ts',
  'text.ts',
  'iteration.ts',
  'factory.ts',
  'term.ts',
]
const inputs: Record<string, string> = {}
for (const path of measuredPaths) {
  inputs[new URL(`../${path}`, moduleUrl).href] = createHash('sha256').update(
    await Deno.readFile(new URL(`../${path}`, moduleUrl)),
  ).digest('hex')
}
for (
  const url of [
    new URL(moduleUrl),
    new URL(import.meta.url),
    new URL('./resources.ts', import.meta.url),
    new URL('../../deno.json', import.meta.url),
    new URL('../../deno.lock', import.meta.url),
  ]
) {
  inputs[String(url)] = createHash('sha256').update(await Deno.readFile(new URL(url))).digest('hex')
}
const sourceSha256 = inputs[new URL('../compact.ts', moduleUrl).href]
await Deno.writeTextFile(
  output,
  JSON.stringify({ status: 'running', syntax, count, chunkSize, mode, implementation, inputs }),
)

try {
  if (mode !== 'off') {
    session.connect()
    connected = true
    if (mode === 'cpu') {
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: 1000 })
    } else await post('HeapProfiler.enable')
  }
  for (let attempt = 0; attempt < iterations; attempt++) {
    gc()
    if (mode === 'cpu') await post('Profiler.start')
    if (mode === 'heap') {
      await post('HeapProfiler.startSampling', {
        samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      })
    }
    const before = Deno.memoryUsage()
    const cpu = process.cpuUsage()
    const start = performance.now()
    let values: Quad[] = []
    if (implementation === 'native') {
      for await (const value of parser.parse(input)) values.push(value)
    } else values = new N3Parser({ format: syntax }).parse(text) as Quad[]
    const parseMs = performance.now() - start
    const cpuMicros = process.cpuUsage(cpu)
    const after = Deno.memoryUsage()
    const highWaterRssBytes = process.resourceUsage().maxRSS * 1024
    if (mode === 'cpu') profile = (await post('Profiler.stop')).profile
    if (mode === 'heap') profile = (await post('HeapProfiler.stopSampling')).profile
    verify(values)
    values = []
    gc()
    const observation = {
      attempt,
      parseMs,
      quadsPerSecond: count * 1000 / parseMs,
      utf8MiBPerSecond: new TextEncoder().encode(text).byteLength * 1000 / parseMs / 1048576,
      cpuMicros,
      before,
      after,
      afterReleaseGc: Deno.memoryUsage(),
      highWaterRssBytes,
    }
    validateObservation(observation)
    observations.push(observation)
  }
} catch (error) {
  try {
    await Deno.writeTextFile(
      output,
      JSON.stringify({
        status: 'fail',
        syntax,
        count,
        chunkSize,
        mode,
        implementation,
        inputs,
        observations,
        error: String(error),
      }),
    )
  } catch (saveError) {
    throw new AggregateError([error, saveError], 'Profile and failed-report write both failed.')
  }
  throw error
} finally {
  if (connected) session.disconnect()
}
for (const [url, hash] of Object.entries(inputs)) {
  if (createHash('sha256').update(await Deno.readFile(new URL(url))).digest('hex') !== hash) {
    await Deno.writeTextFile(
      output,
      JSON.stringify({
        status: 'invalid',
        reason: 'Measured inputs changed',
        inputs,
        observations,
      }),
    )
    throw new Error('Measured source/config inputs changed; discard observations.')
  }
}
const report = {
  status: 'pass',
  syntax,
  count,
  chunkSize,
  mode,
  implementation,
  iterations,
  fixtureUtf8Bytes: new TextEncoder().encode(text).byteLength,
  fixtureSha256: createHash('sha256').update(text).digest('hex'),
  moduleUrl,
  sourceSha256,
  inputs,
  inputsStable: true,
  runtime: Deno.version,
  host: {
    build: Deno.build,
    cpus: cpus().map(({ model, speed }) => ({ model, speed })),
    osRelease: release(),
    totalMemoryBytes: totalmem(),
  },
  observations,
  cpuScope:
    'process user/system CPU microseconds only across parser construction and full output materialization, excludes subsequent oracle/GC; may include background GC threads',
  gc: 'explicit before parse; result released and explicit collection after independent oracle',
  availability: {
    arrayBuffers:
      'unavailable: Deno node:process compatibility returns 0; snapshots use Deno.memoryUsage fields only',
  },
  network: 'not used/inapplicable: local in-memory fixture, no request counter measured',
  memory:
    'rss/heap snapshots in bytes; highWaterRssBytes is process-lifetime maxRSS KiB × 1024, includes setup/oracle. Heap sampling estimates allocation attribution including collected objects, not exact allocation counts. afterReleaseGc in off mode is one retained-heap observation, not a leak guarantee; profiler modes retain profiler records and must not establish application retained-heap comparisons.',
  profile,
}
await Deno.writeTextFile(output, JSON.stringify(report))
console.log(
  JSON.stringify({ output, status: report.status, syntax, mode, implementation, observations }),
)

/** Checks every ordered identity against fixture construction without calling another parser. */
function verify(values: readonly Quad[]): void {
  if (values.length !== count) throw new Error(`Expected ${count} quads; got ${values.length}.`)
  for (let i = 0; i < count; i++) {
    const value = values[i]!
    if (
      value.subject.termType !== 'NamedNode' ||
      value.subject.value !== `https://example.com/s${i}` ||
      value.predicate.termType !== 'NamedNode' ||
      value.predicate.value !== 'https://example.com/p' ||
      value.object.termType !== 'Literal' || value.object.value !== `value-${i}` ||
      value.object.language !== '' ||
      value.object.datatype.termType !== 'NamedNode' ||
      (value.object.direction ?? '') !== '' ||
      value.object.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string' ||
      value.graph.termType !== (syntax === 'Turtle' ? 'DefaultGraph' : 'NamedNode') ||
      value.graph.value !== (syntax === 'Turtle' ? '' : `https://example.com/g${i % 8}`)
    ) {
      throw new Error(`Independent fixture identity differs at ${i}.`)
    }
  }
}

/** Converts the inspector callback contract to terminal promise authority. */
function post(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) reject(error)
      else resolve(result as Record<string, unknown>)
    })
  })
}
