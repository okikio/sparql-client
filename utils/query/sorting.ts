// utils/query/sorting.ts
/**
 * Query sorting with multi-source support and validation
 * 
 * Features:
 * - Explicit direction: sort=field:direction,field:direction
 * - Field allowlists via registry
 * - Max sort count (DoS protection)
 * - Always adds tiebreaker for deterministic ordering
 * - Query/JSON/FormData source adapters
 */

import { z } from 'zod'

import { BaseQuerySchema, BaseJsonSchema, BaseFormSchema, ZStringOrStringArray } from '../endpoint/schemas.ts'
import {
  SortsNormalizedSchema,
  type SortNormalized,
  type SortsNormalized,
  type SortDirection,
  type SortsConfig,
} from './schemas.ts'

// ============================================================================
// WIRE SCHEMAS (raw incoming data)
// ============================================================================

/**
 * Query parameter wire schema (raw incoming)
 * Supports: ?sort=created_at:desc,id:asc
 */
export const SortsQueryWire = BaseQuerySchema.extend({
  sort: ZStringOrStringArray.optional()
})

/**
 * JSON body wire schema (raw incoming)
 * Expects: { sorts: [{ field: 'created_at', direction: 'desc' }] }
 */
export const SortsJsonWire = BaseJsonSchema.pipe(
  z.object({ sorts: SortsNormalizedSchema.default([]) })
)

/**
 * FormData wire schema (raw incoming)
 */
export const SortsFormWire = BaseFormSchema

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse colon syntax from string
 * Syntax: created_at:desc,id:asc
 */
function parseColonSyntax(data: string | undefined): SortsNormalized {
  if (typeof data !== 'string' || !data?.trim()) return []

  const sorts: SortNormalized[] = []
  const segments = data.split(',').map(s => s.trim()).filter(Boolean)

  for (const segment of segments) {
    const [fieldRaw, dirRaw] = segment.split(':')
    const field = (fieldRaw ?? '').trim()
    const direction = (dirRaw ?? 'asc').trim().toLowerCase()

    if (!field) continue;
    if (direction !== 'asc' && direction !== 'desc') continue;

    sorts.push({
      field: field,
      direction: direction as SortDirection,
      tiebreaker: false,
    })
  }

  return sorts
}

// ============================================================================
// SOURCE ADAPTERS
// ============================================================================


/**
 * Query parameter adapter (uses z.codec)
 * Supports: ?sort=created_at:desc,id:asc
 * 
 * @example
 * const adapter = createSortsQueryAdapter()
 * const normalized = adapter.decode({ sort: 'created_at:desc,id:asc' })
 * // => [{ field: 'created_at', direction: 'desc' }, { field: 'id', direction: 'asc' }]
 */
export function createSortsQueryAdapter() {
  return z.codec(
    SortsQueryWire,              // Input (wire)
    SortsNormalizedSchema,       // Output (normalized)
    {
      decode: (query) => {
        // Extract sort value (handle ZStringOrStringArray)
        const raw = Array.isArray(query.sort) ? query.sort[0] : query.sort
        return parseColonSyntax(raw)
      },
      encode: (normalized) => {
        // Reverse transform: SortsNormalized -> query string
        if (normalized.length === 0) return {} as z.infer<typeof SortsQueryWire>
        const sortString = normalized
          .map(s => `${s.field}:${s.direction}`)
          .join(',')
        return { sort: sortString } as z.infer<typeof SortsQueryWire>
      }
    }
  )
}

/**
 * JSON body adapter (uses z.codec)
 * Expects: { sorts: [{ field: 'created_at', direction: 'desc' }] }
 * 
 * @example
 * const adapter = createSortsJsonAdapter()
 * const normalized = adapter.decode({ 
 *   sorts: [{ field: 'created_at', direction: 'desc' }] 
 * })
 */
export function createSortsJsonAdapter() {
  return z.codec(
    SortsJsonWire,  // Input (wire)
    SortsNormalizedSchema,          // Output (normalized)
    {
      decode: (raw) => {
        return raw.sorts as SortsNormalized
      },
      encode: (normalized) => {
        return { sorts: normalized.map(s => Object.assign(s, { tiebreaker: false })) }
      }
    }
  )
}

