/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Performer extends narrative_Role {
  '@id': IRI<'narrative:Performer'>
  '@type': 'narrative:Performer'
  

}

/**
 * Valid properties for Performer class
 */
export type PerformerProperty = 

/**
 * Type guard for Performer properties
 */
export function isPerformerProperty(property: string): property is PerformerProperty {
  const validProperties: PerformerProperty[] = [

  ]
  return validProperties.includes(property as PerformerProperty)
}
