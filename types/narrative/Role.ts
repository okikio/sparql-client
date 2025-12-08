/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Role {
  '@id': IRI<'narrative:Role'>
  '@type': 'narrative:Role'
  

}

/**
 * Valid properties for Role class
 */
export type RoleProperty = 

/**
 * Type guard for Role properties
 */
export function isRoleProperty(property: string): property is RoleProperty {
  const validProperties: RoleProperty[] = [

  ]
  return validProperties.includes(property as RoleProperty)
}
