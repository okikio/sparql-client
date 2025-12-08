/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Colorist extends narrative_Artist {
  '@id': IRI<'narrative:Colorist'>
  '@type': 'narrative:Colorist'
  

}

/**
 * Valid properties for Colorist class
 */
export type ColoristProperty = 

/**
 * Type guard for Colorist properties
 */
export function isColoristProperty(property: string): property is ColoristProperty {
  const validProperties: ColoristProperty[] = [

  ]
  return validProperties.includes(property as ColoristProperty)
}
