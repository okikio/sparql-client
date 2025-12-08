/**
 * Complex Query Example
 * 
 * Demonstrates advanced query patterns:
 * - Relationships between nodes
 * - Multi-hop graph traversal
 * - Optional patterns
 * - Aggregation and grouping
 * - Union queries
 */

import {
  node,
  rel,
  select,
  variable,
  str,
  gte,
  count,
  transformResults,
  type ExecutorConfig,
} from '../mod.ts'

const config: ExecutorConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeout: 30000,
}

// ============================================================================
// Example 1: Social Network Query
// ============================================================================

async function findFriendsOfFriends() {
  console.log('\n=== Finding friends of friends ===\n')

  // Person A
  const personA = node('personA', 'foaf:Person')
    .with.prop('foaf:name', str('Alice'))

  // Person B (direct friend)
  const personB = node('personB', 'foaf:Person')
    .with.prop('foaf:name', variable('friendName'))

  // Person C (friend of friend)
  const personC = node('personC', 'foaf:Person')
    .with.prop('foaf:name', variable('friendOfFriendName'))

  // Relationships
  const knowsB = rel('personA', 'foaf:knows', 'personB')
  const knowsC = rel('personB', 'foaf:knows', 'personC')

  const result = await select(['?friendName', '?friendOfFriendName'])
    .where(personA)
    .where(personB)
    .where(personC)
    .where(knowsB)
    .where(knowsC)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Friends of friends:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 2: Optional Properties
// ============================================================================

async function findPeopleWithOptionalEmail() {
  console.log('\n=== Finding people (email optional) ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  // Email is optional
  const emailPattern = node('person')
    .with.prop('foaf:email', variable('email'))

  const result = await select(['?name', '?email'])
    .where(person)
    .optional(emailPattern)
    .orderBy('?name')
    .limit(20)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('People (with/without email):', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 3: Aggregation - Count Friends
// ============================================================================

async function countFriendsPerPerson() {
  console.log('\n=== Counting friends per person ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  const friend = node('friend', 'foaf:Person')

  const knows = rel('person', 'foaf:knows', 'friend')

  // Use aggregation with GROUP BY
  const result = await select(['?name', count(variable('friend')).as('friendCount')])
    .where(person)
    .where(friend)
    .where(knows)
    .orderBy('?friendCount', 'DESC')
    .limit(10)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Friend counts:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 4: Union - Find Multiple Types
// ============================================================================

async function findCreatorsAndPublishers() {
  console.log('\n=== Finding creators OR publishers ===\n')

  // Branch 1: Creators
  const creator = node('entity', 'narrative:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('narrative:role', variable('role'))

  // Branch 2: Publishers
  const publisher = node('entity', 'narrative:Organization')
    .with.prop('rdfs:label', variable('name'))

  const result = await select(['?name', '?role'])
    .union(creator, publisher)
    .orderBy('?name')
    .limit(20)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Creators and publishers:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 5: Relationship with Properties (Reification)
// ============================================================================

async function findHighConfidenceConnections() {
  console.log('\n=== Finding high-confidence relationships ===\n')

  const personA = node('personA', 'foaf:Person')
    .with.prop('foaf:name', variable('nameA'))

  const personB = node('personB', 'foaf:Person')
    .with.prop('foaf:name', variable('nameB'))

  // Relationship with confidence score
  const connection = rel('personA', 'ex:relatedTo', 'personB')
    .with.prop('ex:confidence', variable('confidence'))
    .and.prop('ex:source', variable('source'))

  const result = await select(['?nameA', '?nameB', '?confidence', '?source'])
    .where(personA)
    .where(personB)
    .where(connection)
    .filter(gte(variable('confidence'), 0.8))
    .orderBy('?confidence', 'DESC')
    .limit(10)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('High-confidence connections:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 6: Multi-Hop with Distance Limit
// ============================================================================

async function findPeopleWithinTwoHops() {
  console.log('\n=== Finding people within 2 hops ===\n')

  const start = node('start', 'foaf:Person')
    .with.prop('foaf:name', str('Alice'))

  const hop1 = node('hop1', 'foaf:Person')
    .with.prop('foaf:name', variable('hop1Name'))

  const hop2 = node('hop2', 'foaf:Person')
    .with.prop('foaf:name', variable('hop2Name'))

  const knows1 = rel('start', 'foaf:knows', 'hop1')
  const knows2 = rel('hop1', 'foaf:knows', 'hop2')

  const result = await select(['?hop1Name', '?hop2Name'])
    .where(start)
    .where(hop1)
    .where(hop2)
    .where(knows1)
    .where(knows2)
    .distinct()
    .limit(50)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('People within 2 hops:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.main) {
  await findFriendsOfFriends()
  await findPeopleWithOptionalEmail()
  await countFriendsPerPerson()
  await findCreatorsAndPublishers()
  await findHighConfidenceConnections()
  await findPeopleWithinTwoHops()
}