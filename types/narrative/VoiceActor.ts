/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface VoiceActor extends narrative_Performer {
  '@id': IRI<'narrative:VoiceActor'>
  '@type': 'narrative:VoiceActor'
  

}

/**
 * Valid properties for VoiceActor class
 */
export type VoiceActorProperty = 

/**
 * Type guard for VoiceActor properties
 */
export function isVoiceActorProperty(property: string): property is VoiceActorProperty {
  const validProperties: VoiceActorProperty[] = [

  ]
  return validProperties.includes(property as VoiceActorProperty)
}
