/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface AllianceRelationship extends narrative_CharacterRelationship {
  '@id': IRI<'narrative:AllianceRelationship'>
  '@type': 'narrative:AllianceRelationship'
  

}

/**
 * Valid properties for AllianceRelationship class
 */
export type AllianceRelationshipProperty = 

/**
 * Type guard for AllianceRelationship properties
 */
export function isAllianceRelationshipProperty(property: string): property is AllianceRelationshipProperty {
  const validProperties: AllianceRelationshipProperty[] = [

  ]
  return validProperties.includes(property as AllianceRelationshipProperty)
}
