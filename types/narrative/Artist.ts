/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Artist extends narrative_Role {
  '@id': IRI<'narrative:Artist'>
  '@type': 'narrative:Artist'
  
  /**
   * Art style or technique
   */
  'narrative:artStyle': string[] | undefined

  /**
   * Traditional, Digital, Mixed Media, etc.
   */
  'narrative:primaryMedium': string[] | undefined

  /**
   * Artistic influences
   */
  'narrative:influences': string[] | undefined
}

/**
 * Valid properties for Artist class
 */
export type ArtistProperty = 'narrative:artStyle' | 'narrative:primaryMedium' | 'narrative:influences'

/**
 * Type guard for Artist properties
 */
export function isArtistProperty(property: string): property is ArtistProperty {
  const validProperties: ArtistProperty[] = [
    'narrative:artStyle',
    'narrative:primaryMedium',
    'narrative:influences'
  ]
  return validProperties.includes(property as ArtistProperty)
}
