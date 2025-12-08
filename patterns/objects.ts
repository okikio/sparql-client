/**
 * Cypher-inspired pattern matching for SPARQL
 * 
 * Makes queries more intuitive by hiding SPARQL's verbose syntax:
 * 
 * @example
 * ```ts
 * // Instead of: ?person a foaf:Person ; foaf:name ?name
 * // Write: node('person', Person).prop('name', var('name'))
 * 
 * // Instead of: ?person foaf:knows ?friend
 * // Write: rel('person', knows, 'friend')
 * ```
 */

import {
  normalizeVariableName,
  raw,
  variable,
  type SparqlValue,
} from '../sparql.ts'

import { 
  triples,
  triple,
  tripleSubjectString,
  triplePredicateString,
  type TripleSubject,
  type TriplePredicate,
  type TripleObject,
  type PredicateObjectMap,
} from "./triples.ts"

// ============================================================================
// Best Practice: Always Use Explicit Functions
// ============================================================================

/**
 * BEST PRACTICE: Use explicit functions for ALL values
 * 
 * ✅ GOOD: node('person', Person).prop('name', str('Alice'))
 * ✅ GOOD: node('person', Person).prop('age', num(30))
 * ❌ BAD:  node('person', Person).prop('name', 'Alice')  // Implicit conversion
 * 
 * Why? Clarity and intent. When reading code, you immediately know:
 * - str() = literal string value
 * - var() = SPARQL variable
 * - iri() = IRI reference
 * - num() = numeric literal
 */

// Unified "Node"/"NodePattern" and "Relationship"/"RelationshipPattern" patterns.

// A single "atomic" property value can be either:
// - a normal triple object (literal/IRI/var)
// - another Node (nested resource)
export type PropertyAtomic = TripleObject | Node

// The real stored type can be a single or an array.
export type PropertyValue = PropertyAtomic | PropertyAtomic[]

// ---------------------------------------------------------------------------
// ResourcePattern: describes a single resource (node)
// ---------------------------------------------------------------------------

export interface NodePropertyMap { 
  [predicate: string]: PropertyValue
}

/**
 * A resource (node) pattern: subject + rdf:type(s) + properties.
 *
 * Implements SparqlValue so you can pass it to .where().
 * Its .value is a group of triples describing that subject.
 * 
 * 
 * APPROACH 1: Nested Object Pattern
 * 
 * Most intuitive for developers familiar with JSON/JavaScript.
 * 
 * ⚠️ RDF SEMANTICS: This LOOKS nested but generates flat triples.
 * In RDF, all properties are edges. We're just making the DX nicer.
 * 
 * @example
 * ```typescript
 * const pattern = node('?product is narrative:Product', {
 *   'narrative:productTitle': '?title',
 *   'narrative:publishedBy': node('?publisher is narrative:Publisher', {
 *     'rdfs:label': str('Marvel Comics'),
 *   }),
 * });
 * 
 * // Generates:
 * // ?product a narrative:Product .
 * // ?product narrative:productTitle ?title .
 * // ?product narrative:publishedBy ?publisher .
 * // ?publisher a narrative:Publisher .
 * // ?publisher rdfs:label "Marvel Comics" .
 * ```
 */
export class Node implements SparqlValue {
  readonly __sparql = true
  // The SPARQL term for this node's subject, e.g. ?product
  readonly subjectTerm: SparqlValue
  // Just the variable name, mainly for debugging
  private readonly varName: string
  
  // rdf:type values and properties
  private readonly typesTerm: TriplePredicate[] = []
  private readonly properties: NodePropertyMap = {}

  // Getters return `this` - zero overhead, pure syntax
  get is(): this { return this }
  get with(): this { return this }
  get and(): this { return this }
  get that(): this { return this }
  get has(): this { return this }

