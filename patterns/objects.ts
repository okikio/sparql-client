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
  raw,
  triples,
  triple,
  type SparqlValue,
  type TripleSubject,
  type TriplePredicate,
  type TripleObject,
  variable,
  variableName,
} from '../sparql.ts'

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


// ---------------------------------------------------------------------------
// ResourcePattern: describes a single resource (node)
// ---------------------------------------------------------------------------

export interface ResourcePropertyMap {
  [predicate: string]: TripleObject | TripleObject[]
}

/**
 * A resource (node) pattern: subject + rdf:type(s) + properties.
 *
 * Implements SparqlValue so you can pass it to .where().
 * Its .value is a group of triples describing that subject.
 */
export class ResourcePattern implements SparqlValue {
  readonly __sparql = true
  readonly subject: TripleSubject
  private readonly types: TriplePredicate[] = []
  private readonly properties: ResourcePropertyMap = {}

  constructor(subject: TripleSubject) {
    this.subject = subject
  }

  /**
   * Create a resource with a variable subject (?var).
   */
  static variable(name: string): ResourcePattern {
    const v = variable(name)
    return new ResourcePattern(v.value)
  }

  /**
   * Add an rdf:type triple.
   *
   * @example
   * resource.a('narrative:Product')
   */
  a(typeIri: TriplePredicate): this {
    this.types.push(typeIri)
    return this
  }

  /**
   * Add a property triple.
   *
   * Values can be primitives or SparqlValue.
   *
   * @example
   * resource.prop('narrative:productTitle', 'Amazing Spider-Man #1')
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
      // existing is a single value
      this.properties[key] = Array.isArray(value) ? [existing, ...value] : [existing, value]
    }
    return this
  }

  /**
   * Build the triples describing this resource.
   */
  private buildTriples(): SparqlValue {
    const poMap: ResourcePropertyMap = { ...this.properties }

    // Add rdf:type triples as needed.
    if (this.types.length > 0) {
      const existing = poMap['rdf:type']
      const typesAsObjects = this.types.map((t): TripleObject =>
        typeof t === 'string' ? t : t.value,
      )
      if (existing === undefined) {
        poMap['rdf:type'] = typesAsObjects
      } else if (Array.isArray(existing)) {
        poMap['rdf:type'] = [...existing, ...typesAsObjects]
      } else {
        poMap['rdf:type'] = [existing, ...typesAsObjects]
      }
    }

    return triples(this.subject, poMap)
  }

  /**
   * SparqlValue implementation. This is the group of triples for the subject.
   */
  get value(): string {
    return this.buildTriples().value
  }
}

// ---------------------------------------------------------------------------
// RelationshipPattern: describes a relationship between two resources
// ---------------------------------------------------------------------------

export interface RelationshipPropertyMap {
  [predicate: string]: TripleObject | TripleObject[]
}

/**
 * A relationship pattern between two resources.
 *
 * By default it simply emits:
 *
 *   from predicate to .
 *
 * If properties are added, it emits:
 *
 *   from predicate to .
 *   _:edge rdf:type some:RelationshipType ;
 *          some:from from ;
 *          some:to to ;
 *          ...props...
 *
 * You can later refine this reification scheme to your OWL-ish style.
 */
export class RelationshipPattern implements SparqlValue {
  readonly __sparql = true
  readonly from: TripleSubject
  readonly to: TripleSubject
  readonly predicate: TriplePredicate
  private readonly properties: RelationshipPropertyMap = {}

  constructor(
    from: TripleSubject,
    predicate: TriplePredicate,
    to: TripleSubject,
  ) {
    this.from = from
    this.predicate = predicate
    this.to = to
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

  private buildTriples(): SparqlValue {
    const base = triple(this.from, this.predicate, this.to)

    // If no relationship properties, just return the base triple.
    const keys = Object.keys(this.properties)
    if (keys.length === 0) {
      return base
    }

    // Otherwise, reify with a blank node.
    const edgeId = `_edge_${Math.random().toString(36).slice(2)}`

    const poMap: RelationshipPropertyMap = {
      'rdf:type': 'narrative:Relationship',
      'narrative:from': this.from,
      'narrative:to': this.to,
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
 *   .a('narrative:Product')
 *   .prop('narrative:productTitle', variable('title'))
 */
export function node(name: string): ResourcePattern {
  return ResourcePattern.variable(name)
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
): RelationshipPattern {
  const fromTerm = variable(fromVar).value
  const toTerm = variable(toVar).value
  return new RelationshipPattern(fromTerm, predicate, toTerm)
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
  ...patterns: Array<ResourcePattern | RelationshipPattern | SparqlValue>
): SparqlValue {
  const built = patterns.map((p) => p.value)

  return sparql`${built.join('\n    ')}`
}

// ============================================================================
// Common Domain Patterns
// ============================================================================

/**
 * PopModern narrative types (convenience)
 */
export const Types = {
  Character: type('narrative:Character'),
  Series: type('narrative:Series'),
  Product: type('narrative:Product'),
  Person: type('narrative:Person'),
  Organization: type('narrative:Organization'),
  Universe: type('narrative:Universe'),
  StoryWork: type('narrative:StoryWork'),
}

/**
 * PopModern narrative relationships (convenience)
 */
export const Relationships = {
  createdBy: relationship('narrative:createdBy'),
  publishedBy: relationship('narrative:publishedBy'),
  featuresCharacter: relationship('narrative:featuresCharacter'),
  partOfSeries: relationship('narrative:partOfSeries'),
  partOfUniverse: relationship('narrative:partOfUniverse'),
  adaptationOf: relationship('narrative:adaptationOf'),

  // FOAF relationships
  knows: relationship('foaf:knows'),
  member: relationship('foaf:member'),
}

/**
 * Common predicates (convenience)
 */
export const Props = {
  name: 'rdfs:label',
  characterName: 'narrative:characterName',
  seriesName: 'narrative:seriesName',
  productTitle: 'narrative:productTitle',
  releaseDate: 'narrative:releaseDate',
  storeDate: 'narrative:storeDate',
  issueNumber: 'narrative:issueNumber',
}
