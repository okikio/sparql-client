/** Generated vocabulary TypeScript compiler benchmark. @module */

import { dirname, join } from 'node:path'
import { arch, cpus, platform, release, totalmem } from 'node:os'

import { collect } from '../../.mise/tasks/bench-command.ts'

import { parseDiagnostics } from './diagnostics.ts'
import type { DiagnosticsType } from './diagnostics.ts'

import { emit } from '../../packages/vocab/emit.ts'
import type { ClassType, PropertyType, VocabularyModelType } from '../../packages/vocab/model.ts'

interface CaseType {
  readonly name: string
  readonly classes: number
  readonly propertiesPerClass: number
  readonly shape: 'flat' | 'tree' | 'deep'
  readonly multiTypes?: number
}

interface ResultType extends DiagnosticsType {
  readonly case: string
  readonly classes: number
  readonly properties: number
  readonly shape: CaseType['shape']
  readonly multiTypes: number
  readonly stdout: string
  readonly stderr: string
  readonly sourceBytes: number
  readonly generationMs: number
  readonly compilerWallMs: number
}

const cases: readonly CaseType[] = [
  { name: 'baseline-1-flat', classes: 1, propertiesPerClass: 1, shape: 'flat' },
  { name: 'flat-100', classes: 100, propertiesPerClass: 4, shape: 'flat' },
  { name: 'flat-500', classes: 500, propertiesPerClass: 4, shape: 'flat' },
  { name: 'flat-1000', classes: 1_000, propertiesPerClass: 4, shape: 'flat' },
  { name: 'tree-1000', classes: 1_000, propertiesPerClass: 2, shape: 'tree' },
  { name: 'deep-100', classes: 100, propertiesPerClass: 1, shape: 'deep' },
  { name: 'deep-500', classes: 500, propertiesPerClass: 1, shape: 'deep' },
  { name: 'deep-1000', classes: 1_000, propertiesPerClass: 1, shape: 'deep' },
  { name: 'multi-2', classes: 64, propertiesPerClass: 4, shape: 'tree', multiTypes: 2 },
  { name: 'multi-4', classes: 64, propertiesPerClass: 4, shape: 'tree', multiTypes: 4 },
  { name: 'multi-8', classes: 64, propertiesPerClass: 4, shape: 'tree', multiTypes: 8 },
]

const supportSource = `
export interface NamedNode { readonly termType: 'NamedNode'; readonly value: string }
export function namedNode(value: string): NamedNode { return { termType: 'NamedNode', value } }
export { createSchema, type IdReferenceType, type ValueType, type NodeType, type VocabularySchema } from './runtime.ts'
`

const selected = selectCases(Deno.args)
/** Compiler evidence has its own snapshot; it is distinct from native Mitata measurements. */
const outputDirectory = Deno.env.get('BENCH_TYPES_REPORT') ??
  `.tmp/reports/types/${new Date().toISOString().replaceAll(':', '-')}`