  constructor(subject: TripleSubject, type?: TriplePredicate | TriplePredicate[], options?: NodePropertyMap) {
    const subjectString = tripleSubjectString(subject)
    const variableName = normalizeVariableName(subjectString.trim())
    
    this.varName = variableName
    this.subjectTerm = variable(variableName)

    // Handle type(s) explicitly
    if (type) {
      if (Array.isArray(type)) {
        this.typesTerm.push(...type)
      } else {
        this.typesTerm.push(type)
      }
    }

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        this.prop(key, value)
      }
    }
  }

  /**
   * Helper: create a node bound to ?<name>
   */
  static create(name: string, type?: TriplePredicate | TriplePredicate[], options?: NodePropertyMap): Node {
    return new Node(name, type, options)
  }

  /**
   * Access the subject term (?product) when this node is used as an object.
   */
  term(): SparqlValue {
    return this.subjectTerm
  }

  /**
   * Add an rdf:type triple.
   *
   * @example
   * resource.a('narrative:Product')
   */
  a(typeIri: TriplePredicate): this {
    this.typesTerm.push(typeIri)
    return this
  }

  /** Alias to {@link a} */ 
  type(typeIri: TriplePredicate): this {
    this.a(typeIri)
    return this
  }

  /**
   * Set multiple types for a node backed by {@link a}
   * @param typesIri 
   * @returns 
   */
  types(typesIri: TriplePredicate[]): this { 
    for (const typeIri of typesIri)
      this.a(typeIri);
    return this

  }

  /**
   * Add a property.
   *
   * Value can be:
   * - a primitive/literal/IRI/var (TripleObject)
   * - another Node
   * - an array of those
   *
   * @example
   * resource.prop('narrative:productTitle', 'Amazing Spider-Man #1')
   */
  prop(predicate: string | SparqlValue, value: TripleObject | TripleObject[]): this {
    const key = typeof predicate === 'string' ? predicate : predicate.value
    const existing = this.properties[key]
    if (existing === undefined) {
      this.properties[key] = value
    }
    
    if (Array.isArray(existing)) {
      if (Array.isArray(value)) {
        existing.push(...value)
      } else {
        existing.push(value)
      }
    } else {
      // existing is atomic
      if (Array.isArray(value)) {
        this.properties[key] = [existing, ...value]
      } else {
        this.properties[key] = [existing, value]
      }
    }
    return this
  }

  /**
   * Set multiple {@link prop}'s at the same time
   * 
   * @param map 
   * @returns 
   */
  props(map: Record<string, TripleObject | TripleObject[]>): this {
    for (const [key, value] of Object.entries(map)) {
      this.prop(key, value)
    }
    return this
  }

  /**
   * Build the triples for this node and any nested nodes, ensuring that:
   *
   * - this node's subject is used as the subject for its properties
   * - nested Node values are used as triple *objects* via .term()
   * - nested Node patterns are also emitted (recursively)
   * - cycles are guarded against via the visited set
   */
  private buildPatternInternal(visited: Set<Node>): string {
    if (visited.has(this)) {
      // Avoid infinite recursion if there are cycles.
      return ''
    }
    visited.add(this)

    const poNormalized: PredicateObjectMap = {}
    const nestedChunks: string[] = []

    // ---- rdf:type ----
    if (this.typesTerm.length > 0) {
      const typeObjs: TripleObject[] = this.typesTerm.map((t) =>
        typeof t === 'string' ? t : t.value,
      )
      const existing = poNormalized['rdf:type']
      if (existing === undefined) {
        poNormalized['rdf:type'] = typeObjs
      } else if (Array.isArray(existing)) {
        poNormalized['rdf:type'] = [...existing, ...typeObjs]
      } else {
        poNormalized['rdf:type'] = [existing, ...typeObjs]
      }
    }

    // ---- properties (including nested Nodes) ----
    const pushAtomic = (key: string, atomic: PropertyAtomic): void => {
      let object: TripleObject

      if (atomic instanceof Node) {
        // Use the Node's term as the object (e.g. ?publisher)
        object = atomic.term()
        // And also append its own pattern
        const nested = atomic.buildPatternInternal(visited)
        if (nested.trim().length > 0) {
          nestedChunks.push(nested)
        }
      } else {
        // Normal TripleObject (literal/IRI/var)
        object = atomic
      }

      const existing = poNormalized[key]
      if (existing === undefined) {
        poNormalized[key] = object
      } else if (Array.isArray(existing)) {
        existing.push(object)
      } else {
        poNormalized[key] = [existing, object]
      }
    }

    for (const [key, value] of Object.entries(this.properties)) {
      if (Array.isArray(value)) {
        for (const atomic of value) {
          pushAtomic(key, atomic)
        }
      } else {
        pushAtomic(key, value)
      }
    }

    // ---- build this node's own triples ----
    const selfPattern = triples(this.subjectTerm, poNormalized).value

    // Combine this node's triples with any nested node triples.
    const allChunks = [selfPattern, ...nestedChunks].filter(
      (chunk) => chunk.trim().length > 0,
    )

    return allChunks.join('\n')
  }

  /**
   * Expose the pattern as a SparqlValue.
   *
   * This is what the query builder will see when you call .where(node(...)).
   */
  pattern(): SparqlValue {
    const visited = new Set<Node>()
    const text = this.buildPatternInternal(visited)
    return raw(text)
  }

  /**
   * Implement SparqlValue directly for convenience.
   * WARNING: This is the *pattern*, NOT the term. For use as an object in
   * a triple, always use .term() instead.
   */
  get value(): string {
    return this.pattern().value
  }

  getVarName(): string {
    return this.varName
  }
}

