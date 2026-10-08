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
  StandardIssue,
  StandardJSONSchemaV1Props,
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
  /** Standard Schema V1 metadata property consumed by compatible schema tooling. */
  readonly '~standard':
    & StandardSchemaV1Props<Input, Output>
    & StandardJSONSchemaV1Props<Input, Output>
}

/** JSON-LD reference to another node by IRI. */
export interface IdReferenceType {
  /** JSON-LD identifier preserved on generated vocabulary node values. */
  readonly '@id': string
  /** Additional keyed values accepted by this standards-compatible structural record. */
  readonly [key: string]: unknown
}

/** Property values can appear once or as a JSON-LD value array. */
export type ValueType<T> = T | readonly T[]

/** Open-world generated JSON-LD node. */
export type NodeType<Type extends string | readonly string[], Properties extends object> = Readonly<
  & Properties
  & {
    /** JSON-LD type discriminator used by the generated vocabulary node. */
    readonly '@type': Type
    /** Retains vocabulary-specific JSON-LD properties not modeled by the standard fields. */
    readonly [key: string]: unknown
  }
  & {
    readonly [Name in keyof typeof NODE_FIELDS]?: (typeof NODE_FIELDS)[Name] extends 'string'
      ? string
      : unknown
  }
>

/**
 * Reserved JSON-LD node field classifications. Public metadata is frozen; validators stay private.
 * @id has a string value. @context remains opaque to this structural schema layer.
 */
export const NODE_FIELDS: Readonly<{
  /** Node identifiers have string values in the structural programming model. */
  readonly '@id': 'string'
  /** Context values remain opaque to this structural programming model. */
  readonly '@context': 'unknown'
}> = Object.freeze(
  {
    /** Node identifier; structural validation checks its string shape, not IRI resolution. */
    '@id': 'string',
    /** A borrowed context value retained without JSON-LD context interpretation. */
    '@context': 'unknown',
  } as const,
)

/**
 * Range labels accepted by createSchema. These classifications do not impose OWL/SHACL constraints.
 * A node range accepts a string reference or an object; unknown accepts any value.
 */
export const RANGE_KINDS: readonly ['string', 'number', 'boolean', 'node', 'unknown'] = Object
  .freeze(
    ['string', 'number', 'boolean', 'node', 'unknown'] as const,
  )

/** Runtime range classes that can be represented safely by the structural validator. */
export type RangeKindType = (typeof RANGE_KINDS)[number]

/** Generated runtime schema configuration. */
export interface SchemaConfigType {
  /** Named RDF types or generated type names attached to this record. */
  readonly types: readonly string[]
  /** Property records or property definitions owned by this model. */
  readonly properties?: Readonly<Record<string, RangeKindType | readonly RangeKindType[]>>
  /** Parent class schemas whose property ranges also apply to this class. */
  readonly parents?: () => readonly VocabularySchema[]
}

/** Internal generated schema metadata retained without copying inherited properties. */
interface SchemaStateType {
  /** Property records or property definitions owned by this model. */
  readonly properties: Readonly<Record<string, RangeKindType | readonly RangeKindType[]>>
  /** Parent schemas composed into this generated schema before local properties are checked. */
  readonly parents: () => readonly VocabularySchema[]
}

/** Generated schema metadata indexed by the public Standard Schema object. */
const schemaState = new WeakMap<object, SchemaStateType>()

/** Each range descriptor owns both validation and its JSON Schema projection. */
const ranges = {
  string: {
    valid: (value: unknown): boolean => typeof value === 'string',
    schema: { type: 'string' },
  },
  number: {
    valid: (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value),
    schema: { type: 'number' },
  },
  boolean: {
    valid: (value: unknown): boolean => typeof value === 'boolean',
    schema: { type: 'boolean' },
  },
  node: {
    valid: (value: unknown): boolean => typeof value === 'string' || isRecord(value),
    schema: { anyOf: [{ type: 'string' }, { type: 'object' }] },
  },
  unknown: { valid: (_value: unknown): boolean => true, schema: {} },
} as const satisfies Record<RangeKindType, {
  readonly valid: (value: unknown) => boolean
  readonly schema: Readonly<Record<string, unknown>>
}>

/** Reserved field projections use the same private descriptors as declared property ranges. */
const fields = Object.freeze(Object.fromEntries(
  Object.entries(NODE_FIELDS).map(([name, kind]) => [name, ranges[kind]] as const),
))

