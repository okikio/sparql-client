/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Letterer extends narrative_Artist {
  '@id': IRI<'narrative:Letterer'>
  '@type': 'narrative:Letterer'
  

}

/**
 * Valid properties for Letterer class
 */
export type LettererProperty = 

/**
 * Type guard for Letterer properties
 */
export function isLettererProperty(property: string): property is LettererProperty {
  const validProperties: LettererProperty[] = [

  ]
  return validProperties.includes(property as LettererProperty)
}
