/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Group {
  '@id': IRI<'narrative:Group'>
  '@type': 'narrative:Group'
  
  /**
   * Arch-enemies and rivals
   */
  'narrative:enemies': IRI<'narrative:Character'> | IRI<'narrative:Group'>[] | undefined

  /**
   * Friends and allies
   */
  'narrative:allies': IRI<'narrative:Character'> | IRI<'narrative:Group'>[] | undefined

  /**
   * Current or historical leader
   */
  'narrative:leader': IRI<'narrative:Character'>[] | undefined

  /**
   * Members of the group
   */
  'narrative:members': IRI<'narrative:Character'>[] | undefined

  /**
   * Location of headquarters
   */
  'narrative:headquarters': string[] | undefined

  /**
   * Official name of team/organization
   */
  'narrative:groupName': string[] | undefined

  /**
   * Previous names
   */
  'narrative:formerNames': string[] | undefined

  /**
   * Hero Team, Villain Organization, Government Agency, etc.
   */
  'narrative:groupType': string[] | undefined

  /**
   * Good, Evil, Neutral, etc.
   */
  'narrative:alignment': string[] | undefined

  /**
   * When group was founded (in-universe)
   */
  'narrative:formed': string[] | undefined

  /**
   * When group disbanded (if applicable)
   */
  'narrative:disbanded': string[] | undefined

  /**
   * Active, Disbanded, Reformed, etc.
   */
  'narrative:groupStatus': string[] | undefined

  /**
   * Mission or purpose of group
   */
  'narrative:purpose': string[] | undefined
}

/**
 * Valid properties for Group class
 */
export type GroupProperty = 'narrative:enemies' | 'narrative:allies' | 'narrative:leader' | 'narrative:members' | 'narrative:headquarters' | 'narrative:groupName' | 'narrative:formerNames' | 'narrative:groupType' | 'narrative:alignment' | 'narrative:formed' | 'narrative:disbanded' | 'narrative:groupStatus' | 'narrative:purpose'

/**
 * Type guard for Group properties
 */
export function isGroupProperty(property: string): property is GroupProperty {
  const validProperties: GroupProperty[] = [
    'narrative:enemies',
    'narrative:allies',
    'narrative:leader',
    'narrative:members',
    'narrative:headquarters',
    'narrative:groupName',
    'narrative:formerNames',
    'narrative:groupType',
    'narrative:alignment',
    'narrative:formed',
    'narrative:disbanded',
    'narrative:groupStatus',
    'narrative:purpose'
  ]
  return validProperties.includes(property as GroupProperty)
}