/**
 * Creates an open-world structural vocabulary schema.
 *
 * Unknown extension properties are accepted. RDFS/OWL absence is never treated
 * as requiredness; required/cardinality rules belong to a shape/profile layer.
 */
export function createSchema<Output>(config: SchemaConfigType): VocabularySchema<unknown, Output> {
  for (const name of Object.keys(config.properties ?? {})) {
    if (name === '@type' || Object.hasOwn(fields, name)) {
      throw new TypeError(`Reserved JSON-LD field '${name}' cannot be a vocabulary property.`)
    }
  }
  if (!config.types.every((type) => typeof type === 'string')) {
    throw new TypeError('Schema types must be strings.')
  }
  const types = Object.freeze([...config.types])
  const properties: Record<string, readonly RangeKindType[]> = Object.create(null)
  for (const [name, range] of Object.entries(config.properties ?? {})) {
    const kinds = Array.isArray(range) ? range : [range]
    if (!kinds.length || !kinds.every((kind) => Object.hasOwn(ranges, kind))) {
      throw new TypeError(`Invalid range for '${name}'.`)
    }
    properties[name] = Object.freeze([...kinds])
  }
  Object.freeze(properties)
  const typeShape = {
    valid: (value: unknown) => hasType(value, types),
    schema: {
      type: 'array',
      items: { type: 'string' },
      ...(types.length ? { allOf: types.map((type) => ({ contains: { const: type } })) } : {}),
    },
  }
  const validate = (value: unknown): StandardResult<Output> => {
    const issues: StandardIssue[] = []
    if (!isRecord(value)) return { issues: [{ message: 'Expected a JSON-LD object.' }] }

    if (!typeShape.valid(value['@type'])) {
      issues.push({
        message: `Expected @type to include ${types.join(', ')}.`,
        path: ['@type'],
      })
    }

    for (const [name, descriptor] of Object.entries(fields)) {
      if (value[name] !== undefined && !descriptor.valid(value[name])) {
        issues.push({ message: `Expected ${name} to be a string.`, path: [name] })
      }
    }
    visitProperties(schema, (name, range) => {
      const property = value[name]
      if (property === undefined) return
      const kinds = Array.isArray(range) ? range : [range]
      const values = Array.isArray(property) ? property : [property]
      for (let index = 0; index < values.length; index++) {
        if (!matches(values[index], kinds)) {
          issues.push({
            message: `Property '${name}' does not match its generated vocabulary range.`,
            path: [name, index],
          })
        }
      }
    })

    return issues.length === 0 ? { value: value as Output } : { issues }
  }

  const jsonSchema = (options: JsonSchemaOptions): Record<string, unknown> => {
    const schemaUri = getSchemaUri(options.target)
    const properties: Record<string, unknown> = {
      '@type': types.length === 1
        ? { anyOf: [{ const: types[0] }, structuredClone(typeShape.schema)] }
        : structuredClone(typeShape.schema),
      ...Object.fromEntries(
        Object.entries(fields).map((
          [name, descriptor],
        ) => [name, structuredClone(descriptor.schema)]),
      ),
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
    properties,
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
  visit: (name: string, range: RangeKindType | readonly RangeKindType[]) => void,
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
function matches(value: unknown, kinds: readonly RangeKindType[]): boolean {
  return kinds.some((kind) => ranges[kind].valid(value))
}

/** Converts the same descriptors used by runtime validation into JSON Schema. */
function jsonRange(kinds: readonly RangeKindType[]): Record<string, unknown> {
  const schemas = kinds.map((kind) => structuredClone(ranges[kind].schema))
  return schemas.length === 1 ? schemas[0]! : { anyOf: schemas }
}

/** Resolves a supported Standard JSON Schema target to its canonical meta-schema URI. */
function getSchemaUri(target: JsonSchemaTarget): string | undefined {
  if (target === 'draft-2020-12') return 'https://json-schema.org/draft/2020-12/schema'
  if (target === 'draft-07') return 'http://json-schema.org/draft-07/schema#'
  if (target === 'openapi-3.0') {
    throw new TypeError(
      'OpenAPI 3.0 conversion is not implemented because it is not JSON Schema-equivalent.',
    )
  }
  throw new TypeError(`Unsupported JSON Schema target '${target}'.`)
}
