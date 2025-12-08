/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface StoryWork {
  '@id': IRI<'narrative:StoryWork'>
  '@type': 'narrative:StoryWork'
  
  'narrative:hasExpression': IRI<'narrative:StoryExpression'>[] | undefined

  /**
   * Publisher of the series
   */
  'narrative:publishedBy': IRI<'narrative:Org'>[] | undefined

  /**
   * Imprint line (Vertigo, MAX, Black Label, etc.)
   */
  'narrative:imprint': IRI<'narrative:Org'>[] | undefined

  /**
   * Name of the series
   */
  'narrative:seriesName': string[] | undefined

  /**
   * Name for alphabetical sorting (without 'The', etc.)
   */
  'narrative:sortName': string[] | undefined

  /**
   * Volume number (for series with multiple volumes)
   */
  'narrative:volume': number[] | undefined

  /**
   * Year series started
   */
  'narrative:yearBegan': number[] | undefined

  /**
   * Year series ended (if concluded)
   */
  'narrative:yearEnded': number[] | undefined

  /**
   * Ongoing, Completed, Cancelled, Hiatus
   */
  'narrative:publicationStatus': string[] | undefined

  /**
   * Total number of issues published
   */
  'narrative:issueCount': number[] | undefined

  /**
   * Ongoing Series, Limited Series, Mini-Series, One-Shot, etc.
   */
  'narrative:seriesType': string[] | undefined

  /**
   * Superhero, Horror, Crime, Sci-Fi, Fantasy, etc. (repeatable)
   */
  'narrative:genre': string[] | undefined

  /**
   * All Ages, Teen, Mature Readers, etc.
   */
  'narrative:ageRating': string[] | undefined

  /**
   * Series description/premise
   */
  'narrative:synopsis': string[] | undefined

  /**
   * Continuity designation (Earth-616, New 52, etc.)
   */
  'narrative:continuity': string[] | undefined
}

/**
 * Valid properties for StoryWork class
 */
export type StoryWorkProperty = 'narrative:hasExpression' | 'narrative:publishedBy' | 'narrative:imprint' | 'narrative:seriesName' | 'narrative:sortName' | 'narrative:volume' | 'narrative:yearBegan' | 'narrative:yearEnded' | 'narrative:publicationStatus' | 'narrative:issueCount' | 'narrative:seriesType' | 'narrative:genre' | 'narrative:ageRating' | 'narrative:synopsis' | 'narrative:continuity'

/**
 * Type guard for StoryWork properties
 */
export function isStoryWorkProperty(property: string): property is StoryWorkProperty {
  const validProperties: StoryWorkProperty[] = [
    'narrative:hasExpression',
    'narrative:publishedBy',
    'narrative:imprint',
    'narrative:seriesName',
    'narrative:sortName',
    'narrative:volume',
    'narrative:yearBegan',
    'narrative:yearEnded',
    'narrative:publicationStatus',
    'narrative:issueCount',
    'narrative:seriesType',
    'narrative:genre',
    'narrative:ageRating',
    'narrative:synopsis',
    'narrative:continuity'
  ]
  return validProperties.includes(property as StoryWorkProperty)
}
