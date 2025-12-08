/**
 * Generated from TTL ontology
 * Do not edit manually
 */

export * from './Person'
export * from './Org'
export * from './Role'
export * from './StoryWork'
export * from './StoryExpression'
export * from './NarrativeUnit'
export * from './Product'
export * from './Manifestation'
export * from './Item'
export * from './Character'
export * from './Franchise'
export * from './Universe'
export * from './Group'
export * from './Relationship'
export * from './Performer'
export * from './Actor'
export * from './VoiceActor'
export * from './Singer'
export * from './Dancer'
export * from './Writer'
export * from './Screenwriter'
export * from './Artist'
export * from './Penciller'
export * from './Inker'
export * from './Colorist'
export * from './Letterer'
export * from './Director'
export * from './Producer'
export * from './WorkedWithRelationship'
export * from './CreditRelationship'
export * from './PortrayalRelationship'
export * from './CharacterRelationship'
export * from './FamilyRelationship'
export * from './FriendshipRelationship'
export * from './AllianceRelationship'
export * from './RivalryRelationship'
export * from './SupernaturalRelationship'
export * from './ParentChild'
export * from './Rivals'
export * from './AlternateSelf'
export * from './PoliticalAllies'

/**
 * All class URIs
 */
export const Classes = {
  Person: 'http://knowledge.graph/ontology/narrative#Person',
  Org: 'http://knowledge.graph/ontology/narrative#Org',
  Role: 'http://knowledge.graph/ontology/narrative#Role',
  StoryWork: 'http://knowledge.graph/ontology/narrative#StoryWork',
  StoryExpression: 'http://knowledge.graph/ontology/narrative#StoryExpression',
  NarrativeUnit: 'http://knowledge.graph/ontology/narrative#NarrativeUnit',
  Product: 'http://knowledge.graph/ontology/narrative#Product',
  Manifestation: 'http://knowledge.graph/ontology/narrative#Manifestation',
  Item: 'http://knowledge.graph/ontology/narrative#Item',
  Character: 'http://knowledge.graph/ontology/narrative#Character',
  Franchise: 'http://knowledge.graph/ontology/narrative#Franchise',
  Universe: 'http://knowledge.graph/ontology/narrative#Universe',
  Group: 'http://knowledge.graph/ontology/narrative#Group',
  Relationship: 'http://knowledge.graph/ontology/narrative#Relationship',
  Performer: 'http://knowledge.graph/ontology/narrative#Performer',
  Actor: 'http://knowledge.graph/ontology/narrative#Actor',
  VoiceActor: 'http://knowledge.graph/ontology/narrative#VoiceActor',
  Singer: 'http://knowledge.graph/ontology/narrative#Singer',
  Dancer: 'http://knowledge.graph/ontology/narrative#Dancer',
  Writer: 'http://knowledge.graph/ontology/narrative#Writer',
  Screenwriter: 'http://knowledge.graph/ontology/narrative#Screenwriter',
  Artist: 'http://knowledge.graph/ontology/narrative#Artist',
  Penciller: 'http://knowledge.graph/ontology/narrative#Penciller',
  Inker: 'http://knowledge.graph/ontology/narrative#Inker',
  Colorist: 'http://knowledge.graph/ontology/narrative#Colorist',
  Letterer: 'http://knowledge.graph/ontology/narrative#Letterer',
  Director: 'http://knowledge.graph/ontology/narrative#Director',
  Producer: 'http://knowledge.graph/ontology/narrative#Producer',
  WorkedWithRelationship: 'http://knowledge.graph/ontology/narrative#WorkedWithRelationship',
  CreditRelationship: 'http://knowledge.graph/ontology/narrative#CreditRelationship',
  PortrayalRelationship: 'http://knowledge.graph/ontology/narrative#PortrayalRelationship',
  CharacterRelationship: 'http://knowledge.graph/ontology/narrative#CharacterRelationship',
  FamilyRelationship: 'http://knowledge.graph/ontology/narrative#FamilyRelationship',
  FriendshipRelationship: 'http://knowledge.graph/ontology/narrative#FriendshipRelationship',
  AllianceRelationship: 'http://knowledge.graph/ontology/narrative#AllianceRelationship',
  RivalryRelationship: 'http://knowledge.graph/ontology/narrative#RivalryRelationship',
  SupernaturalRelationship: 'http://knowledge.graph/ontology/narrative#SupernaturalRelationship',
  ParentChild: 'http://knowledge.graph/ontology/narrative#ParentChild',
  Rivals: 'http://knowledge.graph/ontology/narrative#Rivals',
  AlternateSelf: 'http://knowledge.graph/ontology/narrative#AlternateSelf',
  PoliticalAllies: 'http://knowledge.graph/ontology/narrative#PoliticalAllies'
} as const

/**
 * Union of all class types
 */
export type AnyClass = Person | Org | Role | StoryWork | StoryExpression | NarrativeUnit | Product | Manifestation | Item | Character | Franchise | Universe | Group | Relationship | Performer | Actor | VoiceActor | Singer | Dancer | Writer | Screenwriter | Artist | Penciller | Inker | Colorist | Letterer | Director | Producer | WorkedWithRelationship | CreditRelationship | PortrayalRelationship | CharacterRelationship | FamilyRelationship | FriendshipRelationship | AllianceRelationship | RivalryRelationship | SupernaturalRelationship | ParentChild | Rivals | AlternateSelf | PoliticalAllies

/**
 * Type guard for valid class URIs
 */
export function isValidClass(uri: string): uri is typeof Classes[keyof typeof Classes] {
  return Object.values(Classes).includes(uri as any)
}
