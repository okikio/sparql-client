/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface FamilyRelationship extends narrative_CharacterRelationship {
  '@id': IRI<'narrative:FamilyRelationship'>
  '@type': 'narrative:FamilyRelationship'
  
  /**
   * Whether biological or adoptive/found family
   */
  'narrative:biologicalRelation': boolean[] | undefined

  /**
   * Parent, Child, Sibling, Spouse, etc.
   */
  'narrative:familyRole': string[] | undefined
}

/**
 * Valid properties for FamilyRelationship class
 */
export type FamilyRelationshipProperty = 'narrative:biologicalRelation' | 'narrative:familyRole'

/**
 * Type guard for FamilyRelationship properties
 */
export function isFamilyRelationshipProperty(property: string): property is FamilyRelationshipProperty {
  const validProperties: FamilyRelationshipProperty[] = [
    'narrative:biologicalRelation',
    'narrative:familyRole'
  ]
  return validProperties.includes(property as FamilyRelationshipProperty)
}
