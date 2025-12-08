/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface AlternateSelf extends narrative_SupernaturalRelationship {
  '@id': IRI<'narrative:AlternateSelf'>
  '@type': 'narrative:AlternateSelf'
  

}

/**
 * Valid properties for AlternateSelf class
 */
export type AlternateSelfProperty = 

/**
 * Type guard for AlternateSelf properties
 */
export function isAlternateSelfProperty(property: string): property is AlternateSelfProperty {
  const validProperties: AlternateSelfProperty[] = [

  ]
  return validProperties.includes(property as AlternateSelfProperty)
}
