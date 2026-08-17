/** Cycle-safe lookup and transitive hierarchy operations for ontology models. @module */

import type { ClassType, ModelType, PropertyType } from './model.ts'

/** Read-only indexes over one ontology model. */
export class OntologyIndex {
  readonly #classes: ReadonlyMap<string, ClassType>
  readonly #properties: ReadonlyMap<string, PropertyType>

  /** Builds immutable lookup maps over a parsed ontology model without performing entailment. */
  constructor(model: ModelType) {
    this.#classes = new Map(model.classes.map((value) => [value.iri, value]))
    this.#properties = new Map(model.properties.map((value) => [value.iri, value]))
  }

  /** Gets one named class declaration. */
  getClass(iri: string): ClassType | undefined {
    return this.#classes.get(iri)
  }

  /** Gets one named property declaration. */
  getProperty(iri: string): PropertyType | undefined {
    return this.#properties.get(iri)
  }

  /** Returns transitive superclasses without duplicating cycles. */
  superClasses(iri: string): readonly string[] {
    return closure(iri, (value) => this.#classes.get(value)?.superClasses ?? [])
  }

  /** Returns transitive superproperties without duplicating cycles. */
  superProperties(iri: string): readonly string[] {
    return closure(iri, (value) => this.#properties.get(value)?.superProperties ?? [])
  }

  /**
   * Returns properties whose declared domain contains a class or superclass.
   *
   * This is a vocabulary lookup operation, not a claim that the property is
   * required or that its range forms a closed validation rule.
   */
  propertiesForClass(iri: string): readonly PropertyType[] {
    const classes = new Set([iri, ...this.superClasses(iri)])
    return [...this.#properties.values()]
      .filter((property) => property.domains.some((domain) => classes.has(domain)))
      .sort((left, right) => left.iri.localeCompare(right.iri))
  }
}

/** Creates hierarchy indexes without changing the ontology model. */
export function index(model: ModelType): OntologyIndex {
  return new OntologyIndex(model)
}

/** Computes cycle-safe transitive closure over one named ontology relationship map. */
function closure(start: string, getParents: (value: string) => readonly string[]): string[] {
  const result = new Set<string>()
  const pending = [...getParents(start)]
  while (pending.length) {
    const value = pending.pop()!
    if (value === start || result.has(value)) continue
    result.add(value)
    pending.push(...getParents(value))
  }
  return [...result].sort()
}
