/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface SupernaturalRelationship extends narrative_CharacterRelationship {
  '@id': IRI<'narrative:SupernaturalRelationship'>
  '@type': 'narrative:SupernaturalRelationship'
  

}

/**
 * Valid properties for SupernaturalRelationship class
 */
export type SupernaturalRelationshipProperty = 

/**
 * Type guard for SupernaturalRelationship properties
 */
export function isSupernaturalRelationshipProperty(property: string): property is SupernaturalRelationshipProperty {
  const validProperties: SupernaturalRelationshipProperty[] = [

  ]
  return validProperties.includes(property as SupernaturalRelationshipProperty)
}
