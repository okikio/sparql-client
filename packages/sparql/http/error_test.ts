import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { QueryError } from './error.ts'

describe('@okikio/sparql HTTP errors', () => {
  it('preserves stable error kind, bounded details, and cause', () => {
    const cause = new Error('socket closed')
    const error = new QueryError('network', 'SPARQL request failed.', {
      status: 503,
      mediaType: 'text/plain',
      query: 'ASK {}',
      response: 'unavailable',
      cause,
    })
    expect(error.name).toBe('QueryError')
    expect(error.kind).toBe('network')
    expect(error.details.status).toBe(503)
    expect(error.cause).toBe(cause)
  })
})
