/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface CharacterRelationship extends narrative_Relationship {
  '@id': IRI<'narrative:CharacterRelationship'>
  '@type': 'narrative:CharacterRelationship'
  
  'narrative:involvesCharacter': IRI<'narrative:Character'>[] | undefined

  'narrative:relationshipNotes': string[] | undefined

  'narrative:relationshipType': string[] | undefined

  'narrative:relationshipStatus': string[] | undefined

  'narrative:relationshipStart': Date[] | undefined

  'narrative:relationshipEnd': Date[] | undefined
}

/**
 * Valid properties for CharacterRelationship class
 */
export type CharacterRelationshipProperty = 'narrative:involvesCharacter' | 'narrative:relationshipNotes' | 'narrative:relationshipType' | 'narrative:relationshipStatus' | 'narrative:relationshipStart' | 'narrative:relationshipEnd'

/**
 * Type guard for CharacterRelationship properties
 */
export function isCharacterRelationshipProperty(property: string): property is CharacterRelationshipProperty {
  const validProperties: CharacterRelationshipProperty[] = [
    'narrative:involvesCharacter',
    'narrative:relationshipNotes',
    'narrative:relationshipType',
    'narrative:relationshipStatus',
    'narrative:relationshipStart',
    'narrative:relationshipEnd'
  ]
  return validProperties.includes(property as CharacterRelationshipProperty)
}
