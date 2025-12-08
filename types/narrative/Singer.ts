/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Singer extends narrative_Performer {
  '@id': IRI<'narrative:Singer'>
  '@type': 'narrative:Singer'
  

}

/**
 * Valid properties for Singer class
 */
export type SingerProperty = 

/**
 * Type guard for Singer properties
 */
export function isSingerProperty(property: string): property is SingerProperty {
  const validProperties: SingerProperty[] = [

  ]
  return validProperties.includes(property as SingerProperty)
}
