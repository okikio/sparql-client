/**
 * Graph pattern matching inspired by Cypher.
 * 
 * SPARQL's verbose syntax makes queries hard to read, especially when you're describing
 * complex graph structures. These pattern helpers let you think in terms of nodes and
 * relationships instead of raw triples.
 * 
 * The core idea comes from Cypher (Neo4j's query language). Instead of repeating
 * `?person foaf:name ?name ; foaf:age ?age`, you describe the node once with all its
 * properties. Relationships work similarly - you define how nodes connect without
 * manually writing every triple.
 * 
 * This is syntactic sugar that generates standard SPARQL triples under the hood.
 * The benefit is readability - your queries look more like the graph you're querying.
 * 
 * @module
 */

import {
  normalizeVariableName,
  raw,
  variable,
  SPARQL_VALUE_BRAND,
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
// Design Philosophy
// ============================================================================

/**
 * Best practice: Use explicit value constructors.
 * 
 * When building patterns, always use str(), num(), v() etc. for values.
 * Don't rely on implicit conversion. This makes your intent clear and avoids
 * ambiguity about whether something is a literal value or a variable name.
 * 
 * Good: node('person', Person).prop('name', str('Alice'))
 * Good: node('person', Person).prop('age', num(30))
 * Bad:  node('person', Person).prop('name', 'Alice')  // Unclear intent
 * 
 * The explicit style makes it obvious what's a value vs. a variable vs. an IRI.
 */

// ============================================================================
// Node Patterns
// ============================================================================

/**
 * Property value for a node.
 * 
 * Can be a simple triple object (literal, IRI, variable) or another Node for
 * nested structures. Arrays let you specify multiple values for one property.
 */
export type PropertyAtomic = TripleObject | Node
export type PropertyValue = PropertyAtomic | PropertyAtomic[]

/**
 * Map of property names to values.
 */
export interface NodePropertyMap { 
  [predicate: string]: PropertyValue
}

/**
 * A node in your graph pattern.
 * 
 * Nodes represent resources - people, places, things. Each node has a variable that will bind to
 * matching resources in your data. You can specify the node's type (what kind of resource it is)
 * and properties (facts about it). Properties can be simple values, variables, or other nodes for
 * nested structures. When you nest nodes, the library generates all necessary triples automatically.
 * 
 * The pattern gets compiled to SPARQL triples, but you write it in a more intuitive nested structure.
 * This handles the bookkeeping of variable names and relationships between nodes. You can also nest
 * relationships within properties to create patterns that combine node and edge metadata.
 * 
 * @example Basic node
 * ```ts
 * const person = node('person', 'foaf:Person')
 * // Generates: ?person a foaf:Person .
 * ```
 * 
 * @example Node with properties
 * ```ts
 * const person = node('person', 'foaf:Person', {
 *   'foaf:name': v('name'),
 *   'foaf:age': v('age')
 * })
 * // Generates:
 * // ?person a foaf:Person .
 * // ?person foaf:name ?name .
 * // ?person foaf:age ?age .
 * ```
 * 
 * @example Nested nodes (one level)
 * ```ts
 * const product = node('product', 'schema:Product', {
 *   'schema:name': v('title'),
 *   'schema:publisher': node('publisher', 'schema:Organization', {
 *     'rdfs:label': str('Marvel Comics')
 *   })
 * })
 * // Generates:
 * // ?product a schema:Product .
 * // ?product schema:name ?title .
 * // ?product schema:publisher ?publisher .
 * // ?publisher a schema:Organization .
 * // ?publisher rdfs:label "Marvel Comics" .
 * ```
 * 
 * @example Deeply nested nodes (multiple levels)
 * ```ts
 * const product = node('product', 'schema:Product', {
 *   'schema:name': v('title'),
 *   'schema:publisher': node('publisher', 'schema:Organization', {
 *     'schema:name': v('pubName'),
 *     'schema:location': node('location', 'schema:Place', {
 *       'schema:city': v('city'),
 *       'schema:country': v('country'),
 *       'schema:geo': node('geo', 'schema:GeoCoordinates', {
 *         'schema:latitude': v('lat'),
 *         'schema:longitude': v('lon')
 *       })
 *     })
 *   })
 * })
 * // Generates all triples for product → publisher → location → geo
 * ```
 * 
 * @example Nesting relationships within properties
 * ```ts
 * const person = node('person', 'foaf:Person', {
 *   'foaf:name': v('name'),
 *   'foaf:knows': node('friend', 'foaf:Person', {
 *     'foaf:name': v('friendName')
 *   })
 * })
 * // You can also use rel() for relationships with metadata:
 * const personWithRel = node('person', 'foaf:Person')
 *   .prop('foaf:name', v('name'))
 *   .prop('foaf:knows', 
 *     rel('person', 'foaf:knows', node('friend', 'foaf:Person'))
 *       .prop('ex:since', date(new Date('2020-01-01')))
 *   )
 * ```
 * 
 * @example Multiple nested nodes of the same type
 * ```ts
 * const book = node('book', 'schema:Book', {
 *   'schema:name': v('title'),
 *   'schema:author': [
 *     node('author1', 'schema:Person', { 'schema:name': str('Stan Lee') }),
 *     node('author2', 'schema:Person', { 'schema:name': str('Jack Kirby') })
 *   ]
 * })
 * // Generates triples for book with both authors
 * ```
 * 
 * @example Chain-style building with nested structures
 * ```ts
 * const query = select(['?productName', '?publisherName', '?city'])
 *   .where(
 *     node('product', 'schema:Product')
 *       .prop('schema:name', v('productName'))
 *       .prop('schema:publisher', 
 *         node('publisher', 'schema:Organization')
 *           .prop('schema:name', v('publisherName'))
 *           .prop('schema:location',
 *             node('location', 'schema:Place')
 *               .prop('schema:city', v('city'))
 *           )
 *       )
 *   )
 * ```
 */
export class Node implements SparqlValue {
  readonly [SPARQL_VALUE_BRAND] = true
  readonly subjectTerm: SparqlValue
  private readonly varName: string
  private readonly typesTerm: TriplePredicate[] = []
  private readonly properties: NodePropertyMap = {}

  // Fluent getters for natural chaining
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

  static create(name: string, type?: TriplePredicate | TriplePredicate[], options?: NodePropertyMap): Node {
    return new Node(name, type, options)
  }

  /**
   * Get the variable term for this node.
   * 
   * Use this when you need to reference the node as an object in another triple.
   * For example, when connecting two nodes with a relationship.
   */
  term(): SparqlValue {
    return this.subjectTerm
  }

  /**
   * Add an rdf:type to this node.
   * 
   * Types indicate what kind of resource this is. A node can have multiple types
   * (someone can be both a Person and an Author).
   * 
   * @example
   * ```ts
   * node('person').a('foaf:Person').a('schema:Author')
   * ```
   */
  a(typeIri: TriplePredicate): this {
    this.typesTerm.push(typeIri)
    return this
  }

  /** Alias for {@link a} with more explicit naming. */
  type(typeIri: TriplePredicate): this {
    this.a(typeIri)
    return this
  }

  /**
   * Add multiple types at once.
   * 
   * @example
   * ```ts
   * node('item').types(['schema:Product', 'schema:CreativeWork'])
   * ```
   */
  types(typesIri: TriplePredicate[]): this { 
    for (const typeIri of typesIri)
      this.a(typeIri);
    return this
  }

  /**
   * Add a property to this node.
   * 
   * Properties describe facts about the resource. The value can be a literal,
   * variable, IRI, or even another node for nested structures. Arrays let you
   * specify multiple values for one property.
   * 
   * If you call prop() multiple times with the same predicate, the values
   * accumulate - you'll get multiple triples with that predicate.
   * 
   * @example Single value
   * ```ts
   * node('person').prop('foaf:name', v('name'))
   * ```
   * 
   * @example Multiple values
   * ```ts
   * node('person').prop('foaf:nick', ['Spidey', 'Web-Head'])
   * ```
   * 
   * @example Nested node
   * ```ts
   * node('product').prop('schema:publisher', node('publisher', 'schema:Organization'))
   * ```
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
      if (Array.isArray(value)) {
        this.properties[key] = [existing, ...value]
      } else {
        this.properties[key] = [existing, value]
      }
    }
    return this
  }

  /**
   * Add multiple properties at once.
   * 
   * Convenient when you have several properties to set. Just pass an object
   * where keys are predicates and values are objects.
   * 
   * @example
   * ```ts
   * node('person').props({
   *   'foaf:name': v('name'),
   *   'foaf:age': v('age'),
   *   'foaf:email': v('email')
   * })
   * ```
   */
  props(map: Record<string, TripleObject | TripleObject[]>): this {
    for (const [key, value] of Object.entries(map)) {
      this.prop(key, value)
    }
    return this
  }

  /**
   * Build the SPARQL pattern for this node.
   * 
   * Recursively processes this node and any nested nodes, generating all the
   * necessary triples. The visited set prevents infinite recursion if there
   * are circular references.
   */
  private buildPatternInternal(visited: Set<Node>): string {
    if (visited.has(this)) {
      return ''
    }
    visited.add(this)

    const poNormalized: PredicateObjectMap = {}
    const nestedChunks: string[] = []

    // Add rdf:type triples
    if (this.typesTerm.length > 0) {
      const typeObjs: TripleObject[] = this.typesTerm.map((t) =>
        typeof t === 'string' ? raw(t) : t.value,
      )

      const existing =
        poNormalized['a'] ||
        poNormalized['rdf:type'] ||
        poNormalized['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] ||
        poNormalized['<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>'];

      if (existing === undefined) {
        poNormalized['a'] = typeObjs
      } else if (Array.isArray(existing)) {
        poNormalized['a'] = [...existing, ...typeObjs]
      } else {
        poNormalized['a'] = [existing, ...typeObjs]
      }
    }

    // Process properties, handling nested nodes
    const pushAtomic = (key: string, atomic: PropertyAtomic): void => {
      let object: TripleObject

      if (atomic instanceof Node) {
        // Use the nested node's variable as the object
        object = atomic.term()
        // Also generate the nested node's pattern
        const nested = atomic.buildPatternInternal(visited)
        if (nested.trim().length > 0) {
          nestedChunks.push(nested)
        }
      } else {
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

    // Build this node's triples
    const selfPattern = triples(this.subjectTerm, poNormalized).value

    // Combine with nested patterns
    const allChunks = [selfPattern, ...nestedChunks].filter(
      (chunk) => chunk.trim().length > 0,
    )

    return allChunks.join('\n')
  }

  /**
   * Get the full SPARQL pattern as a SparqlValue.
   * 
   * Call this to get the complete pattern including all nested nodes.
   */
  pattern(): SparqlValue {
    const visited = new Set<Node>()
    const text = this.buildPatternInternal(visited)
    return raw(text)
  }

  /**
   * Get the SPARQL pattern string.
   * 
   * This implements SparqlValue.value, which means you can pass Node objects
   * directly to query builder methods that expect SparqlValue.
   * 
   * ⚠️ Warning: This returns the full pattern, not just the variable. If you
   * want to use this node as an object in a triple, call term() instead.
   */
  get value(): string {
    return this.pattern().value
  }

  getVarName(): string {
    return this.varName
  }
}

// ============================================================================
// Relationship Patterns
// ============================================================================

/**
 * Properties on a relationship.
 * 
 * Like nodes, relationships can have properties too. This is called reification
 * in RDF - treating the edge itself as a resource with facts about it.
 */
export interface RelationshipPropertyMap {
  [predicate: string]: PropertyValue
}

/**
 * A relationship between two nodes.
 * 
 * Relationships describe how nodes connect. In the simplest case, a relationship is just an edge
 * between two nodes with a predicate. But you can also add properties to the relationship itself
 * (metadata about the connection) and nest relationships with full node structures. When you pass
 * Node objects as the from/to arguments, the library automatically generates all necessary triples
 * for those nodes plus the connecting edge.
 * 
 * When you add properties to a relationship, it uses RDF reification to represent the edge as a
 * resource. This lets you attach information like timestamps, confidence scores, or provenance data
 * to connections. You can also nest nodes within relationships to create patterns where both the
 * nodes and their connection have detailed structures.
 * 
 * @example Simple relationship
 * ```ts
 * rel('person', 'foaf:knows', 'friend')
 * // Generates: ?person foaf:knows ?friend .
 * ```
 * 
 * @example Relationship with metadata
 * ```ts
 * rel('person', 'foaf:knows', 'friend')
 *   .prop('rel:since', date(new Date('2020-01-01')))
 *   .prop('rel:confidence', num(0.95))
 * // Generates:
 * // ?person foaf:knows ?friend .
 * // _:edge_xyz a rdf:Statement ;
 * //   rdf:subject ?person ;
 * //   rdf:predicate foaf:knows ;
 * //   rdf:object ?friend ;
 * //   rel:since "2020-01-01"^^xsd:date ;
 * //   rel:confidence 0.95 .
 * ```
 * 
 * @example Relationship between nested nodes
 * ```ts
 * rel(
 *   node('person', 'foaf:Person', {
 *     'foaf:name': v('personName'),
 *     'foaf:age': v('personAge')
 *   }),
 *   'foaf:knows',
 *   node('friend', 'foaf:Person', {
 *     'foaf:name': v('friendName'),
 *     'foaf:age': v('friendAge')
 *   })
 * )
 * // Generates:
 * // ?person a foaf:Person .
 * // ?person foaf:name ?personName .
 * // ?person foaf:age ?personAge .
 * // ?friend a foaf:Person .
 * // ?friend foaf:name ?friendName .
 * // ?friend foaf:age ?friendAge .
 * // ?person foaf:knows ?friend .
 * ```
 * 
 * @example Relationship with nested nodes and metadata
 * ```ts
 * rel(
 *   node('employee', 'org:Employee', {
 *     'foaf:name': v('empName'),
 *     'org:department': v('dept')
 *   }),
 *   'org:reportsTo',
 *   node('manager', 'org:Manager', {
 *     'foaf:name': v('mgrName'),
 *     'org:level': num(5)
 *   })
 * )
 *   .prop('org:since', date(new Date('2023-01-01')))
 *   .prop('org:directReport', bool(true))
 * // Generates all node triples, the relationship triple, and reification with metadata
 * ```
 * 
 * @example Chain-style relationship building
 * ```ts
 * const pattern = select(['?person', '?friend', '?friendCity'])
 *   .where(
 *     rel(
 *       node('person', 'foaf:Person')
 *         .prop('foaf:name', v('personName')),
 *       'foaf:knows',
 *       node('friend', 'foaf:Person')
 *         .prop('foaf:name', v('friendName'))
 *         .prop('schema:city', v('friendCity'))
 *     )
 *       .prop('ex:closeness', v('score'))
 *       .prop('ex:since', v('friendshipDate'))
 *   )
 *   .filter(v('score').gte(0.8))
 * ```
 * 
 * @example Multiple relationships from one node
 * ```ts
 * const person = node('person', 'foaf:Person', {
 *   'foaf:name': v('name')
 * })
 * 
 * const friend1Rel = rel(person, 'foaf:knows', node('friend1', 'foaf:Person'))
 *   .prop('ex:closeness', num(0.9))
 * 
 * const friend2Rel = rel(person, 'foaf:knows', node('friend2', 'foaf:Person'))
 *   .prop('ex:closeness', num(0.7))
 * 
 * select(['?name', '?friend1', '?friend2'])
 *   .where(person)
 *   .where(friend1Rel)
 *   .where(friend2Rel)
 * ```
 */
export class Relationship implements SparqlValue {
  readonly [SPARQL_VALUE_BRAND] = true
  private readonly fromNode?: Node
  private readonly toNode?: Node
  private readonly fromTerm: TripleSubject
  private readonly toTerm: TripleSubject
  private readonly predicate: TriplePredicate
  private readonly properties: RelationshipPropertyMap = {}

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
   * Add a property to this relationship.
   * 
   * When you add properties, the relationship gets reified (represented as a
   * blank node with rdf:Statement type). This lets you attach metadata to
   * the connection itself.
   * 
   * @example Timestamp on relationship
   * ```ts
   * rel('person', 'knows', 'friend').prop('timestamp', dateTime(new Date()))
   * ```
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

  /**
   * Generate deterministic ID for reified edge.
   * 
   * Uses a simple hash of the subject-predicate-object to create a stable
   * blank node identifier. Same relationship always gets the same ID.
   */
  private getEdgeId(): string {
    const hash = simpleHash(`${tripleSubjectString(this.fromTerm)}|${triplePredicateString(this.predicate)}|${tripleSubjectString(this.toTerm)}`)
    return `_:edge_${hash}`
  }

  /**
   * Build the triples for this relationship.
   * 
   * If there are no properties, just generates the basic triple. If there are
   * properties, generates the triple plus a reification structure.
   */
  private buildTriples(): SparqlValue {
    const base = triple(this.fromTerm, this.predicate, this.toTerm)

    const keys = Object.keys(this.properties)
    if (keys.length === 0) {
      return base
    }

    // Reify with properties
    const edgeId = this.getEdgeId()
    const poMap: RelationshipPropertyMap = {
      // `a` = `rdf:type`
      'a': raw('rdf:Statement'),
      'rdf:subject': this.fromTerm,
      'rdf:predicate': typeof this.predicate === 'string' 
        ? raw(this.predicate) 
        : this.predicate,
      'rdf:object': this.toTerm,
      ...this.properties,
    }

    const edgeTriples = triples(edgeId, poMap)

    return raw(`${base.value}\n${edgeTriples.value}`)
  }

  get value(): string {
    return this.buildTriples().value
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a node pattern.
 * 
 * Convenience function for creating Node instances. Lets you quickly define
 * graph patterns without the `new` keyword.
 * 
 * @param name Variable name for this node (without ? prefix)
 * @param type Optional RDF type(s) for the node
 * @param options Optional property map
 * 
 * @example
 * ```ts
 * const person = node('person', 'foaf:Person')
 *   .prop('foaf:name', v('name'))
 *   .prop('foaf:age', v('age'))
 * ```
 */
export function node(name: string, type?: TriplePredicate | TriplePredicate[], options?: NodePropertyMap): Node {
  return Node.create(name, type, options)
}

/**
 * Create a relationship pattern.
 * 
 * Convenience function for creating Relationship instances. Describes how
 * two nodes connect.
 * 
 * @param fromVar Source node variable name
 * @param predicate Relationship type/predicate
 * @param toVar Target node variable name
 * 
 * @example
 * ```ts
 * const knows = rel('person', 'foaf:knows', 'friend')
 * ```
 */
export function rel(
  fromVar: string,
  predicate: TriplePredicate,
  toVar: string,
): Relationship {
  return Relationship.create(fromVar, predicate, toVar)
}

/**
 * Combine multiple patterns into one.
 * 
 * Takes several patterns (nodes, relationships, or raw SPARQL) and combines
 * them into a single pattern. Useful for building complex graph structures.
 * 
 * @example
 * ```ts
 * const pattern = match(
 *   node('person', 'foaf:Person').prop('name', v('name')),
 *   rel('person', 'foaf:knows', 'friend'),
 *   node('friend', 'foaf:Person')
 * )
 * ```
 */
export function match(
  ...patterns: Array<Node | Relationship | SparqlValue>
): SparqlValue {
  const built = patterns.map((p) => p.value)
  return raw(`${built.join('\n    ')}`)
}

/**
 * Simple string hash for generating IDs.
 * 
 * Uses a basic hash algorithm to create deterministic IDs from strings.
 * Not cryptographically secure, but fine for generating blank node identifiers.
 */
export function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}