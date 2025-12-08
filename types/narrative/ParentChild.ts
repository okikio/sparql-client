/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface ParentChild extends narrative_FamilyRelationship {
  '@id': IRI<'narrative:ParentChild'>
  '@type': 'narrative:ParentChild'
  

}

/**
 * Valid properties for ParentChild class
 */
export type ParentChildProperty = 

/**
 * Type guard for ParentChild properties
 */
export function isParentChildProperty(property: string): property is ParentChildProperty {
  const validProperties: ParentChildProperty[] = [

  ]
  return validProperties.includes(property as ParentChildProperty)
}
