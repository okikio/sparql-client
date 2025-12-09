/**
 * Basic Query Example
 *
 * Demonstrates fundamental usage of the query builder:
 * - Creating node patterns
 * - Using fluent property chains
 * - Basic filtering and sorting
 * - Query execution
 *
 * Now wired to your namespace constants so it works cleanly with Blazegraph +
 * narrative.ttl and any FOAF/Schema data you load.
 */

import {
  node,
  select,
  variable,
  gte,
  regex,
  and,
  type ExecutionConfig,
} from '../mod.ts'

import {
  FOAF,
  SCHEMA,
} from '../namespaces.ts'

/**
 * Configure your SPARQL endpoint.
 *
 * This assumes Blazegraph with your `narrative.ttl` (and optionally FOAF/Schema)
 * is loaded into a single namespace and exposed at `/sparql`.
 */
const config: ExecutionConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeoutMs: 30000,
}

// ============================================================================
// Example 1: Simple Person Query (FOAF)
// ============================================================================

async function findPeopleByAge() {
  console.log('\n=== Finding people over 18 ===\n')

  // Build the query using fluent API
  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  try {
    const result = await select(['?name', '?age'])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .filter(gte(variable('age'), 18))
      .orderBy('?age', 'DESC')
      .limit(10)
      .execute(config)

    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 2: Pattern Matching with Filters (FOAF)
// ============================================================================

async function findPeopleByNamePattern() {
  console.log('\n=== Finding people with names starting with "John" ===\n')

  const person = node('person', 'foaf:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:email', variable('email'))

  const nameCondition = regex(variable('name'), '^John', 'i')

  try {
    const result = await select(['?name', '?email'])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .filter(nameCondition)
      .orderBy('?name')
      .execute(config)

    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 3: Multiple Conditions (FOAF)
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
    regex(variable('email'), '@', 'i'),
  )

  try {
    const result = await select(['?name', '?age', '?email'])
      .prefix('foaf', FOAF._namespace)
      .where(person)
      .filter(conditions)
      .orderBy('?name')
      .limit(20)
      .execute(config)

    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 4: Using Domain Types (FOAF + Schema.org)
// ============================================================================

async function queryWithTypes() {
  console.log('\n=== Query with explicit typing (FOAF + Schema) ===\n')

  // You can specify multiple types
  const person = node('person')
    .is.a('foaf:Person')
    .and.a('schema:Person')
    .with.prop('foaf:name', variable('name'))
    .and.prop('foaf:age', variable('age'))

  try {
    const result = await select(['?name', '?age'])
      .prefix('foaf', FOAF._namespace)
      .prefix('schema', SCHEMA._namespace)
      .where(person)
      .orderBy('?name')
      .limit(20)
      .execute(config)

    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Run examples when executed directly
// ============================================================================

if (import.meta.main) {
  await findPeopleByAge()
  await findPeopleByNamePattern()
  await findAdultsWithEmail()
  await queryWithTypes()
}
