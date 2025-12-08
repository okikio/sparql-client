// utils/query/types.ts
/**
 * Core types and schemas for query processing
 * 
 * Provides:
 * - Registry schemas for allowlists and validation
 * - Normalized intermediary schemas
 * - Zod schemas for all query features
 * - QuerySpecSchema now has nullable filters and sorts for disable functionality
 * - EndpointQueryConfig gains disableFiltering, disableSorting, disableFields flags
 */

import { z } from 'zod'
import type { ValidationErrorDetail } from '../response/schemas.ts'

// Re-export for convenience
export type { ValidationErrorDetail }

// ---------------------------------------------
// Shared primitives
// ---------------------------------------------

export const NonEmptyStringSchema = z.string().trim().min(1, 'Value cannot be empty')

// ============================================================================
// FILTER SCHEMAS
// ============================================================================

/**
 * Available filter operators
 */
export const FilterOperatorSchema = z.enum([
  'eq', 'ne',
  'gt', 'gte',
  'lt', 'lte',
  'between',  // NEW
  'in', 'nin',
  'contains', 'icontains',
  'startswith', 'endswith',
  'is_null', 'is_not_null'
])

export type FilterOperator = z.infer<typeof FilterOperatorSchema>

/**
 * Normalized filter shape (output from adapters)
 */
export const FilterNormalizedSchema = z.object({
  field: NonEmptyStringSchema,
  operator: FilterOperatorSchema,
  value: z.unknown().optional()
})

export type FilterNormalized = z.infer<typeof FilterNormalizedSchema>

/**
 * Array of normalized filters
 */
export const FiltersNormalizedSchema = z.array(FilterNormalizedSchema)

export type FiltersNormalized = z.infer<typeof FiltersNormalizedSchema>

/**
 * Normalized filter shape (output from adapters)
 */
export const BaseFilterNormalizedSchema = z.object({
  field: NonEmptyStringSchema,
  operator: FilterOperatorSchema.optional(),
  value: z.unknown().optional()
})

export type BaseFilterNormalized = z.infer<typeof BaseFilterNormalizedSchema>

/**
 * Array of normalized filters
 */
export const BaseFiltersNormalizedSchema = z.array(BaseFilterNormalizedSchema)

export type BaseFiltersNormalized = z.infer<typeof BaseFiltersNormalizedSchema>

/**
 * `OperatorDefinitionSchema`
 *
 * Describes *per-field* filtering rules:
 * - `operators`: which operators are allowed for this field (allowlist).
 * - `type`: the scalar type used for value coercion (`string|number|boolean|date|enum|uuid`).
 * - `values` (optional): enum allowlist for `type: 'enum'`.
 * - `arrayOperators` (optional): which operators for this field *expect arrays*.
 *
 * Why `arrayOperators`?
 * - Avoids hardcoding that `'in'`/`'nin'` (or future operators like `between`, `overlaps`, geo/json operators)
 *   always consume lists. Instead, each field opts into multi-value semantics explicitly, enabling
 *   field-specific policy, schema-driven validation, and accurate auto-docs/UI hints. 
 *
 * How it interacts with URLs:
 * - Bracket notation clients send comma-separated values (e.g., `filter[tag][in]=a,b,c`), which the validator
 *   converts to arrays *only if* the field’s `arrayOperators` includes that operator. JSON clients send arrays
 *   directly for `value`. Either way, normalization ends at the same `FiltersNormalized` shape. 
 */
export const OperatorDefinitionSchema = z.object({
  operators: z.array(FilterOperatorSchema).min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum', 'uuid']),
  values: z.array(z.string()).optional(), // For enum types
  arrayOperators: z.array(FilterOperatorSchema).optional() // Operators that require arrays
})

/**
 * See {@link OperatorDefinitionSchema} for full schema details.
 */
export type OperatorDefinition = z.infer<typeof OperatorDefinitionSchema>

/**
 * Filter registry for a resource
 */
