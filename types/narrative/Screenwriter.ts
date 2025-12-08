/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Screenwriter extends narrative_Writer {
  '@id': IRI<'narrative:Screenwriter'>
  '@type': 'narrative:Screenwriter'
  

}

/**
 * Valid properties for Screenwriter class
 */
export type ScreenwriterProperty = 

/**
 * Type guard for Screenwriter properties
 */
export function isScreenwriterProperty(property: string): property is ScreenwriterProperty {
  const validProperties: ScreenwriterProperty[] = [

  ]
  return validProperties.includes(property as ScreenwriterProperty)
}
