/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Item {
  '@id': IRI<'narrative:Item'>
  '@type': 'narrative:Item'
  
  'narrative:itemOf': IRI<'narrative:Manifestation'>[] | undefined

  /**
   * Company that owns franchise rights
   */
  'narrative:owner': IRI<'narrative:Org'> | IRI<'n3-0'>[] | undefined

  /**
   * Person(s) who signed this copy
   */
  'narrative:signedBy': IRI<'narrative:Person'>[] | undefined

  /**
   * Person who currently has item checked out
   */
  'narrative:checkedOutTo': IRI<'narrative:Person'>[] | undefined

  /**
   * Library barcode or collection tracking number
   */
  'narrative:barcode': string[] | undefined

  /**
   * Condition description (CGC scale: Poor, Good, Fine, VF, NM, Mint)
   */
  'narrative:condition': string[] | undefined

  /**
   * Whether item is professionally graded by CGC/CBCS
   */
  'narrative:cgcGraded': boolean[] | undefined

  /**
   * Numeric grade (0.5 to 10.0) if CGC graded
   */
  'narrative:cgcGrade': number[] | undefined

  /**
   * CGC/CBCS certification number
   */
  'narrative:certificationNumber': string[] | undefined

  /**
   * Whether the item is signed
   */
  'narrative:signed': boolean[] | undefined

  /**
   * Where signature appears (cover, interior, etc.)
   */
  'narrative:signatureLocation': string[] | undefined

  /**
   * Whether signature is authenticated
   */
  'narrative:authenticated': boolean[] | undefined

  /**
   * Date item was acquired
   */
  'narrative:acquisitionDate': Date[] | undefined

  /**
   * Purchase price when acquired
   */
  'narrative:acquisitionPrice': number[] | undefined

  /**
   * Current estimated market value of this specific copy
   */
  'narrative:currentValue': number[] | undefined

  /**
   * Current market price for this condition/grade
   */
  'narrative:currentMarketPrice': number[] | undefined

  /**
   * Manufacturer's Suggested Retail Price (original cover price)
   */
  'narrative:msrp': number[] | undefined

  /**
   * Date of most recent valuation
   */
  'narrative:valuationDate': Date[] | undefined

  /**
   * Physical location (shelf, box, row, etc.)
   */
  'narrative:location': string[] | undefined

  /**
   * How stored (long box, short box, bag+board, slab, etc.)
   */
  'narrative:storageType': string[] | undefined

  /**
   * Available, Checked Out, Reference Only, Lost, Damaged, etc.
   */
  'narrative:circulationStatus': string[] | undefined

  /**
   * Due date for return if checked out
   */
  'narrative:dueDate': Date[] | undefined

  /**
   * Free-form notes about this specific copy
   */
  'narrative:itemNotes': string[] | undefined

  /**
   * Specific defects (spine stress, corner crease, water damage, etc.)
   */
  'narrative:defects': string[] | undefined
}

/**
 * Valid properties for Item class
 */
export type ItemProperty = 'narrative:itemOf' | 'narrative:owner' | 'narrative:signedBy' | 'narrative:checkedOutTo' | 'narrative:barcode' | 'narrative:condition' | 'narrative:cgcGraded' | 'narrative:cgcGrade' | 'narrative:certificationNumber' | 'narrative:signed' | 'narrative:signatureLocation' | 'narrative:authenticated' | 'narrative:acquisitionDate' | 'narrative:acquisitionPrice' | 'narrative:currentValue' | 'narrative:currentMarketPrice' | 'narrative:msrp' | 'narrative:valuationDate' | 'narrative:location' | 'narrative:storageType' | 'narrative:circulationStatus' | 'narrative:dueDate' | 'narrative:itemNotes' | 'narrative:defects'

/**
 * Type guard for Item properties
 */
export function isItemProperty(property: string): property is ItemProperty {
  const validProperties: ItemProperty[] = [
    'narrative:itemOf',
    'narrative:owner',
    'narrative:signedBy',
    'narrative:checkedOutTo',
    'narrative:barcode',
    'narrative:condition',
    'narrative:cgcGraded',
    'narrative:cgcGrade',
    'narrative:certificationNumber',
    'narrative:signed',
    'narrative:signatureLocation',
    'narrative:authenticated',
    'narrative:acquisitionDate',
    'narrative:acquisitionPrice',
    'narrative:currentValue',
    'narrative:currentMarketPrice',
    'narrative:msrp',
    'narrative:valuationDate',
    'narrative:location',
    'narrative:storageType',
    'narrative:circulationStatus',
    'narrative:dueDate',
    'narrative:itemNotes',
    'narrative:defects'
  ]
  return validProperties.includes(property as ItemProperty)
}
