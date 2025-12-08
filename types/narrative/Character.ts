/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

export interface Character {
  '@id': IRI<'narrative:Character'>
  '@type': 'narrative:Character'
  
  'narrative:belongsToFranchise': IRI<'narrative:Franchise'>[] | undefined

  'narrative:existsInUniverse': IRI<'narrative:Universe'>[] | undefined

  /**
   * Team memberships
   */
  'narrative:affiliation': IRI<'narrative:Group'>[] | undefined

  /**
   * Arch-enemies and rivals
   */
  'narrative:enemies': IRI<'narrative:Character'> | IRI<'narrative:Group'>[] | undefined

  /**
   * Friends and allies
   */
  'narrative:allies': IRI<'narrative:Character'> | IRI<'narrative:Group'>[] | undefined

  /**
   * Issue of first appearance
   */
  'narrative:firstAppearanceIn': IRI<'narrative:StoryExpression'>[] | undefined

  'narrative:hasCharacterRelationship': IRI<'narrative:CharacterRelationship'>[] | undefined

  /**
   * Gender identity
   */
  'narrative:gender': string[] | undefined

  /**
   * Active, Defunct, Acquired, Merged, etc.
   */
  'narrative:status': string[] | undefined

  /**
   * Primary character name
   */
  'narrative:characterName': string[] | undefined

  /**
   * Secret identity/civilian name
   */
  'narrative:realName': string[] | undefined

  /**
   * Alternate identities, codenames, nicknames
   */
  'narrative:aliases': string[] | undefined

  /**
   * Hero, Villain, Anti-Hero, Supporting, Civilian, etc.
   */
  'narrative:characterType': string[] | undefined

  /**
   * Human, Mutant, Alien, God, Robot, etc.
   */
  'narrative:species': string[] | undefined

  /**
   * Character height
   */
  'narrative:height': string[] | undefined

  /**
   * Character weight
   */
  'narrative:weight': string[] | undefined

  /**
   * Eye color
   */
  'narrative:eyeColor': string[] | undefined

  /**
   * Hair color
   */
  'narrative:hairColor': string[] | undefined

  /**
   * Superpowers and special abilities
   */
  'narrative:powers': string[] | undefined

  /**
   * Skills, training, expertise
   */
  'narrative:abilities': string[] | undefined

  /**
   * Street Level, City Level, Global, Cosmic, etc.
   */
  'narrative:powerLevel': string[] | undefined

  /**
   * Signature weapons and equipment
   */
  'narrative:weapons': string[] | undefined

  /**
   * Origin story summary
   */
  'narrative:origin': string[] | undefined

  /**
   * Job/profession
   */
  'narrative:occupation': string[] | undefined

  /**
   * Home city or base location
   */
  'narrative:baseOfOperations': string[] | undefined

  /**
   * Where character was born
   */
  'narrative:placeOfBirth': string[] | undefined

  /**
   * Character biography
   */
  'narrative:bio': string[] | undefined
}

/**
 * Valid properties for Character class
 */
export type CharacterProperty = 'narrative:belongsToFranchise' | 'narrative:existsInUniverse' | 'narrative:affiliation' | 'narrative:enemies' | 'narrative:allies' | 'narrative:firstAppearanceIn' | 'narrative:hasCharacterRelationship' | 'narrative:gender' | 'narrative:status' | 'narrative:characterName' | 'narrative:realName' | 'narrative:aliases' | 'narrative:characterType' | 'narrative:species' | 'narrative:height' | 'narrative:weight' | 'narrative:eyeColor' | 'narrative:hairColor' | 'narrative:powers' | 'narrative:abilities' | 'narrative:powerLevel' | 'narrative:weapons' | 'narrative:origin' | 'narrative:occupation' | 'narrative:baseOfOperations' | 'narrative:placeOfBirth' | 'narrative:bio'

/**
 * Type guard for Character properties
 */
export function isCharacterProperty(property: string): property is CharacterProperty {
  const validProperties: CharacterProperty[] = [
    'narrative:belongsToFranchise',
    'narrative:existsInUniverse',
    'narrative:affiliation',
    'narrative:enemies',
    'narrative:allies',
    'narrative:firstAppearanceIn',
    'narrative:hasCharacterRelationship',
    'narrative:gender',
    'narrative:status',
    'narrative:characterName',
    'narrative:realName',
    'narrative:aliases',
    'narrative:characterType',
    'narrative:species',
    'narrative:height',
    'narrative:weight',
    'narrative:eyeColor',
    'narrative:hairColor',
    'narrative:powers',
    'narrative:abilities',
    'narrative:powerLevel',
    'narrative:weapons',
    'narrative:origin',
    'narrative:occupation',
    'narrative:baseOfOperations',
    'narrative:placeOfBirth',
    'narrative:bio'
  ]
  return validProperties.includes(property as CharacterProperty)
}
