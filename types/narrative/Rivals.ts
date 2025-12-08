/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Rivals extends narrative_RivalryRelationship {
  '@id': IRI<'narrative:Rivals'>
  '@type': 'narrative:Rivals'
  

}

/**
 * Valid properties for Rivals class
 */
export type RivalsProperty = 

/**
 * Type guard for Rivals properties
 */
export function isRivalsProperty(property: string): property is RivalsProperty {
  const validProperties: RivalsProperty[] = [

  ]
  return validProperties.includes(property as RivalsProperty)
}
