/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Manifestation {
  '@id': IRI<'narrative:Manifestation'>
  '@type': 'narrative:Manifestation'
  
  'narrative:manifestationOf': IRI<'narrative:Product'>[] | undefined

  'narrative:hasItem': IRI<'narrative:Item'>[] | undefined

  /**
   * Original manifestation being reprinted
   */
  'narrative:reprintOf': IRI<'narrative:Manifestation'>[] | undefined

  /**
   * Artist who created the cover
   */
  'narrative:coverArtist': IRI<'narrative:Person'>[] | undefined

  /**
   * Distribution company (Diamond, Lunar, etc.)
   */
  'narrative:distributor': IRI<'narrative:Org'>[] | undefined

  /**
   * Single Issue, Trade Paperback, Hardcover, Omnibus, Digital, etc.
   */
  'narrative:format': string[] | undefined

  /**
   * First Edition, Second Printing, Deluxe Edition, etc.
   */
  'narrative:edition': string[] | undefined

  /**
   * Number of copies printed
   */
  'narrative:printRun': number[] | undefined

  /**
   * Saddle-Stitched, Perfect Bound, Hardcover, etc.
   */
  'narrative:binding': string[] | undefined

  /**
   * Physical dimensions (6.625 x 10.25 inches, etc.)
   */
  'narrative:trim': string[] | undefined

  /**
   * Paper type and quality
   */
  'narrative:paperStock': string[] | undefined

  /**
   * Cover material and finish
   */
  'narrative:coverStock': string[] | undefined

  /**
   * Offset, Digital, Letterpress, etc.
   */
  'narrative:printingProcess': string[] | undefined

  /**
   * Date this printing was produced
   */
  'narrative:printDate': Date[] | undefined

  /**
   * Whether this is a reprint
   */
  'narrative:reprinted': boolean[] | undefined

  /**
   * Variant type (Cover A/B, Retailer Incentive, Ratio 1:25, etc.)
   */
  'narrative:variant': string[] | undefined

  /**
   * Sketch pages, interviews, extras included
   */
  'narrative:specialFeatures': string[] | undefined

  /**
   * Convention exclusive, limited distribution, etc.
   */
  'narrative:restricted': boolean[] | undefined
}

/**
 * Valid properties for Manifestation class
 */
export type ManifestationProperty = 'narrative:manifestationOf' | 'narrative:hasItem' | 'narrative:reprintOf' | 'narrative:coverArtist' | 'narrative:distributor' | 'narrative:format' | 'narrative:edition' | 'narrative:printRun' | 'narrative:binding' | 'narrative:trim' | 'narrative:paperStock' | 'narrative:coverStock' | 'narrative:printingProcess' | 'narrative:printDate' | 'narrative:reprinted' | 'narrative:variant' | 'narrative:specialFeatures' | 'narrative:restricted'

/**
 * Type guard for Manifestation properties
 */
export function isManifestationProperty(property: string): property is ManifestationProperty {
  const validProperties: ManifestationProperty[] = [
    'narrative:manifestationOf',
    'narrative:hasItem',
    'narrative:reprintOf',
    'narrative:coverArtist',
    'narrative:distributor',
    'narrative:format',
    'narrative:edition',
    'narrative:printRun',
    'narrative:binding',
    'narrative:trim',
    'narrative:paperStock',
    'narrative:coverStock',
    'narrative:printingProcess',
    'narrative:printDate',
    'narrative:reprinted',
    'narrative:variant',
    'narrative:specialFeatures',
    'narrative:restricted'
  ]
  return validProperties.includes(property as ManifestationProperty)
}
