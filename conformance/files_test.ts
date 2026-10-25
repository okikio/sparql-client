import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { optional } from '../.mise/tasks/files.ts'

describe('optional task filesystem operations', () => {
  it('allows absent outputs and preserves successful inspection results', async () => {
    const missing = new Deno.errors.NotFound('Absent previous output')
    expect(await optional(() => Promise.reject(missing))).toBeUndefined()
    const inspected = { isFile: true }
    expect(await optional(() => Promise.resolve(inspected))).toBe(inspected)
  })

  it('preserves permission and I/O failures instead of accepting a stale output', async () => {
    for (
      const error of [
        new Deno.errors.PermissionDenied('Cannot remove output'),
        new Deno.errors.Busy('Output is in use'),
        new Error('I/O failed'),
      ]
    ) {
      let caught: unknown
      try {
        await optional(() => Promise.reject(error))
      } catch (cause) {
        caught = cause
      }
      expect(caught).toBe(error)
    }
  })
})
