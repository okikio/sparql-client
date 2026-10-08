import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { validateObservation } from '../bench/parser/resources.ts'
import { expectQuads, expectTerm, expectTokens } from '../bench/oracle.ts'
import { expectCompilation } from '../bench/vocab/consumer.ts'
import type { TokenType } from '@okikio/sparql/syntax'
import type { EmitResultType } from '../packages/vocab/emit.ts'
import { validateMitata } from '../bench/validate.ts'
import { command, COMPILER, prepare } from '../bench/vocab/compiler.ts'
import type { PhaseType } from '../bench/vocab/compiler.ts'
import type { OutputType } from '../.mise/tasks/bench-command.ts'
import { parseDiagnostics } from '../bench/vocab/diagnostics.ts'
import { inspect, references } from '../bench/vocab/workload.ts'
import { assertStable, identity } from '../.mise/tasks/bench-identity.ts'

/** Artificial nanoseconds prove the native format contract without registering or running benchmarks. */
function native() {
  return {
    layout: [{ name: 'format fixture' }],
    benchmarks: [{
      alias: 'parse',
      group: 0,
      kind: 'static',
      runs: [{
        name: 'parse',
        stats: {
          kind: 'fn',
          ticks: 12,
          samples: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
          min: 10,
          max: 21,
          avg: 15.5,
          p25: 12,
          p50: 15,
          p75: 18,
          p99: 20,
          p999: 20,
        },
      }],
    }],
  }
}
/** RDF/JS-shaped terms keep this oracle regression independent of every production parser/factory. */
const named = (value: string) => ({ termType: 'NamedNode', value })
const literal = (value: string, language = 'ja', direction = '', datatype = 'urn:datatype') => ({
  termType: 'Literal',
  value,
  language,
  direction,
  datatype: named(datatype),
})
const quad = (object: ReturnType<typeof literal>, graph = named('urn:g')) => ({
  subject: named('urn:s'),
  predicate: named('urn:p'),
  object,
  graph,
})

/** Pinned TypeScript5.9.3 field names/units; artificial zero counters/times are valid diagnostics. */
const diagnostics = `Files: 0
Lines of Library: 0
Lines of TypeScript: 0
Identifiers: 0
Symbols: 0
Types: 0
Instantiations: 0
Memory used: 100K
Parse time: 0.00s
Bind time: 0.00s
Check time: 0.00s
Total time: 0.00s
`

/** Independent tiny generated-module shape tests consumers rather than one renderer's source spelling. */
function vocabulary(source: string): EmitResultType {
  return {
    source,
    manifest: {
      version: 1,
      generator: 'fixture',
      vocabulary: 'fixture',
      sources: [],
      diagnostics: [],
      symbols: [
        {
          kind: 'class',
          name: 'Class0',
          iri: 'https://example.test/Class0',
          exports: {
            term: 'Class0',
            type: 'Class0Type',
            schema: 'Class0Schema',
            properties: 'Class0PropertiesType',
          },
        },
        {
          kind: 'property',
          name: 'property0',
          iri: 'https://example.test/property0',
          exports: { term: 'property0' },
        },
      ],
    },
  }
}
const generated = `
export const Class0 = { termType: 'NamedNode', value: 'https://example.test/Class0' };
export const property0 = { termType: 'NamedNode', value: 'https://example.test/property0' };
export interface Class0PropertiesType { readonly property0: string }
export type Class0Type = Class0PropertiesType & { readonly '@type': 'Class0' };
export const Class0Schema = {
  '~standard': {
    validate(value) {
      if (value['@type'] !== 'Class0') return { issues: [{ path: ['@type'] }] };
      return typeof value.property0 === 'string'
        ? { value }
        : { issues: [{ path: ['property0'], message: 'fixture range mismatch' }] };
    }
  }
};
`

