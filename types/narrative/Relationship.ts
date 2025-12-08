/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Relationship {
  '@id': IRI<'narrative:Relationship'>
  '@type': 'narrative:Relationship'
  

}

/**
 * Valid properties for Relationship class
 */
export type RelationshipProperty = 

/**
 * Type guard for Relationship properties
 */
export function isRelationshipProperty(property: string): property is RelationshipProperty {
  const validProperties: RelationshipProperty[] = [

  ]
  return validProperties.includes(property as RelationshipProperty)
}
