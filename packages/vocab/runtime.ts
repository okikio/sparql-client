/**
 * Dependency-free Standard Schema runtime used by generated vocabularies.
 *
 * Standard Schema explicitly permits implementations to copy the interfaces,
 * which keeps generated vocabulary validation interoperable without imposing a
 * schema-library dependency on consumers.
 *
 * @module
 */

import type {
  JsonSchemaOptions,
  JsonSchemaTarget,
  StandardJSONSchemaV1Props,
  StandardIssue,
  StandardResult,
  StandardSchemaV1Props,
} from './standard.ts'

export type {
  JsonSchemaOptions,
  JsonSchemaTarget,
  StandardFailureResult,
  StandardInferInput,
  StandardInferOutput,
  StandardIssue,
  StandardJSONSchemaConverter,
  StandardJSONSchemaV1,
  StandardPathSegment,
  StandardResult,
  StandardSchemaOptions,
  StandardSchemaV1,
  StandardSuccessResult,
  StandardTypedTypes,
  StandardTypedV1,
} from './standard.ts'

/** Combined validator and JSON Schema converter exposed by generated classes. */
export interface VocabularySchema<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output> & StandardJSONSchemaV1Props<Input, Output>
}

/** JSON-LD reference to another node by IRI. */
export interface IdReferenceType {
  readonly '@id': string
  readonly [key: string]: unknown
}

/** Property values can appear once or as a JSON-LD value array. */
export type ValueType<T> = T | readonly T[]

/** Open-world generated JSON-LD node. */
export type NodeType<Type extends string | readonly string[], Properties extends object> = Readonly<
  Properties & {
    readonly '@type': Type
    readonly '@id'?: string
    readonly '@context'?: unknown
    readonly [key: string]: unknown
  }
>

/** Runtime range classes that can be represented safely by the structural validator. */
export type RangeKind = 'string' | 'number' | 'boolean' | 'node' | 'unknown'

/** Generated runtime schema configuration. */
export interface SchemaConfigType {
  readonly types: readonly string[]
  readonly properties?: Readonly<Record<string, RangeKind | readonly RangeKind[]>>
  /** Parent class schemas whose property ranges also apply to this class. */
  readonly parents?: () => readonly VocabularySchema[]
}

/** Internal generated schema metadata retained without copying inherited properties. */
interface SchemaStateType {
  readonly properties: Readonly<Record<string, RangeKind | readonly RangeKind[]>>
  readonly parents: () => readonly VocabularySchema[]
}

/** Generated schema metadata indexed by the public Standard Schema object. */
const schemaState = new WeakMap<object, SchemaStateType>()

/**
 * Creates an open-world structural vocabulary schema.
 *
 * Unknown extension properties are accepted. RDFS/OWL absence is never treated
 * as requiredness; required/cardinality rules belong to a shape/profile layer.
 */
