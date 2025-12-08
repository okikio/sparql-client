/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Dancer extends narrative_Performer {
  '@id': IRI<'narrative:Dancer'>
  '@type': 'narrative:Dancer'
  

}

/**
 * Valid properties for Dancer class
 */
export type DancerProperty = 

/**
 * Type guard for Dancer properties
 */
export function isDancerProperty(property: string): property is DancerProperty {
  const validProperties: DancerProperty[] = [

  ]
  return validProperties.includes(property as DancerProperty)
}
