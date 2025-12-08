/**
 * Aggregation Functions Example
 * 
 * Demonstrates SPARQL aggregation functions:
 * - COUNT, SUM, AVG, MIN, MAX
 * - GROUP_CONCAT, SAMPLE
 * - Using .as() for variable binding
 * - GROUP BY patterns
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
  type ExecutorConfig,
  transformResults,
} from '../mod.ts'

const config: ExecutorConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeout: 30000,
}

// ============================================================================
// Example 1: COUNT - Simple Counting
// ============================================================================

async function countPeople() {
  console.log('\n=== Counting total people ===\n')

  const person = node('person', 'foaf:Person')

  // COUNT(*) AS ?total
  const result = await select([count().as('total')])
    .where(person)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Total people:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 2: COUNT with GROUP BY
// ============================================================================

async function countByAge() {
  console.log('\n=== Counting people by age group ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))

  // COUNT(?person) AS ?count
  const result = await select([
    '?age',
    count(variable('person')).as('count')
  ])
    .where(person)
    .orderBy('?count', 'DESC')
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Count by age:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 3: COUNT DISTINCT
// ============================================================================

async function countUniqueNames() {
  console.log('\n=== Counting unique names ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))

  const result = await select([
    countDistinct(variable('name')).as('uniqueNames')
  ])
    .where(person)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Unique names:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 4: SUM, AVG, MIN, MAX - Numeric Aggregations
// ============================================================================

async function numericAggregations() {
  console.log('\n=== Numeric aggregations on age ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))

  const result = await select([
    sum(variable('age')).as('totalAge'),
    avg(variable('age')).as('avgAge'),
    min(variable('age')).as('minAge'),
    max(variable('age')).as('maxAge'),
  ])
    .where(person)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Age statistics:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 5: GROUP_CONCAT - String Aggregation
// ============================================================================

async function concatenateNames() {
  console.log('\n=== Concatenating friend names ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('personName'))

  const friend = node('friend', 'foaf:Person')
    .with.prop('foaf:name', variable('friendName'))

  const knows = rel('person', 'foaf:knows', 'friend')

  // GROUP_CONCAT(?friendName; separator=", ") AS ?allFriends
  const result = await select([
    '?personName',
    groupConcat(variable('friendName'), ', ').as('allFriends')
  ])
    .where(person)
    .where(friend)
    .where(knows)
    .orderBy('?personName')
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Friends list:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 6: SAMPLE - Arbitrary Value Selection
// ============================================================================

async function sampleValues() {
  console.log('\n=== Sampling one value per group ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:age', variable('age'))
    .and.prop('foaf:name', variable('name'))

  // Get one example name for each age
  const result = await select([
    '?age',
    sample(variable('name')).as('exampleName')
  ])
    .where(person)
    .orderBy('?age')
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Sample names by age:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 7: Multiple Aggregations with Filtering
// ============================================================================

async function complexAggregation() {
  console.log('\n=== Complex aggregation with multiple metrics ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  const friend = node('friend', 'foaf:Person')

  const knows = rel('person', 'foaf:knows', 'friend')

  const result = await select([
    '?name',
    '?age',
    count(variable('friend')).as('friendCount'),
    avg(variable('age')).as('avgAge'),
  ])
    .where(person)
    .where(friend)
    .where(knows)
    .orderBy('?friendCount', 'DESC')
    .limit(10)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Complex aggregation:', rows)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 8: Pop Modern - Count Comics by Publisher
// ============================================================================

async function countComicsByPublisher() {
  console.log('\n=== Counting comics by publisher ===\n')

  const comic = node('comic', 'narrative:Product')

  const publisher = node('publisher', 'narrative:Organization')
    .with.prop('rdfs:label', variable('publisherName'))

  const publishedBy = rel('comic', 'narrative:publishedBy', 'publisher')

  const result = await select([
    '?publisherName',
    count(variable('comic')).as('comicCount')
  ])
    .where(comic)
    .where(publisher)
    .where(publishedBy)
    .orderBy('?comicCount', 'DESC')
    .limit(20)
    .execute(config)

  if (result.success) {
    const rows = transformResults(result.data)
    console.log('Comics by publisher:', rows)
  } else {
    console.error('Query failed:', result.error)
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