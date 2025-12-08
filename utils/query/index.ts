// utils/query/index.ts
/**
 * Public surface for query utilities.
 * - Adapters and schema factories
 * - Cursor helpers and executor
 */

export * from './schemas.ts'
export * from './filtering.ts'
export * from './sorting.ts'
export * from './fields.ts'
export * from './pagination.ts'
export * from './query.ts'

/**
 * Example (Hono-like) handler usage
 *
 * import { createEndpoindQuerySpec } from '@platform/backend/query/schemas.ts'
 * import { createValidator } from '#shared/middleware/validation.ts' // your existing middleware factory
 * 
 * import { executeListQuery } from '#shared/query/execution/supabase.ts'
 * import { paginate, gone, badRequest } from '@platform/backend/response/index.ts'
 *
 * const QueryValidator = createValidator('query', createEndpoindQuerySpec({
 *   filters: { registry: { age: { operators: ['gte', 'lte'], valueType: 'number' } } },
 *   sorts:   { allowedFields: ['created_at','title'] },
 *   fields:  { allowlist: ['*','id','title','created_at','posts.*'] },
 *   pagination: { cursorSecret: Deno.env.get('CURSOR_SECRET') ?? '' },
 * }))
 *
 * app.get('/items', QueryValidator, async (c) => {
 *   const spec = c.req.valid('query') // -> QuerySpec
 *
 *   const result = await executeListQuery(
 *     { secret: Deno.env.get('CURSOR_SECRET') ?? undefined, ttlSec: 3600 },
 *     spec,
 *     async ({ filters, sorts, fields, pagination }) => {
 *       // TODO: translate filters/sorts/fields/pagination → your DB query
 *       return { rows: [], count: 0 }
 *     }
 *   )
 *
 *   if (result.errorType === 'cursor_expired') {
 *     return c.json(...gone(c.req.path, 'Cursor expired'))
 *   }
 *   if (result.errorType === 'cursor_invalid') {
 *     return c.json(...badRequest(c.req.path, 'Invalid cursor'))
 *   }
 *
 *   // Use your existing paginate() response helper (data + meta + headers in tuple)
 *   // Example expects you to compute pagination meta (next/prev cursors) alongside rows.
 *   return c.json(...paginate(c.req.url, result.data ?? [], { count: result.count ?? 0 }))
 * })
 */
