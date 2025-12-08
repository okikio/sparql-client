/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface StoryExpression {
  '@id': IRI<'narrative:StoryExpression'>
  '@type': 'narrative:StoryExpression'
  
  'narrative:expressionOf': IRI<'narrative:StoryWork'>[] | undefined

  'narrative:hasNarrativeUnit': IRI<'narrative:NarrativeUnit'>[] | undefined

  /**
   * Characters making first appearance
   */
  'narrative:firstAppearance': IRI<'narrative:Character'>[] | undefined

  /**
   * Issue number (can be string for special issues like '0', 'Annual')
   */
  'narrative:issueNumber': string[] | undefined

  /**
   * Title of this specific issue
   */
  'narrative:issueTitle': string[] | undefined

  /**
   * URL to cover image
   */
  'narrative:coverImage': string[] | undefined

  /**
   * Issue subtitle or chapter title
   */
  'narrative:subtitle': string[] | undefined

  /**
   * Alternate numbering (legacy numbering, etc.)
   */
  'narrative:altNumber': string[] | undefined

  /**
   * Cover date (month/year on cover)
   */
  'narrative:coverDate': Date[] | undefined

  /**
   * Actual release date to stores
   */
  'narrative:storeDate': Date[] | undefined

  /**
   * Digital release date (often different from print)
   */
  'narrative:digitalReleaseDate': Date[] | undefined

  /**
   * Number of pages
   */
  'narrative:pageCount': number[] | undefined

  /**
   * Story pages (excluding ads)
   */
  'narrative:storyPageCount': number[] | undefined

  /**
   * Issue description/solicitation text
   */
  'narrative:description': string[] | undefined

  /**
   * Whether issue contains backup/second story
   */
  'narrative:hasBackupStory': boolean[] | undefined

  /**
   * Diamond SKU or order code
   */
  'narrative:sku': string[] | undefined

  /**
   * ISBN (for collected editions)
   */
  'narrative:isbn': string[] | undefined

  /**
   * UPC barcode
   */
  'narrative:upc': string[] | undefined

  /**
   * ComicVine ID
   */
  'narrative:comicVineId': string[] | undefined

  /**
   * Grand Comics Database ID
   */
  'narrative:gcdId': string[] | undefined

  /**
   * Whether considered a key/significant issue
   */
  'narrative:isKeyIssue': boolean[] | undefined

  /**
   * Major story events (death of X, origin story, etc.)
   */
  'narrative:significantEvent': string[] | undefined

  /**
   * Name of crossover event (if applicable)
   */
  'narrative:crossover': string[] | undefined
}

/**
 * Valid properties for StoryExpression class
 */
export type StoryExpressionProperty = 'narrative:expressionOf' | 'narrative:hasNarrativeUnit' | 'narrative:firstAppearance' | 'narrative:issueNumber' | 'narrative:issueTitle' | 'narrative:coverImage' | 'narrative:subtitle' | 'narrative:altNumber' | 'narrative:coverDate' | 'narrative:storeDate' | 'narrative:digitalReleaseDate' | 'narrative:pageCount' | 'narrative:storyPageCount' | 'narrative:description' | 'narrative:hasBackupStory' | 'narrative:sku' | 'narrative:isbn' | 'narrative:upc' | 'narrative:comicVineId' | 'narrative:gcdId' | 'narrative:isKeyIssue' | 'narrative:significantEvent' | 'narrative:crossover'

/**
 * Type guard for StoryExpression properties
 */
export function isStoryExpressionProperty(property: string): property is StoryExpressionProperty {
  const validProperties: StoryExpressionProperty[] = [
    'narrative:expressionOf',
    'narrative:hasNarrativeUnit',
    'narrative:firstAppearance',
    'narrative:issueNumber',
    'narrative:issueTitle',
    'narrative:coverImage',
    'narrative:subtitle',
    'narrative:altNumber',
    'narrative:coverDate',
    'narrative:storeDate',
    'narrative:digitalReleaseDate',
    'narrative:pageCount',
    'narrative:storyPageCount',
    'narrative:description',
    'narrative:hasBackupStory',
    'narrative:sku',
    'narrative:isbn',
    'narrative:upc',
    'narrative:comicVineId',
    'narrative:gcdId',
    'narrative:isKeyIssue',
    'narrative:significantEvent',
    'narrative:crossover'
  ]
  return validProperties.includes(property as StoryExpressionProperty)
}
