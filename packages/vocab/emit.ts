/** TypeScript vocabulary source emitter. @module */

import type { ManifestType, PropertyType, VocabularyModelType } from './model.ts'
import { createManifest } from './manifest.ts'
import { plan, type NamePlanType } from './name.ts'
import type { RangeKind } from './runtime.ts'

/** TypeScript vocabulary emission options. */
export interface EmitOptionsType {
  readonly vocabulary: string
  readonly namespace: string
  readonly prefix: string
  readonly rdfImport?: string
  readonly runtimeImport?: string
}

/** Complete deterministic vocabulary generation result. */
export interface EmitResultType {
  readonly source: string
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
  const names = plan(model, { prefix: options.prefix })
  const writer = new Writer()
  const rdfImport = options.rdfImport ?? '@okikio/rdf'
  const runtimeImport = options.runtimeImport ?? '@okikio/vocab/runtime'

  writer.line('/**')
  writer.line(` * Generated ${options.vocabulary} vocabulary terms, types, and schemas.`)
  writer.line(' *')
  writer.line(' * This file is generated. Edit the ontology source or generator instead.')
  writer.line(' * @module')
  writer.line(' */')
  writer.line('')
  writer.line(`import { namedNode } from ${quote(rdfImport)}`)
  writer.line(`import { createSchema, type IdReferenceType, type NodeType, type ValueType } from ${quote(runtimeImport)}`)
  writer.line('')
  writer.line('/** Base IRI used by every generated vocabulary term in this module. */')
  writer.line(`export const namespace = ${quote(options.namespace)}`)
  writer.line('')

  emitTerms(writer, model, names)
  emitProperties(writer, model, names)
  emitClasses(writer, model, names)
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
    writer.line(`export const ${name} = namedNode(${quote(value.iri)})`)
  }
  writer.line('')

  writer.line('/** RDF datatype terms. */')
  for (const iri of model.datatypes) {
    const name = names.datatypes.get(iri)!
    writer.line(`/** RDF datatype term for ${name}. */`)
    writer.line(`export const ${name} = namedNode(${quote(iri)})`)
  }
  writer.line('')

  writer.line('/** RDF property terms. */')
  for (const value of model.properties) {
    const name = names.properties.get(value.iri)!
    emitDoc(writer, value.comments, value.deprecated, `RDF property term for ${name}.`)
    writer.line(`export const ${name} = namedNode(${quote(value.iri)})`)
  }
  writer.line('')
}

/** Emit properties deterministically to the caller-owned output. */
function emitProperties(writer: Writer, model: VocabularyModelType, names: NamePlanType): void {
  const byDomain = propertiesByDomain(model)
  for (const value of model.classes) {
    const className = names.classes.get(value.iri)!
    const supers = value.superClasses
      .map((iri) => names.classes.get(iri))
      .filter((name): name is string => name !== undefined)
      .map((name) => `${name}PropertiesType`)
    const heritage = supers.length > 0 ? ` extends ${supers.join(', ')}` : ''
    writer.line(`/** JSON-LD properties directly available to ${className}, including inherited interfaces. */`)
    writer.line(`export interface ${className}PropertiesType${heritage} {`)
    writer.indent(() => {
      for (const property of byDomain.get(value.iri) ?? []) {
        const propertyName = names.properties.get(property.iri)!
        writer.line(`readonly ${propertyKey(propertyName)}?: ValueType<${propertyType(property, names)}>`)
      }
    })
    writer.line('}')
    writer.line('')
  }
}

