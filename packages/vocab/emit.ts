/** TypeScript vocabulary source emitter. @module */

import type { ManifestType, PropertyType, VocabularyModelType } from './model.ts'
import { inherit } from './inherit.ts'
import { createManifest } from './manifest.ts'
import { type NamePlanType, plan } from './name.ts'
import type { RangeKindType } from './runtime.ts'

/** TypeScript vocabulary emission options. */
export interface EmitOptionsType {
  /** Human-readable vocabulary name used in generated module documentation and manifest metadata. */
  readonly vocabulary: string
  /** Base vocabulary namespace IRI used by every generated term. */
  readonly namespace: string
  /** Preferred generated identifier prefix when a vocabulary needs one. */
  readonly prefix: string
  /** Module specifier used by generated source for RDF runtime imports. */
  readonly rdfImport?: string
  /** Module specifier used by generated source for vocabulary runtime imports. */
  readonly runtimeImport?: string
  /** Maximum classes, properties, datatypes and declared inheritance/domain/range edges. Default 100,000. */
  readonly maxTerms?: number
  /** Maximum UTF-8 bytes of emitted TypeScript. Default 32 MiB; limits flattened inheritance output. */
  readonly maxBytes?: number
  /** Maximum effective property references materialized while resolving the inheritance DAG. Default 1,000,000. */
  readonly maxProperties?: number
  /** Caller cancellation checked before planning and at emitted lines. Synchronous work is not preemptible. */
  readonly signal?: AbortSignal
}

/** Complete deterministic vocabulary generation result. */
export interface EmitResultType {
  /** Complete generated TypeScript module source. */
  readonly source: string
  /** Deterministic manifest that maps source IRIs to emitted TypeScript symbols. */
  readonly manifest: ManifestType
}

/**
 * Emits a directly importable TypeScript vocabulary module.
 *
 * The generated source contains RDF term constants, JSON-LD property interfaces,
 * class node types, Standard Schema validators, and a multi-type composition map.
 * It intentionally keeps the ontology IR independent of TypeScript syntax.
 */