await Deno.mkdir(outputDirectory, { recursive: true })
const inputs = await identity()
let compilerPaths: readonly string[] = []
const results: ResultType[] = []
const metadata = {
  version: 2,
  status: 'running' as 'running' | 'pass' | 'fail' | 'invalid',
  runtime: Deno.version,
  compiler: 'typescript 5.9.3',
  compilerInputs: undefined as Readonly<Record<string, string>> | undefined,
  compilerInputsAfter: undefined as Readonly<Record<string, string>> | undefined,
  date: new Date().toISOString(),
  host: {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    memoryBytes: totalmem(),
  },
  method:
    'one isolated compiler process per fixture; pin checked before cases; generation times only emit; compiler wall includes process startup; OS caches warm or unknown; Memory used is compiler-reported heapUsed at diagnostic reporting, rounded to nearest decimal kilobyte (1000 bytes); optional global.gc precedes it only when exposed; it is not peak RSS or retained memory',
  selectedCases: selected.map((value) => value.name),
  currentCase: undefined as string | undefined,
  inputs,
  inputsAfter: undefined as Readonly<Record<string, string>> | undefined,
  failure: undefined as string | undefined,
  results,
}
const failures: unknown[] = []
try {
  await save()
  const version = await collect(Deno.execPath(), [
    'run',
    '--no-config',
    '--no-lock',
    '--node-modules-dir=none',
    '--cached-only',
    '--quiet',
    '--allow-read',
    '--allow-env',
    'npm:typescript@5.9.3/bin/tsc',
    '--version',
  ])
  await Deno.writeFile(`${outputDirectory}/compiler-version.stdout`, version.stdout)
  await Deno.writeFile(`${outputDirectory}/compiler-version.stderr`, version.stderr)
  if (!version.success || new TextDecoder().decode(version.stdout).trim() !== 'Version 5.9.3') {
    throw new Error(
      `The isolated compiler did not confirm TypeScript 5.9.3 (exit ${
        version.code ?? 'unreported'
      }).`,
      { cause: version.error },
    )
  }
  compilerPaths = await compilerFiles()
  metadata.compilerInputs = await hashes(compilerPaths)
  await save()
  for (const value of selected) {
    metadata.currentCase = value.name
    await save()
    results.push(await measure(value))
    await save()
  }
  metadata.currentCase = undefined
  metadata.status = 'pass'
} catch (error) {
  failures.push(error)
  metadata.status = 'fail'
} finally {
  try {
    metadata.inputsAfter = await identity()
    if (compilerPaths.length) {
      metadata.compilerInputsAfter = await hashes(compilerPaths)
      if (
        JSON.stringify(metadata.compilerInputs) !== JSON.stringify(metadata.compilerInputsAfter)
      ) {
        metadata.status = 'invalid'
        failures.push(
          new Error('Compiler package or bundled declarations changed during measurements.'),
        )
      }
    }
    if (JSON.stringify(inputs) !== JSON.stringify(metadata.inputsAfter)) {
      metadata.status = 'invalid'
      failures.push(new Error('Compiler source or configuration changed during measurements.'))
    }
  } catch (error) {
    failures.push(error)
    metadata.status = 'fail'
  }
  metadata.failure = failures.length ? failures.map(String).join('\n') : undefined
  try {
    await save()
  } catch (error) {
    failures.push(error)
    if (metadata.status !== 'invalid') metadata.status = 'fail'
    console.error('Compiler final evidence write failed:', error)
  }
}
if (failures.length) throw new AggregateError(failures, 'Compiler benchmark or evidence failed.')
console.log(JSON.stringify(output(), null, 2))

/** Baseline deltas remain descriptive single-process observations, never percentile claims. */
function output(): object {
  const baseline = results.find((entry) => entry.case === 'baseline-1-flat')
  return {
    ...metadata,
    outputDirectory,
    baseline: baseline?.case,
    results: results.map((entry) => ({
      ...entry,
      compilerDeltaMs: baseline ? entry.compilerWallMs - baseline.compilerWallMs : undefined,
      memoryDeltaBytes: baseline ? entry.memoryBytes - baseline.memoryBytes : undefined,
    })),
  }
}
/** Keep partial fixtures and raw outputs after failures rather than certifying absent diagnostics. */
async function save(): Promise<void> {
  await Deno.writeTextFile(
    `${outputDirectory}/report.json`,
    `${JSON.stringify(output(), null, 2)}\n`,
  )
}
/** Hash every generator/runtime input actually used, together with the compiler pin/configuration. */
async function identity(): Promise<Readonly<Record<string, string>>> {
  const paths = [
    'bench/vocab/types.ts',
    '.mise/tasks/bench-command.ts',
    'bench/vocab/diagnostics.ts',
    'packages/vocab/emit.ts',
    'packages/vocab/manifest.ts',
    'packages/vocab/name.ts',
    'packages/vocab/model.ts',
    'packages/vocab/runtime.ts',
    'packages/vocab/standard.ts',
    'deno.json',
    'deno.lock',
    'package.json',
  ]
  return await hashes(paths)
}
/** Hash files without modifying source/configuration or dependency metadata. */
async function hashes(paths: readonly string[]): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}
  for (const path of paths.toSorted()) {
    const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(path))
    result[path] = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  return result
}
/** Resolve the actual cached compiler outside timing, isolated from ancestor config/lock/node_modules. */
async function compilerFiles(): Promise<readonly string[]> {
  const output = await collect(Deno.execPath(), [
    'eval',
    '--no-config',
    '--no-lock',
    '--node-modules-dir=none',
    '--cached-only',
    'const module=await import("npm:typescript@5.9.3"); const ts=module.default??module; console.log(JSON.stringify({version:ts.version,entry:ts.sys.getExecutingFilePath()}))',
  ])
  await Deno.writeFile(`${outputDirectory}/compiler-location.stdout`, output.stdout)
  await Deno.writeFile(`${outputDirectory}/compiler-location.stderr`, output.stderr)
  if (!output.success) {
    throw new Error(
      `Unable to resolve the isolated cached TypeScript compiler (exit ${
        output.code ?? 'unreported'
      }).`,
      { cause: output.error },
    )
  }
  const located: { version?: unknown; entry?: unknown } = JSON.parse(
    new TextDecoder().decode(output.stdout),
  )
  if (located.version !== '5.9.3' || typeof located.entry !== 'string') {
    throw new Error('Unexpected compiler location/version.')
  }
  const library = dirname(located.entry)
  const files = [
    join(library, '..', 'package.json'),
    join(library, '..', 'bin', 'tsc'),
    join(library, 'tsc.js'),
    join(library, '_tsc.js'),
    located.entry,
  ]
  for await (const entry of Deno.readDir(library)) {
    if (entry.isFile && entry.name.endsWith('.d.ts')) files.push(join(library, entry.name))
  }
  return files
}