/**
 * FormData adapter (uses z.codec)
 * Supports: sort=created_at:desc,id:asc
 * 
 * @example
 * const adapter = createSortsFormAdapter()
 * const formData = new FormData()
 * formData.append('sort', 'created_at:desc,id:asc')
 * const normalized = adapter.decode(formData)
 */
export function createSortsFormAdapter() {
  return z.codec(
    SortsFormWire,               // Input (wire)
    SortsNormalizedSchema,       // Output (normalized)
    {
      decode: (raw): SortsNormalized => {
        const sortValue = raw.sort
        if (!sortValue) return []
        
        const sortStr = Array.isArray(sortValue) 
          ? String(sortValue[0])
          : String(sortValue)
        
        return parseColonSyntax(sortStr)
      },
      encode: (normalized) => {
        if (normalized.length === 0) return {}
        const sortString = normalized
          .map(s => `${s.field}:${s.direction}`)
          .join(',')
        return { sort: sortString } as z.infer<typeof SortsFormWire>
      }
    }
  )
}

// ============================================================================
// SCHEMA COMPOSITION WITH VALIDATION
// ============================================================================

/**
 * Create endpoint-specific sorts schema with validation
 * All validation happens in .superRefine() so middleware handles errors
 * 
 * @param config Configuration for sorts validation
 * @param config.source Input source type ('query' | 'json' | 'form')
 * @param config.allowedFields Array of sortable field names (allowlist)
 * @param config.limits Optional limits configuration (maxSorts)
 * @param config.tiebreaker Field to use as tiebreaker (default: 'id')
 * @param config.defaultSort Default sort when none provided
 * 
 * @example
 * const schema = createSortsSchema({
 *   source: 'query',
 *   allowedFields: ['created_at', 'title', 'id'],
 *   limits: { maxSorts: 3 },
 *   tiebreaker: 'id',
 *   defaultSort: [{ field: 'created_at', direction: 'desc' }]
 * })
 * 
 * // Parse and validate
 * const sorts = schema.parse({ sort: 'created_at:desc' })
 * // => [{ field: 'created_at', direction: 'desc' }, { field: 'id', direction: 'asc' }]
 */
export function createSortsSchema(config: {
  source: 'query' | 'json' | 'form'
} & SortsConfig) {
  // When disabled, always return null
  if (config.disabled) {
    return z.null()
  }

  const adapter =
    config.source === 'query' ? createSortsQueryAdapter() :
    config.source === 'json' ? createSortsJsonAdapter() :
    createSortsFormAdapter()

  const allowSet = new Set(config.allowedFields)
  const maxSorts = config.limits?.maxSorts ?? 5
  const tiebreaker = config.tiebreaker ?? 'id'
  
  return adapter
    .transform(sorts => {
      // Use default if no sorts provided
      if (sorts.length === 0 && config.defaults) {
        return config.defaults
      }

      // Merge defaults if enabled
      if (config.mergeDefaults && config.defaults) {
        const defaultSorts = config.defaults.filter(def => !sorts.some(s => s.field === def.field))
        return [...defaultSorts, ...sorts]
      }

      return sorts
    })
    .superRefine((sorts, ctx) => {
      // Check sort count before adding tiebreaker (DoS protection)
      if (sorts.length > maxSorts) {
        ctx.addIssue({
          code: "too_big",
          maximum: maxSorts,
          origin: 'array',
          path: [],
          message: `Too many sorts: maximum ${maxSorts} allowed, got ${sorts.length}`,
        })
        return // Don't continue
      }

      // Validate allowed fields
      if (allowSet.size > 0) {
        sorts.forEach((sort, idx) => {
          if (!allowSet!.has(sort.field)) {
            ctx.addIssue({
              code: "custom",
              path: [idx, 'field'],
              message: `Field '${sort.field}' is not sortable. Allowed fields: ${config.allowedFields!.join(', ')}`,
            })
          }
        })
      }
    })
    .transform((sorts) => {
      // Always add tiebreaker if not already present
      const _sorts = sorts.map(s => Object.assign(s, { tiebreaker: s.field === tiebreaker }));
      const hasTiebreaker = _sorts.some(s => s.tiebreaker)
      if (!hasTiebreaker) {
        _sorts.push({ field: tiebreaker, direction: 'asc' as SortDirection, tiebreaker: true })
        return _sorts
      }

      return _sorts
    })
}