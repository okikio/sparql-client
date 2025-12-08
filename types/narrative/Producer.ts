/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Producer extends narrative_Role {
  '@id': IRI<'narrative:Producer'>
  '@type': 'narrative:Producer'
  

}

/**
 * Valid properties for Producer class
 */
export type ProducerProperty = 

/**
 * Type guard for Producer properties
 */
export function isProducerProperty(property: string): property is ProducerProperty {
  const validProperties: ProducerProperty[] = [

  ]
  return validProperties.includes(property as ProducerProperty)
}
