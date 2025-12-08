/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Writer extends narrative_Role {
  '@id': IRI<'narrative:Writer'>
  '@type': 'narrative:Writer'
  
  /**
   * Writing style or specialty
   */
  'narrative:writingStyle': string[] | undefined

  /**
   * Famous stories written
   */
  'narrative:notableStories': string[] | undefined
}

/**
 * Valid properties for Writer class
 */
export type WriterProperty = 'narrative:writingStyle' | 'narrative:notableStories'

/**
 * Type guard for Writer properties
 */
export function isWriterProperty(property: string): property is WriterProperty {
  const validProperties: WriterProperty[] = [
    'narrative:writingStyle',
    'narrative:notableStories'
  ]
  return validProperties.includes(property as WriterProperty)
}
