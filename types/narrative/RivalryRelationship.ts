/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface RivalryRelationship extends narrative_CharacterRelationship {
  '@id': IRI<'narrative:RivalryRelationship'>
  '@type': 'narrative:RivalryRelationship'
  
  /**
   * Friendly Competition, Arch-enemies, Mortal Enemies, etc.
   */
  'narrative:rivalryIntensity': string[] | undefined

  /**
   * What caused the rivalry
   */
  'narrative:causedBy': string[] | undefined
}

/**
 * Valid properties for RivalryRelationship class
 */
export type RivalryRelationshipProperty = 'narrative:rivalryIntensity' | 'narrative:causedBy'

/**
 * Type guard for RivalryRelationship properties
 */
export function isRivalryRelationshipProperty(property: string): property is RivalryRelationshipProperty {
  const validProperties: RivalryRelationshipProperty[] = [
    'narrative:rivalryIntensity',
    'narrative:causedBy'
  ]
  return validProperties.includes(property as RivalryRelationshipProperty)
}