describe('benchmark evidence contracts', () => {
  it('admits measurement only after pinned acquisition and independent offline startup succeed', {
    timeout: 5000,
  }, async () => {
    const output = (success = true, version = 'Version 5.9.3'): OutputType => ({
      success,
      code: success ? 0 : 1,
      stdout: new TextEncoder().encode(version),
      stderr: new Uint8Array(),
    })
    let release!: (value: OutputType) => void
    const admitted = new Promise<OutputType>((resolve) => {
      release = resolve
    })
    let arrived!: () => void
    const entering = new Promise<void>((resolve) => {
      arrived = resolve
    })
    let measured = false
    const phases: PhaseType[] = []
    const ready = prepare((phase, args) => {
      phases.push(phase)
      expect(args).toContain('npm:typescript@5.9.3/bin/tsc')
      expect(args).toContain('--no-config')
      expect(args).toContain('--no-lock')
      expect(args).toContain('--node-modules-dir=none')
      expect(args.includes('--cached-only')).toBe(phase === 'admit')
      if (phase === 'admit') {
        arrived()
        return admitted
      }
      return Promise.resolve(output())
    }).then(() => {
      measured = true
    })
    await entering
    expect(measured).toBe(false)
    release(output())
    await ready
    expect(measured).toBe(true)
    expect(phases).toEqual(['acquire', 'admit'])
    const measuredCommand = command(['--noEmit', 'fixture.ts'])
    expect(measuredCommand).toContain('--cached-only')
    expect(measuredCommand).toContain(COMPILER)
    expect(measuredCommand.slice(-2)).toEqual(['--noEmit', 'fixture.ts'])
    for (const failure of ['download', 'wrong-pin', 'offline-startup'] as const) {
      const attempted: PhaseType[] = []
      let measured = false
      const failed = prepare((phase) => {
        attempted.push(phase)
        if (failure === 'wrong-pin') return Promise.resolve(output(true, 'Version 5.8.0'))
        if (failure === 'download' || phase === 'admit') return Promise.resolve(output(false))
        return Promise.resolve(output())
      }).then(() => {
        measured = true
      })
      await expect(failed).rejects.toBeInstanceOf(Error)
      expect(measured).toBe(false)
      expect(attempted).toEqual(failure === 'offline-startup' ? ['acquire', 'admit'] : ['acquire'])
    }
  })

  it('compares all token fields independently of object property order', () => {
    const token: TokenType = {
      kind: 'variable',
      value: 's',
      raw: '?s',
      range: { start: 0, end: 2, line: 1, column: 1, endLine: 1, endColumn: 3 },
    }
    const reordered: TokenType = {
      range: { endColumn: 3, endLine: 1, column: 1, line: 1, end: 2, start: 0 },
      raw: '?s',
      value: 's',
      kind: 'variable',
    }
    expect(() => expectTokens([token], [reordered], 'same token')).not.toThrow()
    for (
      const wrong of [
        { ...token, kind: 'iri' as const },
        { ...token, value: 'wrong' },
        { ...token, raw: '$s' },
        ...Object.keys(token.range).map((key) => ({
          ...token,
          range: { ...token.range, [key]: token.range[key as keyof TokenType['range']] + 1 },
        })),
      ]
    ) expect(() => expectTokens([wrong], [token], 'wrong field')).toThrow()
    expect(() => expectTokens([], [token], 'missing token')).toThrow()
    expect(() => expectTokens([token, token], [token], 'extra token')).toThrow()
    const second = { ...token, value: 'o', raw: '?o' }
    expect(() => expectTokens([second, token], [token, second], 'changed token order')).toThrow()
  })
  it('accepts incidental source formatting while rejecting wrong vocabulary exports and range behavior', async () => {
    await expectCompilation(vocabulary(generated), 1, 1)
    await expectCompilation(vocabulary(`// changed comments and spacing\n\n${generated}`), 1, 1)
    for (
      const source of [
        generated.replace('https://example.test/Class0', 'https://example.test/Wrong'),
        generated.replace("typeof value.property0 === 'string'", 'true'),
        generated.replace("if (value['@type'] !== 'Class0')", 'if (false)'),
        generated.replace('? { value }', "? { value: { '@type': value['@type'] } }"),
        generated.replace('export const Class0Schema', 'const Class0Schema'),
      ]
    ) await expect(expectCompilation(vocabulary(source), 1, 1)).rejects.toThrow()
    const wrong = vocabulary(generated)
    await expect(expectCompilation(
      {
        ...wrong,
        manifest: { ...wrong.manifest, symbols: wrong.manifest.symbols.slice(1) },
      },
      1,
      1,
    )).rejects.toThrow()
  })
  it('checks binding term identity even when lexical values match', () => {
    const expected = literal('binding', '', '', 'urn:type')
    expect(() => expectTerm({ ...expected }, expected, 'same binding')).not.toThrow()
    for (
      const actual of [
        named('binding'),
        literal('binding', 'ja', '', 'urn:type'),
        literal('binding', '', 'rtl', 'urn:type'),
        literal('binding', '', '', 'urn:wrong'),
      ]
    ) expect(() => expectTerm(actual, expected, 'wrong binding')).toThrow()
  })
  it('guards measured source and configuration while excluding separate tests/compiler workloads', async () => {
    const root = await Deno.makeTempDir({ prefix: 'benchmark-identity-' })
    try {
      const paths = [
        'deno.json',
        'deno.lock',
        'package.json',
        '.mise/tasks/bench-report.ts',
        '.mise/tasks/benchmarks.ts',
        '.mise/tasks/bench.ts',
        '.mise/tasks/bench-identity.ts',
        '.mise/tasks/bench-command.ts',
        '.mise/tasks/sources.ts',
        'conformance/query.ts',
        'conformance/modules.ts',
        'conformance/ownership.ts',
        'integration/releases.ts',
        'packages/rdf/mod.ts',
        'packages/rdf/deno.json',
        'packages/vocab/package.json',
        'packages/rdf/parse_bench.ts',
        'packages/rdf/parse_test.ts',
        'packages/rdf/imported_test.ts',
        'packages/triplestore/_memory_test.ts',
        'bench/parser.ts',
        'bench/vocab/types.ts',
        'bench/vocab/compiler.ts',
        'bench/vocab/diagnostics.ts',
        'packages/rdf/node_modules/foreign/_bench.ts',
        'packages/rdf/.tmp/generated.ts',
        'bench/upstream/sources/raw.ts',
      ]
      for (const path of paths) {
        const slash = path.lastIndexOf('/')
        if (slash >= 0) await Deno.mkdir(`${root}/${path.slice(0, slash)}`, { recursive: true })
        await Deno.writeTextFile(`${root}/${path}`, 'original')
      }
      for (
        const path of ['integration', 'examples', 'conformance', 'bench', 'packages', '.mise/tasks']
      ) {
        await Deno.mkdir(`${root}/${path}`, { recursive: true })
      }
      await Deno.writeTextFile(
        `${root}/packages/rdf/parse_bench.ts`,
        "import './imported_test.ts'; import '../triplestore/_memory_test.ts'; import '../../conformance/query.ts'",
      )
      await Deno.writeTextFile(
        `${root}/packages/triplestore/_memory_test.ts`,
        "import '../../integration/releases.ts'",
      )
      const before = await identity(root)
      for (
        const path of [
          'packages/rdf/parse_test.ts',
          'bench/vocab/types.ts',
          'bench/vocab/compiler.ts',
          'bench/vocab/diagnostics.ts',
          'packages/rdf/node_modules/foreign/_bench.ts',
          'packages/rdf/.tmp/generated.ts',
          'bench/upstream/sources/raw.ts',
        ]
      ) {
        await Deno.writeTextFile(`${root}/${path}`, 'unrelated edit')
      }
      assertStable(before, await identity(root))
      for (
        const path of [
          '.mise/tasks/bench-command.ts',
          '.mise/tasks/sources.ts',
          'conformance/query.ts',
          'integration/releases.ts',
          'packages/rdf/mod.ts',
          'packages/rdf/deno.json',
          'packages/vocab/package.json',
          'packages/rdf/parse_bench.ts',
          'packages/triplestore/_memory_test.ts',
          'packages/rdf/imported_test.ts',
          'bench/parser.ts',
          'deno.json',
        ]
      ) {
        const current = await identity(root)
        const original = await Deno.readTextFile(`${root}/${path}`)
        await Deno.writeTextFile(`${root}/${path}`, 'export const changed = 1;')
        const after = await identity(root)
        expect(() => assertStable(current, after)).toThrow()
        await Deno.writeTextFile(`${root}/${path}`, original)
      }
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  })
  it('compares input hash records independently of object insertion order', () => {
    expect(() => assertStable({ a: 'one', b: 'two' }, { b: 'two', a: 'one' })).not.toThrow()
    expect(() => assertStable({ a: 'one' }, { a: 'two' })).toThrow()
    expect(() => assertStable({ a: 'one' }, { a: 'one', b: 'two' })).toThrow()
  })
  it('accepts the native format with complete finite samples and statistics', () => {
    expect(() => validateMitata(native())).not.toThrow()
    const zero = native()
    zero.benchmarks[0]!.runs[0]!.stats = {
      ...zero.benchmarks[0]!.runs[0]!.stats,
      samples: [0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      min: 0,
      max: 10,
      avg: 7.5,
      p25: 0,
      p50: 10,
      p75: 10,
      p99: 10,
      p999: 10,
    }
    expect(() => validateMitata(zero)).not.toThrow()
    // Clock resolution can yield a zero median with genuine positive samples.
    const subTick = native()
    subTick.benchmarks[0]!.runs[0]!.stats = {
      ...zero.benchmarks[0]!.runs[0]!.stats,
      samples: [0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10],
      avg: 50 / 12,
      p50: 0,
    }
    expect(() => validateMitata(subTick)).not.toThrow()
    const fabricated = native()
    fabricated.benchmarks[0]!.runs[0]!.stats = {
      ...subTick.benchmarks[0]!.runs[0]!.stats,
      samples: Array(12).fill(0),
      min: 0,
      max: 1,
      avg: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p99: 0,
      p999: 0,
    }
    expect(() => validateMitata(fabricated)).toThrow()

    for (
      const resources of [
        { heap: { _: 2, total: 1, min: 0.25, max: 0.75, avg: 0.5 } },
        { heap: { _: 0, total: 0, min: null, max: null, avg: null } },
        { gc: { total: 1, min: 0, max: 1, avg: 0.5 } },
        {
          heap: { _: 1, total: 0, min: 0, max: 0, avg: 0 },
          gc: { total: 0, min: 0, max: 0, avg: 0 },
        },
      ]
    ) {
      expect(() =>
        validateMitata({
          benchmarks: [{
            runs: [{ stats: { ...zero.benchmarks[0]!.runs[0]!.stats, ...resources } }],
          }],
        })
      ).not.toThrow()
    }
  })
  it('rejects empty, failed, incomplete, and nonfinite native measurements', () => {
    const valid = native(), run = valid.benchmarks[0]!.runs[0]!
    const reports: unknown[] = [null, {}, { benchmarks: [] }, { benchmarks: [{ runs: [] }] }]
    for (
      const stats of [
        {},
        { ...run.stats, samples: [] },
        { ...run.stats, samples: [NaN] },
        { ...run.stats, samples: [-1] },
        { ...run.stats, p50: Infinity },
        { ...run.stats, p99: NaN },
        { ...run.stats, min: 12 },
        { ...run.stats, max: 11 },
        { ...run.stats, p50: 0 },
        { ...run.stats, avg: NaN },
        { ...run.stats, avg: 30 },
        { ...run.stats, p25: Infinity },
        { ...run.stats, p75: 10 },
        { ...run.stats, p999: 13 },
      ]
    ) reports.push({ benchmarks: [{ runs: [{ stats }] }] })
    for (
      const resources of [
        { heap: {} },
        { gc: {} },
        { heap: null },
        { gc: null },
        { heap: { _: 0, total: 0, min: 0, max: 0, avg: 0 } },
        { heap: { _: 0, total: 1, min: null, max: null, avg: null } },
        { heap: { _: 1, total: 1, min: null, max: null, avg: null } },
        { heap: { _: 1.5, total: 1, min: 0, max: 1, avg: 0.5 } },
        { heap: { _: Infinity, total: 1, min: 0, max: 1, avg: 0.5 } },
        { heap: { _: 1, total: Infinity, min: 0, max: 1, avg: 0.5 } },
        { heap: { _: 1, total: 1, min: 2, max: 1, avg: 1 } },
        { heap: { _: 1, total: 1, min: 0, max: 1, avg: 2 } },
        { heap: { _: 2, total: 100, min: 0, max: 1, avg: 0.5 } },
        { gc: { total: 1, min: 0, max: 1 } },
        { gc: { total: 1, min: 0, max: 1, avg: NaN } },
        { gc: { total: 1, min: -1, max: 1, avg: 0 } },
        { gc: { total: 0.5, min: 0, max: 1, avg: 0.5 } },
        { gc: { total: 1, min: 0, max: 1, avg: 2 } },
      ]
    ) reports.push({ benchmarks: [{ runs: [{ stats: { ...run.stats, ...resources } }] }] })
    const { p99: _p99, ...incomplete } = run.stats
    reports.push({ benchmarks: [{ runs: [{ stats: incomplete }] }] })
    reports.push({ benchmarks: [{ runs: [{ ...run, error: 'oracle failed' }] }] })
    reports.push({
      benchmarks: [valid.benchmarks[0], { runs: [{ ...run, error: 'later run failed' }] }],
    })
    for (const value of reports) expect(() => validateMitata(value)).toThrow()
  })
  it('compares complete unordered RDF identities including multiplicity', () => {
    const first = quad(literal('雪 | \n 😀')), second = quad(literal('other value'))
    expect(() => expectQuads([second, first], [first, second], 'same')).not.toThrow()
    expect(() => expectQuads([first, first], [first, second], 'duplicate replaces value')).toThrow()
    expect(() => expectQuads([first, first], [first], 'extra duplicate')).toThrow()
  })
  it('rejects equal-count literal, graph, language, datatype and direction mistakes', () => {
    const expected = quad(literal('雪 | \n 😀', 'ja', 'rtl'))
    const alternatives = [
      quad(literal('wrong', 'ja', 'rtl')),
      quad(literal('雪 | \n 😀', 'en', 'rtl')),
      quad(literal('雪 | \n 😀', 'ja', 'ltr')),
      quad(literal('雪 | \n 😀', 'ja', 'rtl', 'urn:other')),
      quad(literal('雪 | \n 😀', 'ja', 'rtl'), named('urn:other')),
    ]
    for (const value of alternatives) {
      expect(() => expectQuads([value], [expected], 'wrong term')).toThrow()
    }
  })
  it('retains tuple boundaries where delimiter-based term keys would collide', () => {
    const left = quad(literal('a|b', '', '', 'urn:type'))
    const right = quad(literal('a', '', '', 'b|||urn:type'))
    expect(() => expectQuads([left], [right], 'tuple delimiter')).toThrow()
  })
  it('requires the pinned compiler fields while retaining zero counters/times and decimal K memory', () => {
    const value = parseDiagnostics(diagnostics)
    expect(value.memoryBytes).toBe(100_000)
    expect(value.files).toBe(0)
    expect(value.instantiations).toBe(0)
    expect(value.parseMs).toBe(0)
    expect(value.checkMs).toBe(0)
  })
  it('rejects missing, nonfinite, negative, duplicated and wrong-unit compiler diagnostics', () => {
    for (
      const value of [
        '',
        diagnostics.replace('Memory used: 100K\n', ''),
        diagnostics.replace('Check time: 0.00s', 'Check time: NaN s'),
        diagnostics.replace('Check time: 0.00s', 'Check time: 100K'),
        diagnostics.replace('Files: 0', 'Files: -1'),
        diagnostics.replace('Files: 0', 'Files: 0.5'),
        diagnostics.replace('Memory used: 100K', 'Memory used: 1.5K'),
        diagnostics.replace('Memory used: 100K', `Memory used: 1${'0'.repeat(307)}K`),
        diagnostics.replace('Check time: 0.00s', `Check time: 1${'0'.repeat(307)}s`),
        diagnostics + 'Files: 0\n',
      ]
    ) expect(() => parseDiagnostics(value)).toThrow()
  })
})

describe('compiler fixture inheritance admission', () => {
  it('declares flattened scaling and rejects equal-count identity substitutions before timing', () => {
    expect(references({ classes: 1000, propertiesPerClass: 1, shape: 'deep' })).toBe(500_500)
    expect(references({ classes: 500, propertiesPerClass: 1, shape: 'deep' })).toBe(125_250)
    expect(references({ classes: 1000, propertiesPerClass: 4, shape: 'flat' })).toBe(4_000)
    expect(references({ classes: 5, propertiesPerClass: 2, shape: 'tree' })).toBe(18)
    const value = { classes: 2, propertiesPerClass: 1, shape: 'deep' } as const
    const own = { iri: 'https://example.com/vocab/property0_0' }
    const child = { iri: 'https://example.com/vocab/property1_0' }
    const actual = new Map([
      ['https://example.com/vocab/Class0', [own]],
      ['https://example.com/vocab/Class1', [child, own]],
    ])
    expect(inspect(value, actual)).toBe(3)
    for (const properties of [[child, child], [child], [own, { iri: 'urn:wrong' }]]) {
      expect(() =>
        inspect(
          value,
          new Map([...actual, [
            'https://example.com/vocab/Class1',
            properties,
          ]]),
        )
      ).toThrow()
    }
    expect(() => inspect(value, new Map([...actual].slice(0, 1)))).toThrow()
  })
})

describe('parser resource observations', () => {
  it('rejects unavailable or nonphysical measurements without setting a speed threshold', () => {
    const memory = { rss: 2048, heapTotal: 1024, heapUsed: 512, external: 0 }
    const value = {
      attempt: 0,
      parseMs: 0.25,
      quadsPerSecond: 4000,
      utf8MiBPerSecond: 0.01,
      cpuMicros: { user: 0, system: 0 },
      highWaterRssBytes: 4096,
      before: memory,
      after: memory,
      afterReleaseGc: memory,
    }
    expect(() => validateObservation(value)).not.toThrow()
    for (
      const invalid of [
        { ...value, parseMs: 0 },
        { ...value, parseMs: NaN },
        { ...value, quadsPerSecond: Infinity },
        { ...value, utf8MiBPerSecond: -1 },
        { ...value, highWaterRssBytes: 0 },
        { ...value, highWaterRssBytes: 1.5 },
        { ...value, cpuMicros: undefined },
        { ...value, cpuMicros: { user: -1, system: 0 } },
        { ...value, afterReleaseGc: undefined },
        { ...value, after: { ...memory, heapUsed: 1025 } },
        { ...value, before: { ...memory, external: Infinity } },
      ]
    ) expect(() => validateObservation(invalid)).toThrow()
  })
})