export function createSchema<Output>(config: SchemaConfigType): VocabularySchema<unknown, Output> {
  const validate = (value: unknown): StandardResult<Output> => {
    const issues: StandardIssue[] = []
    if (!isRecord(value)) return { issues: [{ message: 'Expected a JSON-LD object.' }] }

    if (!hasType(value['@type'], config.types)) {
      issues.push({ message: `Expected @type to include ${config.types.join(', ')}.`, path: ['@type'] })
    }

    visitProperties(schema, (name, range) => {
      const property = value[name]
      if (property === undefined) return
      const kinds = Array.isArray(range) ? range : [range]
      const values = Array.isArray(property) ? property : [property]
      for (let index = 0; index < values.length; index++) {
        if (!matches(values[index], kinds)) {
          issues.push({ message: `Property '${name}' does not match its generated vocabulary range.`, path: [name, index] })
        }
      }
    })

    return issues.length === 0 ? { value: value as Output } : { issues }
  }

  const jsonSchema = (options: JsonSchemaOptions): Record<string, unknown> => {
    const schemaUri = getSchemaUri(options.target)
    const properties: Record<string, unknown> = {
      '@type': {
        anyOf: [
          config.types.length === 1 ? { const: config.types[0] } : { enum: [...config.types] },
          {
            type: 'array',
            items: { type: 'string' },
            allOf: config.types.map((type) => ({ contains: { const: type } })),
          },
        ],
      },
      '@id': { type: 'string' },
    }
    visitProperties(schema, (name, range) => {
      const kinds = Array.isArray(range) ? range : [range]
      const item = jsonRange(kinds)
      properties[name] = { anyOf: [item, { type: 'array', items: item }] }
    })
    return {
      ...(schemaUri ? { $schema: schemaUri } : {}),
      type: 'object',
      required: ['@type'],
      properties,
      additionalProperties: true,
    }
  }

  const schema: VocabularySchema<unknown, Output> = {
    '~standard': {
      version: 1,
      vendor: '@okikio/vocab',
      validate,
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
  }
  schemaState.set(schema, {
    properties: config.properties ?? {},
    parents: config.parents ?? (() => []),
  })
  return schema
}

/**
 * Visits each inherited property once without materializing a merged property map.
 *
 * Ontologies can contain redundant or cyclic superclass declarations. The schema
 * object identity is therefore the cycle key. Child properties win when two
 * ancestors declare the same JSON-LD key because the child is visited first.
 */
function visitProperties(
  schema: VocabularySchema,
  visit: (name: string, range: RangeKind | readonly RangeKind[]) => void,
): void {
  const schemas = [schema]
  const seenSchemas = new Set<object>()
  const seenProperties = new Set<string>()
  while (schemas.length > 0) {
    const current = schemas.pop()!
    if (seenSchemas.has(current)) continue
    seenSchemas.add(current)
    const state = schemaState.get(current)
    if (!state) continue
    for (const [name, range] of Object.entries(state.properties)) {
      if (seenProperties.has(name)) continue
      seenProperties.add(name)
      visit(name, range)
    }
    const parents = state.parents()
    for (let index = parents.length - 1; index >= 0; index--) schemas.push(parents[index]!)
  }
}

/** Returns whether a value is a non-array JSON object that can represent a JSON-LD node. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Checks whether a JSON-LD @type value satisfies every generated class type required by the schema. */
function hasType(value: unknown, required: readonly string[]): boolean {
  if (typeof value === 'string') return required.length === 1 && value === required[0]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return false
  return required.every((type) => value.includes(type))
}

/** Checks one JSON-LD property value against the generated open-world range kinds. */
function matches(value: unknown, kinds: readonly RangeKind[]): boolean {
  if (kinds.includes('unknown')) return true
  return kinds.some((kind) => {
    switch (kind) {
      case 'string': return typeof value === 'string'
      case 'number': return typeof value === 'number' && Number.isFinite(value)
      case 'boolean': return typeof value === 'boolean'
      case 'node': return typeof value === 'string' || isRecord(value)
      case 'unknown': return true
    }
  })
}

/** Converts generated vocabulary range kinds into their JSON Schema representation. */
function jsonRange(kinds: readonly RangeKind[]): Record<string, unknown> {
  const schemas = kinds.map((kind): Record<string, unknown> => {
    switch (kind) {
      case 'string': return { type: 'string' }
      case 'number': return { type: 'number' }
      case 'boolean': return { type: 'boolean' }
      case 'node': return { anyOf: [{ type: 'string' }, { type: 'object' }] }
      case 'unknown': return {}
    }
  })
  return schemas.length === 1 ? schemas[0]! : { anyOf: schemas }
}

/** Resolves a supported Standard JSON Schema target to its canonical meta-schema URI. */
function getSchemaUri(target: JsonSchemaTarget): string | undefined {
  if (target === 'draft-2020-12') return 'https://json-schema.org/draft/2020-12/schema'
  if (target === 'draft-07') return 'http://json-schema.org/draft-07/schema#'
  if (target === 'openapi-3.0') throw new TypeError('OpenAPI 3.0 conversion is not implemented because it is not JSON Schema-equivalent.')
  throw new TypeError(`Unsupported JSON Schema target '${target}'.`)
}
