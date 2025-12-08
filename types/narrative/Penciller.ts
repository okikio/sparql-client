/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Penciller extends narrative_Artist {
  '@id': IRI<'narrative:Penciller'>
  '@type': 'narrative:Penciller'
  

}

/**
 * Valid properties for Penciller class
 */
export type PencillerProperty = 

/**
 * Type guard for Penciller properties
 */
export function isPencillerProperty(property: string): property is PencillerProperty {
  const validProperties: PencillerProperty[] = [

  ]
  return validProperties.includes(property as PencillerProperty)
}
