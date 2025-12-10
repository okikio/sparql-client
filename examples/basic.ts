/**
 * Basic Query Example - Updated for narrative.ttl ontology
 */

import {
  node,
  select,
  variable,
  type ExecutionConfig,
} from '../mod.ts'

import { RDFS } from '../namespaces.ts'

const NARRATIVE = 'http://knowledge.graph/ontology/narrative#'

const config: ExecutionConfig = {
  endpoint: 'http://localhost:9999/blazegraph/sparql',
  timeoutMs: 30000,
}

// ============================================================================
// Example 1: Find Creators (People)
// ============================================================================

async function findCreators() {
  console.log('\n=== Finding creators ===\n')

  const person = node('person', 'narrative:Person')
    .with.prop('narrative:knownAs', variable('name'))

  const query = select(['?person', '?name'])
    .prefix('narrative', NARRATIVE)
    .where(person)
    .orderBy('?name')
    .limit(10)

  console.log(query.build().value)

  try {
    const result = await query.execute(config)
    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 2: Find Publishers (Organizations)
// ============================================================================

async function findPublishers() {
  console.log('\n=== Finding publishers ===\n')

  const org = node('org', 'narrative:Org')
    .with.prop('rdfs:label', variable('name'))
    .and.prop('narrative:orgType', variable('type'))

  const query = select(['?name', '?type'])
    .prefix('narrative', NARRATIVE)
    .prefix('rdfs', RDFS._namespace)
    .where(org)
    .orderBy('?name')
    .limit(10)

  console.log(query.build().value)

  try {
    const result = await query.execute(config)
    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 3: Find Comics (StoryExpressions) with Series info
// ============================================================================

async function findComics() {
  console.log('\n=== Finding comics ===\n')

  const issue = node('issue', 'narrative:StoryExpression')
    .with.prop('narrative:issueNumber', variable('number'))
    .and.prop('narrative:coverDate', variable('date'))

  const query = select(['?issue', '?number', '?date'])
    .prefix('narrative', NARRATIVE)
    .where(issue)
    .orderBy('?date', 'DESC')
    .limit(10)

  console.log(query.build().value)

  try {
    const result = await query.execute(config)
    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Example 4: Find Characters
// ============================================================================

async function findCharacters() {
  console.log('\n=== Finding characters ===\n')

  const character = node('char', 'narrative:Character')
    .with.prop('narrative:characterName', variable('name'))

  const query = select(['?char', '?name'])
    .prefix('narrative', NARRATIVE)
    .where(character)
    .orderBy('?name')
    .limit(20)

  console.log(query.build().value)

  try {
    const result = await query.execute(config)
    console.log('Results:', result.results.bindings)
  } catch (e) {
    console.error('Query failed:', e)
  }
}

// ============================================================================
// Run examples
// ============================================================================

if (import.meta.main) {
  await findCreators()
  await findPublishers()
  await findComics()
  await findCharacters()
}