/** Measures one generated vocabulary with an isolated TypeScript compiler process. */
async function measure(value: CaseType): Promise<ResultType> {
  const model = createModel(value)
  const generationStart = performance.now()
  const generated = emit(model, {
    vocabulary: value.name,
    namespace: 'https://example.com/vocab/',
    prefix: '',
    rdfImport: './support.ts',
    runtimeImport: './support.ts',
  })
  const generationMs = performance.now() - generationStart
  const directory = await Deno.makeTempDir({ prefix: 'okikio-vocab-type-bench-' })
  let failed = false
  let primary: unknown
  try {
    const raw = `${outputDirectory}/${value.name}`
    await Deno.mkdir(raw, { recursive: true })
    const vocab = `${directory}/vocab.ts`
    const support = `${directory}/support.ts`
    const use = `${directory}/use.ts`
    await Deno.writeTextFile(vocab, generated.source)
    await Deno.writeTextFile(support, supportSource)
    // The generated module must compile against the actual public runtime contract.
    await Deno.copyFile('packages/vocab/runtime.ts', `${directory}/runtime.ts`)
    await Deno.copyFile('packages/vocab/standard.ts', `${directory}/standard.ts`)
    await Deno.writeTextFile(use, useSource(value))
    for (const file of ['vocab.ts', 'support.ts', 'use.ts', 'runtime.ts', 'standard.ts']) {
      await Deno.copyFile(`${directory}/${file}`, `${raw}/${file}`)
    }

    const start = performance.now()
    const result = await collect(Deno.execPath(), [
      'run',
      '--no-config',
      '--no-lock',
      '--node-modules-dir=none',
      '--cached-only',
      '--quiet',
      '--allow-read',
      '--allow-env',
      'npm:typescript@5.9.3/bin/tsc',
      '--noEmit',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--noUncheckedIndexedAccess',
      '--skipLibCheck',
      'false',
      '--target',
      'ESNext',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--allowImportingTsExtensions',
      '--extendedDiagnostics',
      use,
      vocab,
      support,
    ])
    const compilerWallMs = performance.now() - start
    const stdout = new TextDecoder().decode(result.stdout)
    const stderr = new TextDecoder().decode(result.stderr)
    const stdoutPath = `${raw}/compiler.stdout`
    const stderrPath = `${raw}/compiler.stderr`
    await Deno.writeFile(stdoutPath, result.stdout)
    await Deno.writeFile(stderrPath, result.stderr)
    if (!result.success) {
      throw new Error(
        `TypeScript failed for ${value.name} (exit ${
          result.code ?? 'unreported'
        }):\n${stdout}\n${stderr}`,
        { cause: result.error },
      )
    }

    return {
      case: value.name,
      classes: value.classes,
      properties: value.classes * value.propertiesPerClass,
      shape: value.shape,
      multiTypes: value.multiTypes ?? 0,
      stdout: stdoutPath,
      stderr: stderrPath,
      sourceBytes: new TextEncoder().encode(generated.source).byteLength,
      generationMs,
      compilerWallMs,
      ...parseDiagnostics(stdout),
    }
  } catch (error) {
    failed = true
    primary = error
    throw error
  } finally {
    await remove(directory, failed ? [primary] : [])
  }
}

