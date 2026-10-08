/** Deterministic vocabulary symbol planning. @module */

import type { SymbolType, VocabularyModelType } from './model.ts'
import { compare } from './order.ts'

/** Options that control generated identifier fallback names. */
export interface NameOptionsType {
  /** Short vocabulary prefix used only when a canonical name collides or is invalid. */
  readonly prefix: string
}

/** Planned generated symbols for classes, properties, and datatypes. */
export interface NamePlanType {
  /** Normalized RDF/OWL class records discovered across the inspected sources. */
  readonly classes: ReadonlyMap<string, string>
  /** Property records or property definitions owned by this model. */
  readonly properties: ReadonlyMap<string, string>
  /** Datatype IRIs discovered or referenced by the inspected ontology sources. */
  readonly datatypes: ReadonlyMap<string, string>
  /** Generated source symbols indexed by their vocabulary IRIs. */
  readonly symbols: readonly SymbolType[]
  /** Complete export families indexed by role and IRI. */
  readonly bindings: ReadonlyMap<string, SymbolType['exports']>
}

/** ECMAScript/TypeScript words that cannot be emitted unchanged as binding identifiers. */
const RESERVED = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/**
 * Creates a byte-stable identifier plan for one vocabulary model.
 *
 * Canonical local names win when they are valid and unique. Invalid or colliding
 * names receive a deterministic vocabulary-qualified fallback. A resource can
 * have several ontology roles; each role claims its own binding. The fallback
 * is intentionally exceptional; ordinary generated APIs retain vocabulary-native
 * names such as `Product` and `name`.
 */
export function plan(model: VocabularyModelType, options: NameOptionsType): NamePlanType {
  const used = new Map<string, string>([
    'namespace',
    'namedNode',
    'NamedNode',
    'createSchema',
    'IdReferenceType',
    'NodeType',
    'ValueType',
    'VocabularySchema',
    'TypeMapType',
    'ClassNameType',
    'PropertiesForType',
    'UnionToIntersection',
    'MergedPropertiesType',
    'MultiTypeType',
  ].map((name) => [name, 'module']))
  const classes = new Map<string, string>()
  const properties = new Map<string, string>()
  const datatypes = new Map<string, string>()
  const symbols: SymbolType[] = []

  for (const value of [...model.classes].sort((left, right) => compare(left.iri, right.iri))) {
    const name = claim(preferred(value.names, value.iri), value.iri, options.prefix, used, 'Class')
    classes.set(value.iri, name)
    symbols.push({
      iri: value.iri,
      kind: 'class',
      name,
      exports: {
        term: name,
        type: `${name}Type`,
        schema: `${name}Schema`,
        properties: `${name}PropertiesType`,
      },
    })
  }
  for (
    const value of [...model.properties].sort((left, right) => compare(left.iri, right.iri))
  ) {
    const name = claim(
      preferred(value.names, value.iri),
      value.iri,
      options.prefix,
      used,
      'Property',
    )
    properties.set(value.iri, name)
    symbols.push({ iri: value.iri, kind: 'property', name, exports: { term: name } })
  }
  for (const iri of [...model.datatypes].sort(compare)) {
    const name = claim(localName(iri), iri, options.prefix, used, 'Datatype')
    datatypes.set(iri, name)
    symbols.push({ iri, kind: 'datatype', name, exports: { term: name, type: `${name}Type` } })
  }

  symbols.sort((a, b) => compare(a.iri, b.iri) || compare(a.kind, b.kind))
  return {
    classes,
    properties,
    datatypes,
    symbols,
    bindings: new Map(symbols.map((symbol) => [`${symbol.kind}:${symbol.iri}`, symbol.exports])),
  }
}

/** Selects the first valid non-reserved ontology name before falling back to the IRI local name. */
function preferred(names: readonly string[], iri: string): string {
  for (const name of names) if (isIdentifier(name) && !RESERVED.has(name)) return name
  return names[0] ?? localName(iri)
}

/** Claims one deterministic TypeScript symbol, qualifying collisions with vocabulary and kind information. */
function claim(
  candidate: string,
  iri: string,
  prefix: string,
  used: Map<string, string>,
  kind: 'Class' | 'Property' | 'Datatype',
): string {
  const identity = `${kind}:${iri}`
  const base = isIdentifier(candidate) && !RESERVED.has(candidate)
    ? candidate
    : `${safePrefix(prefix)}${pascal(candidate || localName(iri))}`
  const family = (name: string): string[] =>
    kind === 'Class'
      ? [name, `${name}Type`, `${name}Schema`, `${name}PropertiesType`]
      : kind === 'Datatype'
      ? [name, `${name}Type`]
      : [name]
  const reserve = (name: string): boolean => {
    const bindings = family(name)
    if (bindings.some((binding) => used.has(binding) && used.get(binding) !== identity)) {
      return false
    }
    for (const binding of bindings) used.set(binding, identity)
    return true
  }
  if (reserve(base)) return base
  const qualified = `${safePrefix(prefix)}${pascal(base)}${kind}`
  if (reserve(qualified)) return qualified
  const digest = `${qualified}${hash(iri)}`
  if (reserve(digest)) return digest
  // Hashes are only naming hints, never uniqueness authority.
  for (let suffix = 2;; suffix++) {
    const fallback = `${digest}_${suffix}`
    if (reserve(fallback)) return fallback
  }
}

/** Converts an arbitrary vocabulary prefix into a valid PascalCase TypeScript identifier prefix. */
function safePrefix(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_$]+/g, ' ').trim()
  const name = pascal(clean || 'Vocab')
  return /^[A-Za-z_$]/.test(name) ? name : `Vocab${name}`
}

/** Converts punctuation-separated source text into a valid PascalCase identifier candidate. */
function pascal(value: string): string {
  const parts = value.split(/[^A-Za-z0-9_$]+/g).filter(Boolean)
  const joined = parts.map((part) =>
    part.length === 0 ? '' : `${part[0]!.toUpperCase()}${part.slice(1)}`
  ).join('')
  if (!joined) return 'Term'
  return /^[A-Za-z_$]/.test(joined) ? joined : `Term${joined}`
}

/** Returns whether the supplied value satisfies the identifier contract. */
function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

/** Derives a stable source-symbol candidate from an ontology IRI without changing the IRI itself. */
function localName(iri: string): string {
  const hashIndex = iri.lastIndexOf('#')
  const slashIndex = iri.lastIndexOf('/')
  const colonIndex = iri.lastIndexOf(':')
  return decodeSafe(iri.slice(Math.max(hashIndex, slashIndex, colonIndex) + 1)) || 'Term'
}

/** Decodes percent-escaped local names while preserving malformed source text verbatim. */
function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Computes the stable short FNV-1a suffix used only when qualified symbol names still collide. */
function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36).toUpperCase()
}