/** Emit classes deterministically to the caller-owned output. */
function emitClasses(writer: Writer, model: VocabularyModelType, names: NamePlanType): void {
  const directProperties = propertiesByDomain(model)
  for (const value of model.classes) {
    const name = names.classes.get(value.iri)!
    const parents = value.superClasses
      .map((iri) => names.classes.get(iri))
      .filter((parent): parent is string => parent !== undefined)
    writer.line(`/** JSON-LD node typed as ${name}. */`)
    writer.line(`export type ${name}Type = NodeType<${quote(name)}, ${name}PropertiesType>`)
    writer.line(`/** Standard Schema validator and JSON Schema converter for ${name}. */`)
    writer.line(`export const ${name}Schema = createSchema<${name}Type>({`)
    writer.indent(() => {
      writer.line(`types: [${quote(name)}],`)
      if (parents.length > 0) writer.line(`parents: () => [${parents.map((parent) => `${parent}Schema`).join(', ')}],`)
      const properties = directProperties.get(value.iri) ?? []
      if (properties.length > 0) {
        writer.line('properties: {')
        writer.indent(() => {
          for (const property of properties) {
            const propertyName = names.properties.get(property.iri)!
            writer.line(`${propertyKey(propertyName)}: ${rangeLiteral(property)},`)
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
    writer.line(`export type ${name}Type = ${scalarType(iri) ?? 'unknown'}`)
  }
  writer.line('')
  writer.line('/** Generated class-name to property-interface map used by multi-typed JSON-LD nodes. */')
  writer.line('export interface TypeMapType {')
  writer.indent(() => {
    for (const value of model.classes) {
      const name = names.classes.get(value.iri)!
      writer.line(`readonly ${propertyKey(name)}: ${name}PropertiesType`)
    }
  })
  writer.line('}')
  writer.line('')
  writer.line('/** Every generated vocabulary class name accepted by multi-type nodes. */')
  writer.line('export type ClassNameType = keyof TypeMapType')
  writer.line('/** Resolves one generated class name to its property interface. */')
  writer.line('type PropertiesForType<Type extends ClassNameType> = Type extends keyof TypeMapType ? TypeMapType[Type] : never')
  writer.line('/** Converts the selected class-property union into one intersection for multi-typed nodes. */')
  writer.line('type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends (value: infer Intersection) => void ? Intersection : never')
  writer.line('')
  writer.line('/** Intersects the properties contributed by every class on a multi-typed JSON-LD node. */')
  writer.line('type MergedPropertiesType<Types extends readonly ClassNameType[]> = UnionToIntersection<PropertiesForType<Types[number]>> & object')
  writer.line('/** JSON-LD node carrying all properties contributed by the selected generated class names. */')
  writer.line('export type MultiTypeType<Types extends readonly ClassNameType[]> = NodeType<Types, MergedPropertiesType<Types>>')
}

/** Indexes properties by directly declared domain without treating RDFS domain as requiredness. */
function propertiesByDomain(model: VocabularyModelType): Map<string, PropertyType[]> {
  const result = new Map<string, PropertyType[]>()
  for (const property of model.properties) {
    for (const domain of property.domains) {
      const values = result.get(domain) ?? []
      values.push(property)
      result.set(domain, values)
    }
  }
  for (const values of result.values()) values.sort((a, b) => a.iri.localeCompare(b.iri))
  return result
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
      types.add(className ? `${className}Type | IdReferenceType` : 'unknown')
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
  if (/^http:\/\/www\.w3\.org\/2001\/XMLSchema#(?:decimal|double|float|integer|int|long|short|byte|nonNegativeInteger|nonPositiveInteger|positiveInteger|negativeInteger|unsignedLong|unsignedInt|unsignedShort|unsignedByte)$/.test(iri)) return 'number'
  return undefined
}

/** Builds the runtime range descriptor emitted into a generated Standard Schema. */
function rangeLiteral(property: PropertyType): string {
  const kinds = new Set<RangeKind>()
  if (property.ranges.length === 0) kinds.add('unknown')
  for (const range of property.ranges) {
    const scalar = scalarType(range)
    if (scalar === 'string') kinds.add('string')
    else if (scalar === 'number') kinds.add('number')
    else if (scalar === 'boolean') kinds.add('boolean')
    else kinds.add('node')
  }
  const values = [...kinds].sort()
  return values.length === 1 ? quote(values[0]!) : `[${values.map(quote).join(', ')}]`
}

/** Writes normalized ontology documentation and deprecation metadata into generated TSDoc. */
function emitDoc(
  writer: Writer,
  comments: readonly { readonly value: string }[],
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
  #lines: string[] = []
  #depth = 0

  /** Appends one source line at the current indentation depth. */
  line(value = ''): void {
    this.#lines.push(`${'  '.repeat(this.#depth)}${value}`)
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
