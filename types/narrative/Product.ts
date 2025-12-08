/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Product {
  '@id': IRI<'narrative:Product'>
  '@type': 'narrative:Product'
  
  'narrative:productOf': IRI<'narrative:NarrativeUnit'>[] | undefined

  'narrative:hasManifestation': IRI<'narrative:Manifestation'>[] | undefined

  /**
   * Issues collected in this product
   */
  'narrative:collects': IRI<'narrative:StoryExpression'>[] | undefined

  /**
   * Single Issues, Collected Editions, Archives, Essentials, etc.
   */
  'narrative:productLine': string[] | undefined

  /**
   * Title of collected edition
   */
  'narrative:collectionTitle': string[] | undefined

  /**
   * Trade Paperback, Hardcover, Omnibus, Absolute, Epic Collection, etc.
   */
  'narrative:collectionType': string[] | undefined

  /**
   * Volume number in series of collections
   */
  'narrative:volumeNumber': number[] | undefined

  /**
   * Human-readable range (e.g., 'Issues #1-6')
   */
  'narrative:collectsRange': string[] | undefined

  /**
   * Contains bonus material beyond collected issues
   */
  'narrative:includesExtras': boolean[] | undefined

  /**
   * Description of extras (sketch pages, scripts, etc.)
   */
  'narrative:bonusMaterial': string[] | undefined

  /**
   * Original retail price at launch
   */
  'narrative:originalPrice': number[] | undefined

  /**
   * Current market price
   */
  'narrative:currentPrice': number[] | undefined

  /**
   * Whether currently available for purchase
   */
  'narrative:inPrint': boolean[] | undefined

  /**
   * ISBN for this product
   */
  'narrative:productISBN': string[] | undefined

  /**
   * Product release date
   */
  'narrative:releaseDate': Date[] | undefined

  /**
   * Marketing description
   */
  'narrative:productDescription': string[] | undefined
}

/**
 * Valid properties for Product class
 */
export type ProductProperty = 'narrative:productOf' | 'narrative:hasManifestation' | 'narrative:collects' | 'narrative:productLine' | 'narrative:collectionTitle' | 'narrative:collectionType' | 'narrative:volumeNumber' | 'narrative:collectsRange' | 'narrative:includesExtras' | 'narrative:bonusMaterial' | 'narrative:originalPrice' | 'narrative:currentPrice' | 'narrative:inPrint' | 'narrative:productISBN' | 'narrative:releaseDate' | 'narrative:productDescription'

/**
 * Type guard for Product properties
 */
export function isProductProperty(property: string): property is ProductProperty {
  const validProperties: ProductProperty[] = [
    'narrative:productOf',
    'narrative:hasManifestation',
    'narrative:collects',
    'narrative:productLine',
    'narrative:collectionTitle',
    'narrative:collectionType',
    'narrative:volumeNumber',
    'narrative:collectsRange',
    'narrative:includesExtras',
    'narrative:bonusMaterial',
    'narrative:originalPrice',
    'narrative:currentPrice',
    'narrative:inPrint',
    'narrative:productISBN',
    'narrative:releaseDate',
    'narrative:productDescription'
  ]
  return validProperties.includes(property as ProductProperty)
}