export const FilterRegistrySchema = z.record(
  z.string(),
  OperatorDefinitionSchema
)

export type FilterRegistry = z.infer<typeof FilterRegistrySchema>

// ============================================================================
// SORT SCHEMAS
// ============================================================================

/**
 * Sort direction
 */
export const SortDirectionSchema = z.enum(['asc', 'desc'])

export type SortDirection = z.infer<typeof SortDirectionSchema>

/**
 * Normalized sort shape (output from adapters)
 */
export const SortNormalizedSchema = z.object({
  field: NonEmptyStringSchema,
  direction: SortDirectionSchema,
  tiebreaker: z.boolean().optional().default(false)
})

export type SortNormalized = z.infer<typeof SortNormalizedSchema>

/**
 * Array of normalized sorts
 */
export const SortsNormalizedSchema = z.array(SortNormalizedSchema)

export type SortsNormalized = z.infer<typeof SortsNormalizedSchema>

// ============================================================================
// FIELD SELECTION SCHEMAS
// ============================================================================

/**
 * Simple field selection (fields=a,b,c)
 */
export const SimpleFieldSelectionSchema = z.object({
  type: z.literal('simple'),
  fields: z.array(NonEmptyStringSchema).min(1)
})

/**
 * JSON:API field selection (fields[type]=a,b,c)
 */
export const JsonApiFieldSelectionSchema = z.object({
  type: z.literal('jsonapi'),
  fields: z.record(z.string(), z.array(NonEmptyStringSchema))
})

/**
 * Normalized field selection (output from adapters)
 */
export const FieldSelectionNormalizedSchema = z.discriminatedUnion('type', [
  SimpleFieldSelectionSchema,
  JsonApiFieldSelectionSchema
])

export type FieldSelectionNormalized = z.infer<typeof FieldSelectionNormalizedSchema>

// ============================================================================
// PAGINATION SCHEMAS
// ============================================================================

/**
 * Cursor data structure (internal representation)
 */
export const CursorDataSchema = z.object({
  sortField: NonEmptyStringSchema,
  sortValue: z.union([
    z.string(),
    z.number(),
    z.coerce.date()
  ]),
  tiebreaker: z.string(),
  tiebreakerValue: z.union([z.string(), z.number()]),
  direction: SortDirectionSchema,
  createdAt: z.coerce.date()
})

export type CursorData = z.infer<typeof CursorDataSchema>

/**
 * Offset pagination (normalized)
 */
export const OffsetPaginationNormalizedSchema = z.object({
  type: z.literal('offset'),
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
})

export type OffsetPaginationNormalized = z.infer<typeof OffsetPaginationNormalizedSchema>

/**
 * Cursor pagination (normalized)
 */
export const CursorPaginationNormalizedSchema = z.object({
  type: z.literal('cursor'),
  limit: z.number().int().positive(),
  cursor: NonEmptyStringSchema.optional(),
  decodedCursor: CursorDataSchema
})

export type CursorPaginationNormalized = z.infer<typeof CursorPaginationNormalizedSchema>

/**
 * Normalized pagination (union)
 */
export const PaginationNormalizedSchema = z.discriminatedUnion('type', [
  OffsetPaginationNormalizedSchema,
  CursorPaginationNormalizedSchema
])

export type PaginationNormalized = z.infer<typeof PaginationNormalizedSchema>

// ============================================================================
// QUERY SPEC SCHEMA
// ============================================================================

/**
 * Pagination configuration
 * 
 * All options for pagination in one place
 */
export const PaginationConfigSchema = z.object({
  limits: z.object({
    minLimit: z.number().int().positive().optional().default(1),
    maxLimit: z.number().int().positive().optional().default(100),
    defaultLimit: z.number().int().positive().optional().default(20),
    maxOffset: z.number().int().positive().optional().default(1_000_000),
    cursorTTL: z.number().int().positive().optional().default(86400), // 24 hours
  }).optional().default({
    minLimit: 1,
    maxLimit: 100,
    defaultLimit: 20,
    maxOffset: 1_000_000,
    cursorTTL: 86400
  }),
  cursorSecret: z.string().optional(),
})

