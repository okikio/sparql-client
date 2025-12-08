/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Director extends narrative_Role {
  '@id': IRI<'narrative:Director'>
  '@type': 'narrative:Director'
  

}

/**
 * Valid properties for Director class
 */
export type DirectorProperty = 

/**
 * Type guard for Director properties
 */
export function isDirectorProperty(property: string): property is DirectorProperty {
  const validProperties: DirectorProperty[] = [

  ]
  return validProperties.includes(property as DirectorProperty)
}