// ---------------------------------------------------------------------------
// RelationshipPattern: describes a relationship between two resources
// ---------------------------------------------------------------------------

export interface RelationshipPropertyMap {
  [predicate: string]: PropertyValue
}

/**
 * Relationship between two nodes.
 *
 * Minimal form:
 * ```ts
 *   rel('product', 'narrative:publishedBy', 'publisher')
 * ```
 *
 * If you want the relationship to also carry properties, you can reify
 * with `.with.prop(...)` as before.
 *
 * NOTE: Relationship itself does not try to include node patterns; you
 * should add the relevant nodes to the WHERE clause separately:
 * ```ts
 *   builder.where(product).where(publisher).where(publishedBy)
 * ```
 * 
 *
 * By default it simply emits:
 * ```sparql
 *   from predicate to .
 * ```
 *
 * If properties are added, it emits:
 * ```sparql
 *   from predicate to .
 *   _:edge rdf:type some:RelationshipType ;
 *          some:from from ;
 *          some:to to ;
 *          ...props...
 * ```
 * 
 * You can later refine this reification scheme to your OWL-ish style.
 */
export class Relationship implements SparqlValue {
  readonly __sparql = true
  private readonly fromNode?: Node
  private readonly toNode?: Node
  private readonly fromTerm: TripleSubject
  private readonly toTerm: TripleSubject
  private readonly predicate: TriplePredicate
  private readonly properties: RelationshipPropertyMap = {}

  // Getters that return this for chaining
  get with(): this { return this }
  get and(): this { return this }
  get that(): this { return this }
  get has(): this { return this }

  constructor(
    from: Node | TripleSubject,
    predicate: TriplePredicate,
    to: Node | TripleSubject,
  ) {
    if (from instanceof Node) {
      this.fromNode = from
      this.fromTerm = from.term()
    } else {
      const fromString = tripleSubjectString(from)
      this.fromTerm = variable(normalizeVariableName(fromString.trim()))
    }

    if (to instanceof Node) {
      this.toNode = to
      this.toTerm = to.term()
    } else {
      const toString = tripleSubjectString(to)
      this.toTerm = variable(normalizeVariableName(toString.trim()))
    }

    this.predicate = predicate
  }

  static create(
    fromVar: string,
    predicate: TriplePredicate,
    toVar: string,
  ): Relationship {
    return new Relationship(fromVar, predicate, toVar)
  }

