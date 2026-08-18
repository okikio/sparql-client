/** Generated vocabulary TypeScript compiler benchmark. @module */

import { emit } from '../../packages/vocab/emit.ts'
import type { ClassType, PropertyType, VocabularyModelType } from '../../packages/vocab/model.ts'

interface CaseType {
  readonly name: string
  readonly classes: number
  readonly propertiesPerClass: number
  readonly shape: 'flat' | 'tree' | 'deep'
  readonly multiTypes?: number
}

interface ResultType {
  readonly case: string
  readonly classes: number
  readonly properties: number
  readonly shape: CaseType['shape']
  readonly multiTypes: number
  readonly sourceBytes: number
  readonly generationMs: number
  readonly compilerWallMs: number
  readonly files?: number
  readonly linesOfLibrary?: number
  readonly linesOfTypeScript?: number
  readonly identifiers?: number
  readonly symbols?: number
  readonly types?: number
  readonly instantiations?: number
  readonly memoryBytes?: number
  readonly parseMs?: number
  readonly bindMs?: number
  readonly checkMs?: number
  readonly totalMs?: number
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
export interface IdReferenceType { readonly '@id': string }
export type ValueType<Value> = Value | readonly Value[]
export type NodeType<Name, Properties extends object> = Readonly<Properties> & {
  readonly '@type': Name
  readonly '@id'?: string
}
export function createSchema<Value>(_options: unknown): { readonly '~standard': unknown } {
  return { '~standard': {} }
}
`

const selected = selectCases(Deno.args)
const results: ResultType[] = []
for (const value of selected) results.push(await measure(value))

const baseline = results.find((entry) => entry.case === 'baseline-1-flat')
const output = {
  version: 1,
  runtime: `deno ${Deno.version.deno}`,
  compiler: 'typescript 5.9.3',
  date: new Date().toISOString(),
  baseline: baseline?.case,
  results: results.map((entry) => ({
    ...entry,
    compilerDeltaMs: baseline ? entry.compilerWallMs - baseline.compilerWallMs : undefined,
    memoryDeltaBytes:
      baseline && entry.memoryBytes !== undefined && baseline.memoryBytes !== undefined
        ? entry.memoryBytes - baseline.memoryBytes
        : undefined,
  })),
}
console.log(JSON.stringify(output, null, 2))

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

  try {
    const vocab = `${directory}/vocab.ts`
    const support = `${directory}/support.ts`
    const use = `${directory}/use.ts`
    await Deno.writeTextFile(vocab, generated.source)
    await Deno.writeTextFile(support, supportSource)
    await Deno.writeTextFile(use, useSource(value))

    const start = performance.now()
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
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
      ],
      stdout: 'piped',
      stderr: 'piped',
    })
    const result = await command.output()
    const compilerWallMs = performance.now() - start
    const stdout = new TextDecoder().decode(result.stdout)
    const stderr = new TextDecoder().decode(result.stderr)
    if (!result.success) {
      throw new Error(`TypeScript failed for ${value.name}:\n${stdout}\n${stderr}`)
    }

    return {
      case: value.name,
      classes: value.classes,
      properties: value.classes * value.propertiesPerClass,
      shape: value.shape,
      multiTypes: value.multiTypes ?? 0,
      sourceBytes: new TextEncoder().encode(generated.source).byteLength,
      generationMs,
      compilerWallMs,
      ...parseDiagnostics(stdout),
    }
  } finally {
    await Deno.remove(directory, { recursive: true })
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
  ]
  if (value.multiTypes) {
    const names = Array.from({ length: value.multiTypes }, (_, index) => `'Class${index}'`).join(
      ', ',
    )
    lines.push(`type Combined = MultiTypeType<readonly [${names}]>`)
    lines.push('declare const combined: Combined')
    lines.push('void combined')
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

function parseDiagnostics(text: string): Partial<ResultType> {
  const values = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:]+):\s+([\d.]+)\s*(K|M|s|ms)?$/.exec(line.trim())
    if (!match) continue
    const raw = Number(match[2])
    const unit = match[3]
    values.set(
      match[1]!.trim(),
      unit === 'K'
        ? raw * 1024
        : unit === 'M'
        ? raw * 1024 * 1024
        : unit === 's'
        ? raw * 1000
        : raw,
    )
  }
  return {
    ...optional('files', values.get('Files')),
    ...optional('linesOfLibrary', values.get('Lines of Library')),
    ...optional('linesOfTypeScript', values.get('Lines of TypeScript')),
    ...optional('identifiers', values.get('Identifiers')),
    ...optional('symbols', values.get('Symbols')),
    ...optional('types', values.get('Types')),
    ...optional('instantiations', values.get('Instantiations')),
    ...optional('memoryBytes', values.get('Memory used')),
    ...optional('parseMs', values.get('Parse time')),
    ...optional('bindMs', values.get('Bind time')),
    ...optional('checkMs', values.get('Check time')),
    ...optional('totalMs', values.get('Total time')),
  }
}

function optional<Key extends string>(
  key: Key,
  value: number | undefined,
): Partial<Record<Key, number>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, number>>
}