export type PaginationConfig = z.infer<typeof PaginationConfigSchema>

/**
 * Filters configuration
 * 
 * All options for filtering in one place
 */
export const FiltersConfigSchema = z.object({
  registry: FilterRegistrySchema.optional(),
  defaults: FiltersNormalizedSchema.optional(),
  mergeDefaults: z.boolean().optional().default(true),
  disabled: z.boolean().optional().default(false),
  limits: z.object({
    maxFilters: z.number().int().positive().optional().default(20),
  }).optional().default({ maxFilters: 20 }),
})

export type FiltersConfig = z.input<typeof FiltersConfigSchema>

/**
 * Sorts configuration
 * 
 * All options for sorting in one place
 */
export const SortsConfigSchema = z.object({
  tiebreaker: z.string().default('id'),
  allowedFields: z.array(z.string()).optional(),
  mergeDefaults: z.boolean().optional().default(true),
  defaults: SortsNormalizedSchema.optional(),
  disabled: z.boolean().optional().default(false),
  limits: z.object({
    maxSorts: z.number().int().positive().optional().default(5),
  }).optional().default({ maxSorts: 5 }),
})

export type SortsConfig = z.input<typeof SortsConfigSchema>

/**
 * Fields configuration
 * 
 * All options for field selection in one place
 */
export const FieldsConfigSchema = z.object({
  allowedFields: z.array(z.string()).optional(),
  defaults: z.array(z.string()).optional(),
  disabled: z.boolean().default(false),
  resourceType: z.string().optional(), // For JSON:API format
}).default({ disabled: false })

export type FieldsConfig = z.input<typeof FieldsConfigSchema>

/**
 * Complete query specification (output from composite schema)
 * 
 * This is the normalized, validated output that contains all query parameters
 * ready to be applied to a database query.
 */
export const QuerySpecSchema = z.object({
  pagination: PaginationNormalizedSchema,
  filters: FiltersNormalizedSchema.nullable(),
  sorts: SortsNormalizedSchema.nullable(),
  fields: FieldSelectionNormalizedSchema.nullable(),
})

export type QuerySpec = z.infer<typeof QuerySpecSchema>

// ============================================================================
// ENDPOINT CONFIGURATION (UPDATED)
// ============================================================================

/**
 * Endpoint query configuration
 * 
 * FIXED: All component configs are optional and have sensible defaults
 * TypeScript types are clean (no | undefined noise)
 * 
 * @example
 * ```typescript
 * // Minimal config
 * const config = {
 *   tiebreaker: 'id'
 * }
 * 
 * // Full config
 * const config = {
 *   tiebreaker: 'id',
 *   pagination: {
 *     limits: { defaultLimit: 50, maxLimit: 100 },
 *     cursorSecret: CURSOR_SECRET
 *   },
 *   filters: {
 *     registry: { ...  },
 *     defaults: [ ... ],
 *     mergeDefaults: true,
 *     disabled: false,
 *     limits: { maxFilters: 10 }
 *   },
 *   sorts: {
 *     allowedFields: ['created_at', 'id'],
 *     defaults: [ ... ],
 *     disabled: false,
 *     limits: { maxSorts: 3 }
 *   },
 *   fields: {
 *     allowedFields: ['id', 'title'],
 *     defaults: ['id'],
 *     disabled: false
 *   }
 * }
 * ```
 */
export const EndpointQueryConfigSchema = z.object({
  pagination: PaginationConfigSchema,
  filters: FiltersConfigSchema,
  sorts: SortsConfigSchema,
  fields: FieldsConfigSchema,
})

export type EndpointQueryConfig = z.input<typeof EndpointQueryConfigSchema>