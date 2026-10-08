/** Checks generated benchmark output through its consumer API before timing compiler work. @module */

import type { EmitResultType } from '../../packages/vocab/emit.ts'

/**
 * Import all fixture terms and use every emitted class schema.
 *
 * The synthetic fixture gives property N a string range and domain ClassN. Source
 * spacing, comments, declaration annotations and interface spelling are incidental.
 * This runtime check does not replace the separate compiler-consumer lane. The
 * imported fixture is cached once by Deno, outside timed compilation callbacks.
 */
export async function expectCompilation(
  output: EmitResultType,
  classes: number,
  properties: number,
): Promise<void> {
  const expected = [
    ...Array.from({ length: classes }, (_, index) => ({
      kind: 'class',
      name: `Class${index}`,
      iri: `https://example.test/Class${index}`,
    })),
    ...Array.from({ length: properties }, (_, index) => ({
      kind: 'property',
      name: `property${index}`,
      iri: `https://example.test/property${index}`,
    })),
  ]
  const keys = (values: readonly { kind: string; name: string; iri: string }[]): string[] =>
    values.map(({ kind, name, iri }) => JSON.stringify([kind, name, iri])).sort()
  if (JSON.stringify(keys(output.manifest.symbols)) !== JSON.stringify(keys(expected))) {
    throw new Error('Vocabulary compiler benchmark manifest identities differ.')
  }
  const generated: Record<string, unknown> = await import(
    `data:application/typescript,${encodeURIComponent(output.source)}`
  )
  for (const { name, iri } of expected) {
    const value = record(generated[name])
    if (value.termType !== 'NamedNode' || value.value !== iri) {
      throw new Error(`Vocabulary compiler benchmark export ${name} differs.`)
    }
  }
  for (let index = 0; index < classes; index++) {
    const schema = record(generated[`Class${index}Schema`])
    const standard = record(schema['~standard'])
    if (typeof standard.validate !== 'function') throw new Error('Missing generated validator.')
    const property = `property${index}`
    const valid = {
      '@type': `Class${index}`,
      ...(index < properties ? { [property]: 'value' } : {}),
    }
    const positive = record(await Reflect.apply(standard.validate, standard, [valid]))
    const value = positive.issues === undefined ? record(positive.value) : undefined
    if (
      value?.['@type'] !== valid['@type'] || (index < properties && value[property] !== 'value')
    ) {
      throw new Error(`Generated Class${index}Schema rejects its supported fixture.`)
    }
    const wrongType = record(
      await Reflect.apply(standard.validate, standard, [{ ...valid, '@type': 'OtherClass' }]),
    )
    if (
      !Array.isArray(wrongType.issues) || !wrongType.issues.some((issue: unknown) => {
        const path = record(issue).path
        return Array.isArray(path) && path.includes('@type')
      })
    ) throw new Error(`Generated Class${index}Schema lost its class-type rejection.`)
    if (index >= properties) continue
    const negative = record(
      await Reflect.apply(standard.validate, standard, [{ ...valid, [property]: 1 }]),
    )
    if (
      !Array.isArray(negative.issues) || !negative.issues.some((issue: unknown) => {
        const path = record(issue).path
        return Array.isArray(path) && path.includes(property)
      })
    ) throw new Error(`Generated Class${index}Schema lost its string-range rejection.`)
  }
}

/** Unexpected result shapes cannot pass as missing or empty validation output. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Missing generated vocabulary value.')
  }
  return value as Readonly<Record<string, unknown>>
}
