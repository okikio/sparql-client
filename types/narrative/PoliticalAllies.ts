/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface PoliticalAllies extends narrative_AllianceRelationship {
  '@id': IRI<'narrative:PoliticalAllies'>
  '@type': 'narrative:PoliticalAllies'
  

}

/**
 * Valid properties for PoliticalAllies class
 */
export type PoliticalAlliesProperty = 

/**
 * Type guard for PoliticalAllies properties
 */
export function isPoliticalAlliesProperty(property: string): property is PoliticalAlliesProperty {
  const validProperties: PoliticalAlliesProperty[] = [

  ]
  return validProperties.includes(property as PoliticalAlliesProperty)
}
