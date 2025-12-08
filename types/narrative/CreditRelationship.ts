/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface CreditRelationship extends narrative_Relationship {
  '@id': IRI<'narrative:CreditRelationship'>
  '@type': 'narrative:CreditRelationship'
  
  'narrative:creditsExpression': IRI<'narrative:StoryExpression'>[] | undefined

  'narrative:creditRole': IRI<'narrative:Role'>[] | undefined

  'narrative:creditedName': string[] | undefined

  'narrative:creditType': string[] | undefined

  'narrative:billingOrder': number[] | undefined

  /**
   * Work-for-hire, Creator-owned, etc.
   */
  'narrative:contractType': string[] | undefined

  /**
   * Whether contribution was uncredited
   */
  'narrative:uncredited': boolean[] | undefined
}

/**
 * Valid properties for CreditRelationship class
 */
export type CreditRelationshipProperty = 'narrative:creditsExpression' | 'narrative:creditRole' | 'narrative:creditedName' | 'narrative:creditType' | 'narrative:billingOrder' | 'narrative:contractType' | 'narrative:uncredited'

/**
 * Type guard for CreditRelationship properties
 */
export function isCreditRelationshipProperty(property: string): property is CreditRelationshipProperty {
  const validProperties: CreditRelationshipProperty[] = [
    'narrative:creditsExpression',
    'narrative:creditRole',
    'narrative:creditedName',
    'narrative:creditType',
    'narrative:billingOrder',
    'narrative:contractType',
    'narrative:uncredited'
  ]
  return validProperties.includes(property as CreditRelationshipProperty)
}
