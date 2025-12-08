/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Actor extends narrative_Performer {
  '@id': IRI<'narrative:Actor'>
  '@type': 'narrative:Actor'
  

}

/**
 * Valid properties for Actor class
 */
export type ActorProperty = 

/**
 * Type guard for Actor properties
 */
export function isActorProperty(property: string): property is ActorProperty {
  const validProperties: ActorProperty[] = [

  ]
  return validProperties.includes(property as ActorProperty)
}
