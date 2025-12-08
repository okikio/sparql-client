/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Universe {
  '@id': IRI<'narrative:Universe'>
  '@type': 'narrative:Universe'
  
  /**
   * Issue where universe first appeared
   */
  'narrative:introducedIn': IRI<'narrative:StoryExpression'>[] | undefined

  /**
   * Parallel or related universes
   */
  'narrative:relatedUniverse': IRI<'narrative:Universe'>[] | undefined

  /**
   * Larger multiverse this is part of
   */
  'narrative:partOfMultiverse': IRI<'narrative:Universe'>[] | undefined

  /**
   * Active, Defunct, Acquired, Merged, etc.
   */
  'narrative:status': string[] | undefined

  /**
   * Name of fictional universe
   */
  'narrative:universeName': string[] | undefined

  /**
   * Official designation (Earth-616, Prime Earth, etc.)
   */
  'narrative:designation': string[] | undefined

  /**
   * Main Continuity, Alternate, Elseworlds, What If, etc.
   */
  'narrative:universeType': string[] | undefined

  /**
   * Whether considered main canon
   */
  'narrative:canon': boolean[] | undefined

  /**
   * Description of universe characteristics
   */
  'narrative:universeDescription': string[] | undefined

  /**
   * How this universe differs from main continuity
   */
  'narrative:keyDifferences': string[] | undefined
}

/**
 * Valid properties for Universe class
 */
export type UniverseProperty = 'narrative:introducedIn' | 'narrative:relatedUniverse' | 'narrative:partOfMultiverse' | 'narrative:status' | 'narrative:universeName' | 'narrative:designation' | 'narrative:universeType' | 'narrative:canon' | 'narrative:universeDescription' | 'narrative:keyDifferences'

/**
 * Type guard for Universe properties
 */
export function isUniverseProperty(property: string): property is UniverseProperty {
  const validProperties: UniverseProperty[] = [
    'narrative:introducedIn',
    'narrative:relatedUniverse',
    'narrative:partOfMultiverse',
    'narrative:status',
    'narrative:universeName',
    'narrative:designation',
    'narrative:universeType',
    'narrative:canon',
    'narrative:universeDescription',
    'narrative:keyDifferences'
  ]
  return validProperties.includes(property as UniverseProperty)
}
