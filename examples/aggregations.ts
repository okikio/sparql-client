/**
 * Aggregation Functions Example
 *
 * Demonstrates SPARQL aggregation functions:
 * - COUNT, SUM, AVG, MIN, MAX
 * - GROUP_CONCAT, SAMPLE
 * - Using .as() for variable binding
 * - GROUP BY patterns
 *
 * Updated to:
 * - Use FOAF & narrative namespaces explicitly.
 * - Work cleanly with Blazegraph + narrative.ttl.
 */

import {
  node,
  rel,
  select,
  variable,
  count,
  countDistinct,
  sum,
  avg,
  min,
  max,
  groupConcat,
  sample,
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
// Example 1: COUNT - Simple Counting (FOAF)
// ============================================================================

async function countPeople() {
  console.log('\n=== Counting total people ===\n')

  const person = node('person', 'foaf:Person')

  try {
    const result = await select([count().as('total')])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?total')
      .execute(config)

    const rows = transformResults(result)
    console.log('Total people:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 2: COUNT with GROUP BY (FOAF)
// ============================================================================

async function countByAge() {
  console.log('\n=== Counting people by age group ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))

  try {
    const result = await select([
      '?age',
      count(variable('person')).as('count'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?age')
      .orderBy('?count', 'DESC')
      .execute(config)

    const rows = transformResults(result)
    console.log('Count by age:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 3: COUNT DISTINCT (FOAF)
// ============================================================================

async function countUniqueNames() {
  console.log('\n=== Counting unique names ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  try {
    const result = await select([
      countDistinct(variable('name')).as('uniqueNames'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?uniqueNames')
      .execute(config)

    const rows = transformResults(result)
    console.log('Unique names:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 4: SUM, AVG, MIN, MAX - Numeric Aggregations (FOAF)
// ============================================================================

async function numericAggregations() {
  console.log('\n=== Numeric aggregations on age ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))

  try {
    const result = await select([
      sum(variable('age')).as('totalAge'),
      avg(variable('age')).as('avgAge'),
      min(variable('age')).as('minAge'),
      max(variable('age')).as('maxAge'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?age')
      .execute(config)

    const rows = transformResults(result)
    console.log('Age statistics:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 5: GROUP_CONCAT - String Aggregation (FOAF)
// ============================================================================

async function concatenateNames() {
  console.log('\n=== Concatenating friend names ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('personName'))

  const friend = node('friend', 'foaf:Person')
    .with.prop('foaf:name', variable('friendName'))

  const knows = rel('person', 'foaf:knows', 'friend')

  try {
    const result = await select([
      '?personName',
      groupConcat(variable('friendName'), ', ').as('allFriends'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .where(friend)
      .where(knows)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?personName')
      .orderBy('?personName')
      .execute(config)

    const rows = transformResults(result)
    console.log('Friends list:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 6: SAMPLE - Arbitrary Value Selection (FOAF)
// ============================================================================

async function sampleValues() {
  console.log('\n=== Sampling one value per group ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))
    .and.prop('foaf:name', variable('name'))

  try {
    const result = await select([
      '?age',
      sample(variable('name')).as('exampleName'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?age')
      .orderBy('?age')
      .execute(config)

    const rows = transformResults(result)
    console.log('Sample names by age:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 7: Multiple Aggregations with Filtering (FOAF)
// ============================================================================

async function complexAggregation() {
  console.log('\n=== Complex aggregation with multiple metrics ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  const friend = node('friend', 'foaf:Person')

  const knows = rel('person', 'foaf:knows', 'friend')

  try {
    const result = await select([
      '?name',
      '?age',
      count(variable('friend')).as('friendCount'),
      avg(variable('age')).as('avgAge'),
    ])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .where(friend)
      .where(knows)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?name', '?age')
      .orderBy('?friendCount', 'DESC')
      .limit(10)
      .execute(config)

    const rows = transformResults(result)
    console.log('Complex aggregation:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 8: Pop Modern - Count Comics by Publisher (narrative.ttl)
// ============================================================================

async function countComicsByPublisher() {
  console.log('\n=== Counting comics by publisher ===\n')

  const comic = node('comic', 'narrative:Product')

  const publisher = node('publisher', 'narrative:Organization')
    .with.prop('rdfs:label', variable('publisherName'))

  const publishedBy = rel('comic', 'narrative:publishedBy', 'publisher')

  try {
    const result = await select([
      '?publisherName',
      count(variable('comic')).as('comicCount'),
    ])
      .prefix('narrative', "http://knowledge.graph/ontology/narrative#")
      .prefix('rdfs', RDFS._namespace)
      .where(comic)
      .where(publisher)
      .where(publishedBy)
      // 🔧 NEW: make the aggregation legal in Blazegraph
      .groupBy('?publisherName')
      .orderBy('?comicCount', 'DESC')
      .limit(20)
      .execute(config)

    const rows = transformResults(result)
    console.log('Comics by publisher:', rows)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.main) {
  await countPeople()
  await countByAge()
  await countUniqueNames()
  await numericAggregations()
  await concatenateNames()
  await sampleValues()
  await complexAggregation()
  await countComicsByPublisher()
}
