/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Person {
  '@id': IRI<'narrative:Person'>
  '@type': 'narrative:Person'
  
  'narrative:worksFor': IRI<'narrative:Org'>[] | undefined

  'narrative:memberOf': IRI<'narrative:Org'>[] | undefined

  /**
   * Primary creative role (writer, artist, etc.)
   */
  'narrative:primaryRole': IRI<'narrative:Role'>[] | undefined

  'narrative:hasWorkedWithRelationship': IRI<'narrative:WorkedWithRelationship'>[] | undefined

  'narrative:hasCreditRelationship': IRI<'narrative:CreditRelationship'>[] | undefined

  'narrative:hasPortrayalRelationship': IRI<'narrative:PortrayalRelationship'>[] | undefined

  /**
   * Full legal birth name
   */
  'narrative:birthName': string[] | undefined

  /**
   * Common name or professional name
   */
  'narrative:knownAs': string[] | undefined

  /**
   * Pen names, pseudonyms, stage names (repeatable)
   */
  'narrative:alias': string[] | undefined

  /**
   * Date of birth
   */
  'narrative:birthDate': Date[] | undefined

  /**
   * Date of death (if deceased)
   */
  'narrative:deathDate': Date[] | undefined

  /**
   * City, state/province, country of birth
   */
  'narrative:birthPlace': string[] | undefined

  /**
   * Country of citizenship
   */
  'narrative:nationality': string[] | undefined

  /**
   * Gender identity
   */
  'narrative:gender': string[] | undefined

  /**
   * Official website URL
   */
  'narrative:website': string[] | undefined

  /**
   * Social media profiles (Twitter, Instagram, etc.)
   */
  'narrative:socialMedia': string[] | undefined

  /**
   * Contact email
   */
  'narrative:email': string[] | undefined

  /**
   * Years active in industry (e.g., '1985-present')
   */
  'narrative:activeYears': string[] | undefined

  /**
   * Year started in industry
   */
  'narrative:activeFrom': number[] | undefined

  /**
   * Year ended/retired (if applicable)
   */
  'narrative:activeTo': number[] | undefined

  /**
   * Biographical summary
   */
  'narrative:biography': string[] | undefined

  /**
   * Awards and honors received
   */
  'narrative:awards': string[] | undefined
}

/**
 * Valid properties for Person class
 */
export type PersonProperty = 'narrative:worksFor' | 'narrative:memberOf' | 'narrative:primaryRole' | 'narrative:hasWorkedWithRelationship' | 'narrative:hasCreditRelationship' | 'narrative:hasPortrayalRelationship' | 'narrative:birthName' | 'narrative:knownAs' | 'narrative:alias' | 'narrative:birthDate' | 'narrative:deathDate' | 'narrative:birthPlace' | 'narrative:nationality' | 'narrative:gender' | 'narrative:website' | 'narrative:socialMedia' | 'narrative:email' | 'narrative:activeYears' | 'narrative:activeFrom' | 'narrative:activeTo' | 'narrative:biography' | 'narrative:awards'

/**
 * Type guard for Person properties
 */
export function isPersonProperty(property: string): property is PersonProperty {
  const validProperties: PersonProperty[] = [
    'narrative:worksFor',
    'narrative:memberOf',
    'narrative:primaryRole',
    'narrative:hasWorkedWithRelationship',
    'narrative:hasCreditRelationship',
    'narrative:hasPortrayalRelationship',
    'narrative:birthName',
    'narrative:knownAs',
    'narrative:alias',
    'narrative:birthDate',
    'narrative:deathDate',
    'narrative:birthPlace',
    'narrative:nationality',
    'narrative:gender',
    'narrative:website',
    'narrative:socialMedia',
    'narrative:email',
    'narrative:activeYears',
    'narrative:activeFrom',
    'narrative:activeTo',
    'narrative:biography',
    'narrative:awards'
  ]
  return validProperties.includes(property as PersonProperty)
}