export function emit(model: VocabularyModelType, options: EmitOptionsType): EmitResultType {
  if (options.signal?.aborted) throw options.signal.reason
  const maxTerms = options.maxTerms ?? 100_000, maxBytes = options.maxBytes ?? 32 * 1024 * 1024
  for (const [name, value] of [['maxTerms', maxTerms], ['maxBytes', maxBytes]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`)
    }
  }
  let terms = model.classes.length + model.properties.length + model.datatypes.length
  for (const value of model.classes) terms += value.superClasses.length
  for (const value of model.properties) terms += value.domains.length + value.ranges.length
  if (terms > maxTerms) throw new RangeError(`Vocabulary model exceeds maxTerms (${maxTerms}).`)
  const names = plan(model, { prefix: options.prefix })
  const inherited = inherit(model, {
    ...(options.maxProperties === undefined ? {} : { maxProperties: options.maxProperties }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const writer = new Writer(maxBytes, options.signal)
  const rdfImport = options.rdfImport ?? '@okikio/rdf'
  const runtimeImport = options.runtimeImport ?? '@okikio/vocab/runtime'

  writer.line('/**')
  writer.line(` * Generated ${options.vocabulary} vocabulary terms, types, and schemas.`)
  writer.line(' *')
  writer.line(' * This file is generated. Edit the ontology source or generator instead.')
  writer.line(' * @module')
  writer.line(' */')
  writer.line('')
  writer.line(`import { namedNode, type NamedNode } from ${quote(rdfImport)}`)
  writer.line(
    `import { createSchema, type IdReferenceType, type NodeType, type ValueType, type VocabularySchema } from ${
      quote(runtimeImport)
    }`,
  )
  writer.line('')
  writer.line('/** Base IRI used by every generated vocabulary term in this module. */')
  writer.line(`export const namespace = ${quote(options.namespace)}`)
  writer.line('')

  emitTerms(writer, model, names)
  emitProperties(writer, model, names, inherited)
  emitClasses(writer, model, names, inherited)
  emitTypeMap(writer, model, names)

  return {
    source: `${writer.toString()}\n`,
    manifest: createManifest(options.vocabulary, model, names),
  }
}

/** Emit terms deterministically to the caller-owned output. */
function emitTerms(writer: Writer, model: VocabularyModelType, names: NamePlanType): void {
  writer.line('/** RDF class terms. */')
  for (const value of model.classes) {
    const name = names.classes.get(value.iri)!
    emitDoc(writer, value.comments, value.deprecated, `RDF class term for ${name}.`)
    writer.line(`export const ${name}: NamedNode = namedNode(${quote(value.iri)})`)
  }
  writer.line('')

  writer.line('/** RDF datatype terms. */')
  for (const iri of model.datatypes) {
    const name = names.datatypes.get(iri)!
    writer.line(`/** RDF datatype term for ${name}. */`)
    writer.line(`export const ${name}: NamedNode = namedNode(${quote(iri)})`)
  }
  writer.line('')

  writer.line('/** RDF property terms. */')
  for (const value of model.properties) {
    const name = names.properties.get(value.iri)!
    emitDoc(writer, value.comments, value.deprecated, `RDF property term for ${name}.`)
    writer.line(`export const ${name}: NamedNode = namedNode(${quote(value.iri)})`)
  }
  writer.line('')
}

/** Emit properties deterministically to the caller-owned output. */
function emitProperties(
  writer: Writer,
  model: VocabularyModelType,
  names: NamePlanType,
  byDomain: ReadonlyMap<string, readonly PropertyType[]>,
): void {
  for (const value of model.classes) {
    const className = names.classes.get(value.iri)!
    writer.line(
      `/** JSON-LD properties directly available to ${className}, including inherited structural properties. */`,
    )
    writer.line(`export interface ${names.bindings.get(`class:${value.iri}`)!.properties} {`)
    writer.indent(() => {
      for (const property of byDomain.get(value.iri) ?? []) {
        const propertyName = names.properties.get(property.iri)!
        emitDoc(
          writer,
          property.comments,
          property.deprecated,
          `JSON-LD value for ${propertyName}.`,
        )
        writer.line(
          `readonly ${propertyKey(propertyName)}?: ValueType<${propertyType(property, names)}>`,
        )
      }
    })
    writer.line('}')
    writer.line('')
  }
}

/** Emit classes deterministically to the caller-owned output. */
function emitClasses(
  writer: Writer,
  model: VocabularyModelType,
  names: NamePlanType,
  directProperties: ReadonlyMap<string, readonly PropertyType[]>,
): void {
  for (const value of model.classes) {
    const name = names.classes.get(value.iri)!
    writer.line(`/** JSON-LD node typed as ${name}. */`)
    writer.line(
      `export type ${names.bindings.get(`class:${value.iri}`)!.type} = NodeType<${quote(name)}, ${
        names.bindings.get(`class:${value.iri}`)!.properties
      }>`,
    )
    writer.line(`/** Standard Schema validator and JSON Schema converter for ${name}. */`)
    writer.line(
      `export const ${
        names.bindings.get(`class:${value.iri}`)!.schema
      }: VocabularySchema<unknown, ${
        names.bindings.get(`class:${value.iri}`)!.type
      }> = createSchema<${names.bindings.get(`class:${value.iri}`)!.type}>({`,
    )
    writer.indent(() => {
      writer.line(`types: [${quote(name)}],`)
      const properties = directProperties.get(value.iri) ?? []
      if (properties.length > 0) {
        writer.line('properties: {')
        writer.indent(() => {
          for (const property of properties) {
            const propertyName = names.properties.get(property.iri)!
            writer.line(`${propertyKey(propertyName)}: ${rangeLiteral(property, names)},`)
          }
        })
        writer.line('},')
      }
    })
    writer.line('})')
    writer.line('')
  }
}

/** Emit type map deterministically to the caller-owned output. */
function emitTypeMap(writer: Writer, model: VocabularyModelType, names: NamePlanType): void {
  writer.line('/** Generated datatype value aliases. */')
  for (const iri of model.datatypes) {
    const name = names.datatypes.get(iri)!
    writer.line(`/** JavaScript value type for the ${name} RDF datatype. */`)
    writer.line(
      `export type ${names.bindings.get(`datatype:${iri}`)!.type} = ${
        scalarType(iri) ?? 'unknown'
      }`,
    )
  }
  writer.line('')
  writer.line(
    '/** Generated class-name to property-interface map used by multi-typed JSON-LD nodes. */',
  )
  writer.line('export interface TypeMapType {')
  writer.indent(() => {
    for (const value of model.classes) {
      const name = names.classes.get(value.iri)!
      writer.line(`/** Property interface contributed by ${name} nodes. */`)
      writer.line(
        `readonly ${propertyKey(name)}: ${names.bindings.get(`class:${value.iri}`)!.properties}`,
      )
    }
  })
  writer.line('}')
  writer.line('')
  writer.line('/** Every generated vocabulary class name accepted by multi-type nodes. */')
  writer.line('export type ClassNameType = keyof TypeMapType')
  writer.line('/** Resolves one generated class name to its property interface. */')
  writer.line(
    'export type PropertiesForType<Type extends ClassNameType> = Type extends keyof TypeMapType ? TypeMapType[Type] : never',
  )
  writer.line(
    '/** Converts the selected class-property union into one intersection for multi-typed nodes. */',
  )
  writer.line(
    'export type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends (value: infer Intersection) => void ? Intersection : never',
  )
  writer.line('')
  writer.line(
    '/** Intersects the properties contributed by every class on a multi-typed JSON-LD node. */',
  )
  writer.line(
    'export type MergedPropertiesType<Types extends readonly ClassNameType[]> = UnionToIntersection<PropertiesForType<Types[number]>> & object',
  )
  writer.line(
    '/** JSON-LD node carrying all properties contributed by the selected generated class names. */',
  )
  writer.line(
    'export type MultiTypeType<Types extends readonly ClassNameType[]> = NodeType<Types, MergedPropertiesType<Types>>',
  )
}

/** Builds the generated TypeScript value type for one ontology property range. */
function propertyType(property: PropertyType, names: NamePlanType): string {
  if (property.ranges.length === 0) return 'unknown'
  const types = new Set<string>()
  for (const range of property.ranges) {
    const scalar = scalarType(range)
    if (scalar) types.add(scalar)
    else {
      const className = names.classes.get(range)
      types.add(
        className
          ? `string | ${
            names.bindings.get(`class:${range}`)!.type
          } | IdReferenceType | Readonly<Record<string, unknown>>`
          : 'unknown',
      )
    }
  }
  return [...types].sort().join(' | ') || 'unknown'
}

/** Maps known RDF datatype IRIs to JavaScript-native TypeScript scalar types. */
function scalarType(iri: string): string | undefined {
  if (iri === 'https://schema.org/Text' || iri === 'http://schema.org/Text') return 'string'
  if (iri === 'https://schema.org/URL' || iri === 'http://schema.org/URL') return 'string'
  if (iri === 'https://schema.org/Number' || iri === 'http://schema.org/Number') return 'number'
  if (iri === 'https://schema.org/Integer' || iri === 'http://schema.org/Integer') return 'number'
  if (iri === 'https://schema.org/Float' || iri === 'http://schema.org/Float') return 'number'
  if (iri === 'https://schema.org/Boolean' || iri === 'http://schema.org/Boolean') return 'boolean'
  if (iri === 'http://www.w3.org/2001/XMLSchema#string') return 'string'
  if (iri === 'http://www.w3.org/2001/XMLSchema#boolean') return 'boolean'
  if (
    /^http:\/\/www\.w3\.org\/2001\/XMLSchema#(?:decimal|double|float|integer|int|long|short|byte|nonNegativeInteger|nonPositiveInteger|positiveInteger|negativeInteger|unsignedLong|unsignedInt|unsignedShort|unsignedByte)$/
      .test(iri)
  ) return 'number'
  return undefined
}

/** Builds the runtime range descriptor emitted into a generated Standard Schema. */
function rangeLiteral(property: PropertyType, names: NamePlanType): string {
  const kinds = new Set<RangeKindType>()
  if (property.ranges.length === 0) kinds.add('unknown')
  for (const range of property.ranges) {
    const scalar = scalarType(range)
    if (scalar === 'string') kinds.add('string')
    else if (scalar === 'number') kinds.add('number')
    else if (scalar === 'boolean') kinds.add('boolean')
    else kinds.add(names.classes.has(range) ? 'node' : 'unknown')
  }
  const values = [...kinds].sort()
  return values.length === 1 ? quote(values[0]!) : `[${values.map(quote).join(', ')}]`
}

/** Writes normalized ontology documentation and deprecation metadata into generated TSDoc. */
function emitDoc(
  writer: Writer,
  comments: readonly {
    /** One human-readable documentation line emitted before the generated vocabulary symbol. */
    readonly value: string
  }[],
  deprecated: boolean,
  fallback: string,
): void {
  writer.line('/**')
  writer.line(` * ${comments[0] ? cleanDoc(comments[0].value) : fallback}`)
  if (deprecated) writer.line(' * @deprecated The vocabulary marks this term as deprecated.')
  writer.line(' */')
}

/** Normalizes ontology prose so it is safe to embed in one generated TSDoc block. */
function cleanDoc(value: string): string {
  return value.replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim()
}

/** Serializes a generated property or class name as a valid TypeScript object key. */
function propertyKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : quote(value)
}

/** Serializes one deterministic JavaScript string literal for generated source. */
function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `'${escaped}'`
}

/** Internal Writer implementation and its owned state. */
class Writer {
  /** Generated source lines accumulated in deterministic emission order. */
  #lines: string[] = []
  /** Current indentation depth applied when the writer appends a source line. */
  #depth = 0
  #bytes = 0
  readonly #maxBytes: number
  readonly #signal?: AbortSignal
  /** Owns only output admission, without external resources. */
  constructor(maxBytes: number, signal?: AbortSignal) {
    this.#maxBytes = maxBytes
    this.#signal = signal
  }

  /** Appends one source line at the current indentation depth. */
  line(value = ''): void {
    if (this.#signal?.aborted) throw this.#signal.reason
    const line = `${'  '.repeat(this.#depth)}${value}`
    if (line.length + this.#bytes + 1 > this.#maxBytes) {
      throw new RangeError(`Vocabulary output exceeds maxBytes (${this.#maxBytes}).`)
    }
    this.#bytes += new TextEncoder().encode(line).byteLength + 1
    if (this.#bytes > this.#maxBytes) {
      throw new RangeError(`Vocabulary output exceeds maxBytes (${this.#maxBytes}).`)
    }
    this.#lines.push(line)
  }

  /** Runs one nested emission step and restores indentation even when it throws. */
  indent(write: () => void): void {
    this.#depth++
    try {
      write()
    } finally {
      this.#depth--
    }
  }

  /** Joins emitted lines without adding a trailing newline. */
  toString(): string {
    return this.#lines.join('\n')
  }
}
