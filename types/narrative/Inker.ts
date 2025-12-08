/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Inker extends narrative_Artist {
  '@id': IRI<'narrative:Inker'>
  '@type': 'narrative:Inker'
  

}

/**
 * Valid properties for Inker class
 */
export type InkerProperty = 

/**
 * Type guard for Inker properties
 */
export function isInkerProperty(property: string): property is InkerProperty {
  const validProperties: InkerProperty[] = [

  ]
  return validProperties.includes(property as InkerProperty)
}
