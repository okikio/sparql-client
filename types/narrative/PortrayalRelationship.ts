/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface PortrayalRelationship extends narrative_Relationship {
  '@id': IRI<'narrative:PortrayalRelationship'>
  '@type': 'narrative:PortrayalRelationship'
  
  'narrative:portraysCharacter': IRI<'narrative:Character'>[] | undefined

  'narrative:portrayalMedium': string[] | undefined

  'narrative:portrayalStart': Date[] | undefined

  'narrative:portrayalEnd': Date[] | undefined

  'narrative:billing': string[] | undefined

  /**
   * Lead, Supporting, Cameo, Voice-only, etc.
   */
  'narrative:castingType': string[] | undefined

  /**
   * Awards won or nominated for this role
   */
  'narrative:awardNominations': string[] | undefined
}

/**
 * Valid properties for PortrayalRelationship class
 */
export type PortrayalRelationshipProperty = 'narrative:portraysCharacter' | 'narrative:portrayalMedium' | 'narrative:portrayalStart' | 'narrative:portrayalEnd' | 'narrative:billing' | 'narrative:castingType' | 'narrative:awardNominations'

/**
 * Type guard for PortrayalRelationship properties
 */
export function isPortrayalRelationshipProperty(property: string): property is PortrayalRelationshipProperty {
  const validProperties: PortrayalRelationshipProperty[] = [
    'narrative:portraysCharacter',
    'narrative:portrayalMedium',
    'narrative:portrayalStart',
    'narrative:portrayalEnd',
    'narrative:billing',
    'narrative:castingType',
    'narrative:awardNominations'
  ]
  return validProperties.includes(property as PortrayalRelationshipProperty)
}
