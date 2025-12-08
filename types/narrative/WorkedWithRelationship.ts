/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface WorkedWithRelationship extends narrative_Relationship {
  '@id': IRI<'narrative:WorkedWithRelationship'>
  '@type': 'narrative:WorkedWithRelationship'
  
  'narrative:involvesPerson': IRI<'narrative:Person'>[] | undefined

  'narrative:projectCount': number[] | undefined

  'narrative:collabStart': Date[] | undefined

  'narrative:collabEnd': Date[] | undefined

  'narrative:relationshipNotes': string[] | undefined
}

/**
 * Valid properties for WorkedWithRelationship class
 */
export type WorkedWithRelationshipProperty = 'narrative:involvesPerson' | 'narrative:projectCount' | 'narrative:collabStart' | 'narrative:collabEnd' | 'narrative:relationshipNotes'

/**
 * Type guard for WorkedWithRelationship properties
 */
export function isWorkedWithRelationshipProperty(property: string): property is WorkedWithRelationshipProperty {
  const validProperties: WorkedWithRelationshipProperty[] = [
    'narrative:involvesPerson',
    'narrative:projectCount',
    'narrative:collabStart',
    'narrative:collabEnd',
    'narrative:relationshipNotes'
  ]
  return validProperties.includes(property as WorkedWithRelationshipProperty)
}
