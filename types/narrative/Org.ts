/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Org {
  '@id': IRI<'narrative:Org'>
  '@type': 'narrative:Org'
  
  'narrative:employs': IRI<'narrative:Person'>[] | undefined

  'narrative:hasMember': IRI<'narrative:Person'>[] | undefined

  /**
   * Parent organization
   */
  'narrative:parentCompany': IRI<'narrative:Org'>[] | undefined

  /**
   * Subsidiary organizations
   */
  'narrative:subsidiary': IRI<'narrative:Org'>[] | undefined

  /**
   * Legal registered name of organization
   */
  'narrative:legalName': string[] | undefined

  /**
   * Abbreviated name (e.g., 'DC' for 'DC Comics')
   */
  'narrative:shortName': string[] | undefined

  /**
   * Publisher, Imprint, Studio, Convention, etc.
   */
  'narrative:orgType': string[] | undefined

  /**
   * Date organization was founded
   */
  'narrative:founded': Date[] | undefined

  /**
   * Date organization ceased operations
   */
  'narrative:dissolved': Date[] | undefined

  /**
   * Active, Defunct, Acquired, Merged, etc.
   */
  'narrative:status': string[] | undefined

  /**
   * Location of headquarters
   */
  'narrative:headquarters': string[] | undefined

  /**
   * Country of operation
   */
  'narrative:country': string[] | undefined

  /**
   * Comics, Animation, Film, Gaming, etc.
   */
  'narrative:industry': string[] | undefined

  /**
   * Annual revenue
   */
  'narrative:revenue': number[] | undefined

  /**
   * Number of employees
   */
  'narrative:employeeCount': number[] | undefined
}

/**
 * Valid properties for Org class
 */
export type OrgProperty = 'narrative:employs' | 'narrative:hasMember' | 'narrative:parentCompany' | 'narrative:subsidiary' | 'narrative:legalName' | 'narrative:shortName' | 'narrative:orgType' | 'narrative:founded' | 'narrative:dissolved' | 'narrative:status' | 'narrative:headquarters' | 'narrative:country' | 'narrative:industry' | 'narrative:revenue' | 'narrative:employeeCount'

/**
 * Type guard for Org properties
 */
export function isOrgProperty(property: string): property is OrgProperty {
  const validProperties: OrgProperty[] = [
    'narrative:employs',
    'narrative:hasMember',
    'narrative:parentCompany',
    'narrative:subsidiary',
    'narrative:legalName',
    'narrative:shortName',
    'narrative:orgType',
    'narrative:founded',
    'narrative:dissolved',
    'narrative:status',
    'narrative:headquarters',
    'narrative:country',
    'narrative:industry',
    'narrative:revenue',
    'narrative:employeeCount'
  ]
  return validProperties.includes(property as OrgProperty)
}
