/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface FriendshipRelationship extends narrative_CharacterRelationship {
  '@id': IRI<'narrative:FriendshipRelationship'>
  '@type': 'narrative:FriendshipRelationship'
  

}

/**
 * Valid properties for FriendshipRelationship class
 */
export type FriendshipRelationshipProperty = 

/**
 * Type guard for FriendshipRelationship properties
 */
export function isFriendshipRelationshipProperty(property: string): property is FriendshipRelationshipProperty {
  const validProperties: FriendshipRelationshipProperty[] = [

  ]
  return validProperties.includes(property as FriendshipRelationshipProperty)
}
