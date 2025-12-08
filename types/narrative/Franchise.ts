/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Franchise {
  '@id': IRI<'narrative:Franchise'>
  '@type': 'narrative:Franchise'
  
  /**
   * Larger franchise this is part of (e.g., Batman → DC Comics)
   */
  'narrative:parentFranchise': IRI<'narrative:Franchise'>[] | undefined

  /**
   * Company that owns franchise rights
   */
  'narrative:owner': IRI<'narrative:Org'> | IRI<'n3-0'>[] | undefined

  /**
   * Companies with licensing rights
   */
  'narrative:licensedTo': IRI<'narrative:Org'>[] | undefined

  /**
   * Related or spin-off franchises
   */
  'narrative:relatedFranchise': IRI<'narrative:Franchise'>[] | undefined

  /**
   * Main universe for franchise
   */
  'narrative:primaryUniverse': IRI<'narrative:Universe'>[] | undefined

  /**
   * Name of franchise
   */
  'narrative:franchiseName': string[] | undefined

  /**
   * Comics, Film, TV, Gaming, Multimedia, etc.
   */
  'narrative:franchiseType': string[] | undefined

  /**
   * Year franchise began
   */
  'narrative:launched': number[] | undefined

  /**
   * Active, Dormant, Concluded, Rebooted, etc.
   */
  'narrative:franchiseStatus': string[] | undefined

  /**
   * Description of franchise
   */
  'narrative:franchiseDescription': string[] | undefined
}

/**
 * Valid properties for Franchise class
 */
export type FranchiseProperty = 'narrative:parentFranchise' | 'narrative:owner' | 'narrative:licensedTo' | 'narrative:relatedFranchise' | 'narrative:primaryUniverse' | 'narrative:franchiseName' | 'narrative:franchiseType' | 'narrative:launched' | 'narrative:franchiseStatus' | 'narrative:franchiseDescription'

/**
 * Type guard for Franchise properties
 */
export function isFranchiseProperty(property: string): property is FranchiseProperty {
  const validProperties: FranchiseProperty[] = [
    'narrative:parentFranchise',
    'narrative:owner',
    'narrative:licensedTo',
    'narrative:relatedFranchise',
    'narrative:primaryUniverse',
    'narrative:franchiseName',
    'narrative:franchiseType',
    'narrative:launched',
    'narrative:franchiseStatus',
    'narrative:franchiseDescription'
  ]
  return validProperties.includes(property as FranchiseProperty)
}