  /**
   * Add a property on the relationship itself (reification).
   */
  prop(predicate: string | SparqlValue, value: TripleObject | TripleObject[]): this {
    const key = typeof predicate === 'string' ? predicate : predicate.value
    const existing = this.properties[key]
    if (existing === undefined) {
      this.properties[key] = value
    } else if (Array.isArray(existing)) {
      if (Array.isArray(value)) {
        existing.push(...value)
      } else {
        existing.push(value)
      }
    } else {
      this.properties[key] = Array.isArray(value) ? [existing, ...value] : [existing, value]
    }
    return this
  }

  // Deterministic edge ID based on content
  private getEdgeId(): string {
    const hash = simpleHash(`${tripleSubjectString(this.fromTerm)}|${triplePredicateString(this.predicate)}|${tripleSubjectString(this.toTerm)}`)
    return `_:edge_${hash}`
  }

  private buildTriples(): SparqlValue {
    const base = triple(this.fromTerm, this.predicate, this.toTerm)

    // If no relationship properties, just return the base triple.
    const keys = Object.keys(this.properties)
    if (keys.length === 0) {
      return base
    }

    // Otherwise, reify with a blank node.
    const edgeId = this.getEdgeId()
    const poMap: RelationshipPropertyMap = {
      'rdf:type': 'narrative:Relationship',
      'narrative:from': this.fromTerm,
      'narrative:to': this.toTerm,
      ...this.properties,
    }

    const edgeTriples = triples(edgeId, poMap)

    return raw(`${base.value}\n${edgeTriples.value}`)
  }

  get value(): string {
    return this.buildTriples().value
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers around patterns
// ---------------------------------------------------------------------------

/**
 * A small helper to create a resource with type in one go.
 *
 * @example
 * const product = node('product')
 *   .is.a('narrative:Product')
 *   .with.prop('narrative:productTitle', variable('title'))
 */
export function node(name: string, type?: TriplePredicate | TriplePredicate[], options?: NodePropertyMap): Node {
  return Node.create(name, type, options)
}

/**
 * Relationship helper with variable subjects.
 *
 * @example
 * const rel = rel('product', 'narrative:publishedBy', 'publisher')
 */
export function rel(
  fromVar: string,
  predicate: TriplePredicate,
  toVar: string,
): Relationship {
  return Relationship.create(fromVar, predicate, toVar)
}


/**
 * Match pattern (combines multiple patterns)
 * 
 * Cypher-inspired way to build graph patterns
 * 
 * @example
 * ```ts
 * match(
 *   node('person', Person).prop('name', var('name')),
 *   rel('person', knows, 'friend'),
 *   node('friend', Person)
 * )
 * ```
 */
export function match(
  ...patterns: Array<Node | Relationship | SparqlValue>
): SparqlValue {
  const built = patterns.map((p) => p.value)

  return raw(`${built.join('\n    ')}`)
}

// ============================================================================
// Common Domain Patterns
// ============================================================================

/**
 * PopModern narrative types (convenience)
 */
export const Types = {
  Character: raw('narrative:Character'),
  Series: raw('narrative:Series'),
  Product: raw('narrative:Product'),
  Person: raw('narrative:Person'),
  Organization: raw('narrative:Organization'),
  Universe: raw('narrative:Universe'),
  StoryWork: raw('narrative:StoryWork'),
}

/**
 * PopModern narrative relationships (convenience)
 */
export const Relationships = {
  createdBy: raw('narrative:createdBy'),
  publishedBy: raw('narrative:publishedBy'),
  featuresCharacter: raw('narrative:featuresCharacter'),
  partOfSeries: raw('narrative:partOfSeries'),
  partOfUniverse: raw('narrative:partOfUniverse'),
  adaptationOf: raw('narrative:adaptationOf'),

  // FOAF relationships
  knows: raw('foaf:knows'),
  member: raw('foaf:member'),
}

/**
 * Common predicates (convenience)
 */
export const Props = {
  name: raw('rdfs:label'),
  characterName: raw('narrative:characterName'),
  seriesName: raw('narrative:seriesName'),
  productTitle: raw('narrative:productTitle'),
  releaseDate: raw('narrative:releaseDate'),
  storeDate: raw('narrative:storeDate'),
  issueNumber: raw('narrative:issueNumber'),
}

export function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}