/** Cleanup cannot replace an original compiler/write rejection, including undefined. */
async function remove(directory: string, primary: readonly unknown[]): Promise<void> {
  try {
    await Deno.remove(directory, { recursive: true })
  } catch (error) {
    throw new AggregateError([...primary, error], 'Compiler fixture cleanup failed.')
  }
}

function createModel(value: CaseType): VocabularyModelType {
  const classes: ClassType[] = []
  const properties: PropertyType[] = []
  for (let index = 0; index < value.classes; index++) {
    const iri = `https://example.com/vocab/Class${index}`
    classes.push({
      iri,
      names: [`Class${index}`],
      labels: [],
      comments: [],
      superClasses: getSupers(index, value.shape),
      equivalentClasses: [],
      disjointClasses: [],
      deprecated: false,
    })
    for (let propertyIndex = 0; propertyIndex < value.propertiesPerClass; propertyIndex++) {
      properties.push({
        iri: `https://example.com/vocab/property${index}_${propertyIndex}`,
        names: [`property${index}_${propertyIndex}`],
        labels: [],
        comments: [],
        domains: [iri],
        ranges: ['http://www.w3.org/2001/XMLSchema#string'],
        superProperties: [],
        equivalentProperties: [],
        inverseOf: [],
        disjointProperties: [],
        kinds: ['rdf'],
        characteristics: [],
        functional: false,
        deprecated: false,
      })
    }
  }
  return {
    sources: [{ id: `synthetic:${value.name}` }],
    classes,
    properties,
    datatypes: ['http://www.w3.org/2001/XMLSchema#string'],
    assertions: [],
    diagnostics: [],
  }
}

function getSupers(index: number, shape: CaseType['shape']): readonly string[] {
  if (index === 0 || shape === 'flat') return []
  if (shape === 'deep') return [`https://example.com/vocab/Class${index - 1}`]
  return [`https://example.com/vocab/Class${Math.floor((index - 1) / 4)}`]
}

function useSource(value: CaseType): string {
  const last = Math.max(0, value.classes - 1)
  const typeImports = ['Class0Type']
  if (last !== 0) typeImports.push(`Class${last}Type`)
  if (value.multiTypes) typeImports.push('MultiTypeType')
  const lines = [
    `import type { ${typeImports.join(', ')} } from './vocab.ts'`,
    'declare const first: Class0Type',
    `declare const last: Class${last}Type`,
    'void first',
    'void last',
    `const own: string | readonly string[] | undefined = last.property${last}_0`,
    'void own',
    `// @ts-expect-error A string-range property rejects numeric values.`,
    `const invalidProperty: typeof last.property${last}_0 = 1`,
    'void invalidProperty',
    '// @ts-expect-error The generated node retains its class discriminator.',
    `const invalidType: typeof last['@type'] = 'OtherClass'`,
    'void invalidType',
  ]
  if (value.shape !== 'flat') {
    lines.push('const inherited: string | readonly string[] | undefined = last.property0_0')
    lines.push('void inherited')
    lines.push('// @ts-expect-error Inherited string ranges reject numeric values.')
    lines.push('const invalidInherited: typeof last.property0_0 = 1')
    lines.push('void invalidInherited')
  }
  if (value.multiTypes) {
    const names = Array.from({ length: value.multiTypes }, (_, index) => `'Class${index}'`).join(
      ', ',
    )
    lines.push(`type Combined = MultiTypeType<readonly [${names}]>`)
    lines.push('declare const combined: Combined')
    lines.push('void combined')
    for (let index = 0; index < value.multiTypes; index++) {
      lines.push(
        `const combined${index}: string | readonly string[] | undefined = combined.property${index}_0`,
      )
      lines.push(`void combined${index}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function selectCases(args: readonly string[]): readonly CaseType[] {
  const names = args.filter((value) => !value.startsWith('-'))
  if (names.length === 0) return cases
  return names.map((name) => {
    const value = cases.find((entry) => entry.name === name)
    if (!value) throw new Error(`Unknown benchmark case: ${name}`)
    return value
  })
}
