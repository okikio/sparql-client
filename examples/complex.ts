/**
 * Complex Query Example
 *
 * Demonstrates advanced query patterns:
 * - Relationships between nodes
 * - Multi-hop graph traversal
 * - Optional patterns
 * - Aggregation and grouping
 * - Union queries
 *
 * Updated to:
 * - Explicitly declare FOAF and narrative prefixes.
 * - Make the PopModern example (`findCreatorsAndPublishers`) line up with
 *   your narrative.ttl ontology.
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
  type ExecutionConfig,
} from '../mod.ts'

import {
  FOAF,
  RDFS,
} from '../namespaces.ts'

const config: ExecutionConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeoutMs: 30000,
}

// ============================================================================
// Example 1: Social Network Query (FOAF)
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

  try {
    const result = await select(['?friendName', '?friendOfFriendName'])
      .prefix('foaf', FOAF._namespace)
      .where(personA)
      .where(personB)
      .where(personC)
      .where(knowsB)
      .where(knowsC)
      .execute(config)

    const rows = transformResults(result)
    console.log('Friends of friends:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 2: Optional Properties (FOAF)
// ============================================================================

async function findPeopleWithOptionalEmail() {
  console.log('\n=== Finding people (email optional) ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  // Email is optional
  const emailPattern = node('person')
    .with.prop('foaf:email', variable('email'))

  try {
    const result = await select(['?name', '?email'])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .optional(emailPattern)
      .orderBy('?name')
      .limit(20)
      .execute(config)

    const rows = transformResults(result)
    console.log('People (with/without email):', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 3: Aggregation - Count Friends (FOAF)
// ============================================================================

async function countFriendsPerPerson() {
  console.log('\n=== Counting friends per person ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  const friend = node('friend', 'foaf:Person')

  const knows = rel('person', 'foaf:knows', 'friend')

  try {
    const result = await select(['?name', count(variable('friend')).as('friendCount')])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .where(friend)
      .where(knows)
      .orderBy('?friendCount', 'DESC')
      .limit(10)
      .execute(config)

    const rows = transformResults(result)
    console.log('Friend counts:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 4: Union - Find Creators OR Publishers (narrative.ttl)
// ============================================================================

async function findCreatorsAndPublishers() {
  console.log('\n=== Finding creators OR publishers ===\n')

  // Branch 1: Creators in your narrative graph
  const creator = node('entity', 'narrative:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('narrative:role', variable('role'))

  // Branch 2: Publishers in your narrative graph
  const publisher = node('entity', 'narrative:Organization')
    .with.prop('rdfs:label', variable('name'))

  try {
    const result = await select(['?name', '?role'])
      .prefix('narrative', "http://knowledge.graph/ontology/narrative#")
      .prefix('foaf', FOAF._namespace)
      .prefix('rdfs', RDFS._namespace)
      .union(creator, publisher)
      .orderBy('?name')
      .limit(20)
      .execute(config)

    const rows = transformResults(result)
    console.log('Creators and publishers:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 5: Relationship with Properties (Generic / Example namespace)
// ============================================================================

async function findHighConfidenceConnections() {
  console.log('\n=== Finding high-confidence relationships ===\n')

  const personA = node('personA', 'foaf:Person')
    .with.prop('foaf:name', variable('nameA'))

  const personB = node('personB', 'foaf:Person')
    .with.prop('foaf:name', variable('nameB'))

  // Relationship with confidence score (using a made-up ex: namespace)
  const connection = rel('personA', 'ex:relatedTo', 'personB')
    .with.prop('ex:confidence', variable('confidence'))
    .and.prop('ex:source', variable('source'))

  try {
    const result = await select(['?nameA', '?nameB', '?confidence', '?source'])
      // In your real code, you'd also wire `ex` via namespaces.ts;
      // for now we'll assume Blazegraph has PREFIX ex: already configured.
      .prefix('foaf', FOAF._namespace)
      .where(personA)
      .where(personB)
      .where(connection)
      .filter(gte(variable('confidence'), 0.8))
      .orderBy('?confidence', 'DESC')
      .limit(20)
      .execute(config)

    const rows = transformResults(result)
    console.log('High-confidence connections:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Run examples
// ============================================================================

if (import.meta.main) {
  await findFriendsOfFriends()
  await findPeopleWithOptionalEmail()
  await countFriendsPerPerson()
  await findCreatorsAndPublishers()
  await findHighConfidenceConnections()
}
