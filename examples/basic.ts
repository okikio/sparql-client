/**
 * Basic Query Example
 * 
 * Demonstrates fundamental usage of the query builder:
 * - Creating node patterns
 * - Using fluent property chains
 * - Basic filtering and sorting
 * - Query execution
 */

import {
  node,
  select,
  variable,
  gte,
  regex,
  and,
  type ExecutorConfig,
} from '../mod.ts'

// Configure your SPARQL endpoint
const config: ExecutorConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeout: 30000,
}

// ============================================================================
// Example 1: Simple Person Query
// ============================================================================

async function findPeopleByAge() {
  console.log('\n=== Finding people over 18 ===\n')

  // Build the query using fluent API
  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  const result = await select(['?name', '?age'])
    .where(person)
    .filter(gte(variable('age'), 18))
    .orderBy('?age', 'DESC')
    .limit(10)
    .execute(config)

  if (result.success) {
    console.log('Results:', result.data.results.bindings)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 2: Pattern Matching with Filters
// ============================================================================

async function findPeopleByNamePattern() {
  console.log('\n=== Finding people with names starting with "John" ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:email', variable('email'))

  const nameCondition = regex(variable('name'), '^John', 'i')

  const result = await select(['?name', '?email'])
    .where(person)
    .filter(nameCondition)
    .orderBy('?name')
    .execute(config)

  if (result.success) {
    console.log('Results:', result.data.results.bindings)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 3: Multiple Conditions
// ============================================================================

async function findAdultsWithEmail() {
  console.log('\n=== Finding adults with email addresses ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))
    .and.prop('foaf:email', variable('email'))

  // Combine multiple conditions
  const conditions = and(
    gte(variable('age'), 18),
    regex(variable('email'), '@', 'i')
  )

  const result = await select(['?name', '?age', '?email'])
    .where(person)
    .filter(conditions)
    .orderBy('?name')
    .limit(20)
    .execute(config)

  if (result.success) {
    console.log('Results:', result.data.results.bindings)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Example 4: Using Domain Types
// ============================================================================

async function queryWithTypes() {
  console.log('\n=== Query with explicit typing ===\n')

  // You can specify multiple types
  const person = node('person')
    .is.a('foaf:Person')
    .and.a('schema:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  const result = await select(['?name', '?age'])
    .where(person)
    .orderBy('?name')
    .limit(10)
    .execute(config)

  if (result.success) {
    console.log('Results:', result.data.results.bindings)
  } else {
    console.error('Query failed:', result.error)
  }
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.main) {
  await findPeopleByAge()
  await findPeopleByNamePattern()
  await findAdultsWithEmail()
  await queryWithTypes()
}