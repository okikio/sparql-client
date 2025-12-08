#!/usr/bin/env -S deno run --allow-net

import { select, triple, createExecutor } from '../src/mod.ts'

const executor = createExecutor({
  endpoint: 'https://dbpedia.org/sparql'
})

const query = select(['?city', '?population'])
  .where(triple('?city', 'a', 'dbo:City'))
  .where(triple('?city', 'dbo:populationTotal', '?population'))
  .limit(10)
  .build()

console.log('Query:', query.value)

const result = await executor(query)

if (result.ok) {
  console.log('Results:', result.data)
} else {
  console.error('Error:', result.error)
}