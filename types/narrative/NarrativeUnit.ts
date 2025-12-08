/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface NarrativeUnit {
  '@id': IRI<'narrative:NarrativeUnit'>
  '@type': 'narrative:NarrativeUnit'
  
  'narrative:narrativeUnitOf': IRI<'narrative:StoryExpression'>[] | undefined

  'narrative:hasProduct': IRI<'narrative:Product'>[] | undefined

  /**
   * Issues that comprise this arc
   */
  'narrative:spans': IRI<'narrative:StoryExpression'>[] | undefined

  /**
   * Main characters in this arc
   */
  'narrative:featuredCharacters': IRI<'narrative:Character'>[] | undefined

  /**
   * Larger event this arc is part of
   */
  'narrative:partOfEvent': IRI<'narrative:NarrativeUnit'>[] | undefined

  /**
   * Next arc in sequence
   */
  'narrative:followedBy': IRI<'narrative:NarrativeUnit'>[] | undefined

  /**
   * Name of story arc
   */
  'narrative:arcName': string[] | undefined

  /**
   * Arc, Saga, Event, Crossover, etc.
   */
  'narrative:arcType': string[] | undefined

  /**
   * Part number within larger story
   */
  'narrative:partNumber': number[] | undefined

  /**
   * Total parts in complete arc
   */
  'narrative:totalParts': number[] | undefined

  /**
   * Summary of story arc
   */
  'narrative:arcSummary': string[] | undefined
}

/**
 * Valid properties for NarrativeUnit class
 */
export type NarrativeUnitProperty = 'narrative:narrativeUnitOf' | 'narrative:hasProduct' | 'narrative:spans' | 'narrative:featuredCharacters' | 'narrative:partOfEvent' | 'narrative:followedBy' | 'narrative:arcName' | 'narrative:arcType' | 'narrative:partNumber' | 'narrative:totalParts' | 'narrative:arcSummary'

/**
 * Type guard for NarrativeUnit properties
 */
export function isNarrativeUnitProperty(property: string): property is NarrativeUnitProperty {
  const validProperties: NarrativeUnitProperty[] = [
    'narrative:narrativeUnitOf',
    'narrative:hasProduct',
    'narrative:spans',
    'narrative:featuredCharacters',
    'narrative:partOfEvent',
    'narrative:followedBy',
    'narrative:arcName',
    'narrative:arcType',
    'narrative:partNumber',
    'narrative:totalParts',
    'narrative:arcSummary'
  ]
  return validProperties.includes(property as NarrativeUnitProperty)
}
