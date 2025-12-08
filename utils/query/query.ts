// utils/query/query.ts
/**
 * Composite schema factory for endpoint-specific query specs
 * 
 * CHANGES:
 * - createSingleSourceQuerySpec now respects disable flags
 * - Disabled components return null instead of creating schemas
 * - applyQuerySpec skips null components
 * 
 * Features:
 * - Source precedence (JSON > Query > Form)
 * - Conflict detection
 * - Complete QuerySpec type
 * - Declarative endpoint configuration
 * - Per-component enable/disable control
 */

import {
  EndpointQueryConfigSchema,
  type EndpointQueryConfig,
  type QuerySpec
} from './schemas.ts'

import { createPaginationSchema } from './pagination.ts'
import { createFiltersSchema } from './filtering.ts'
import { createSortsSchema } from './sorting.ts'
import { createFieldsSchema } from './fields.ts'

import { BaseFormSchema, BaseJsonSchema, BaseQuerySchema } from '../endpoint/schemas.ts'

// Re-export QuerySpec type
export { QuerySpecSchema, type QuerySpec } from './schemas.ts'

// ============================================================================
// SINGLE-SOURCE QUERY SPEC FACTORY (UPDATED)
// ============================================================================

/**
 * Build a single-source schema (query | json | form) applying business rules
 * 
 * NEW: Respects disable flags in config:
 * - disableFiltering: Always returns null for filters
 * - disableSorting: Always returns null for sorts
 * - disableFields: Always returns null for fields
 * - Pagination always enabled (required for collections)
 * 
 * @param source Input source type
 * @param configInput Endpoint configuration
 * @returns Zod schema that parses and validates complete query spec
 * 
 * @example
 * // Endpoint with fixed fields and sorting
 * const schema = createSingleSourceQuerySpec('query', {
 *   fieldRegistry: {
 *     filterable: ['status'],
 *     sortable: ['created_at', 'id'],
 *     selectable: ['id', 'title']
 *   },
 *   disableFields: true,    // Ignore field selection requests
 *   disableSorting: true,   // Ignore sort requests
 *   defaultSort: [{ field: 'created_at', direction: 'desc' }]
 * })
 * 
 * @example
 * // Read-only endpoint (no filtering)
 * const schema = createSingleSourceQuerySpec('query', {
 *   fieldRegistry: {
 *     filterable: [],
 *     sortable: ['created_at'],
 *     selectable: ['id', 'title', 'content']
 *   },
 *   disableFiltering: true
 * })
 */
export function createQuerySpec(
  source: 'query' | 'json' | 'form',
  configInput?: EndpointQueryConfig
) {
  const config = EndpointQueryConfigSchema.parse(configInput)

  console.log({
    config
  })

  // Pagination is always enabled (required for collection endpoints)
  const paginationSchema = createPaginationSchema({
    source,
    ...config.pagination
  })

  const filtersSchema = !config?.filters.disabled ? createFiltersSchema({
    source,
    ...config.filters
  }) : null

  const sortsSchema = !config?.sorts.disabled ? createSortsSchema({
    source,
    ...config.sorts
  }) : null

  const fieldsSchema = !config?.fields.disabled ? createFieldsSchema({
    source,
    ...config.fields
  }) : null

  const BaseInputSchema =
    source === 'query' ? BaseQuerySchema :
    source === 'json'  ? BaseJsonSchema :
                        BaseFormSchema

  return BaseInputSchema.transform((raw): QuerySpec => {
    // Parse each component (disabled ones return null)
    const pagination = paginationSchema.parse(raw)
    const filters    = filtersSchema ? filtersSchema.parse(raw) : null
    const sorts      = sortsSchema ? sortsSchema.parse(raw) : null
    const fields     = fieldsSchema ? fieldsSchema.parse(raw) : null

    return {
      pagination,
      filters,
      sorts,
      fields,
    }
  })
}

// ============================================================================
// HELPER FACTORY
// ============================================================================

/**
 * Simplified factory for common case (query source only)
 * 
 * Most endpoints only need to parse query parameters, so this provides
 * a convenient shorthand.
 * 
 * @param config Endpoint configuration
 * @returns Schema for query-based input
 * 
 * @example
 * // Standard endpoint with all features
 * const QuerySchema = createEndpointQuerySchema({
 *   fieldRegistry: {
 *     filterable: ['status'],
 *     sortable: ['created_at', 'id'],
 *     selectable: ['id', 'title', 'status']
 *   },
 *   tiebreaker: 'id'
 * })
 * 
 * @example
 * // Fixed-output endpoint (disable field selection)
 * const QuerySchema = createEndpointQuerySchema({
 *   fieldRegistry: {
 *     filterable: ['status'],
 *     sortable: ['created_at', 'id'],
 *     selectable: [] // Not used when disabled
 *   },
 *   disableFields: true,
 *   tiebreaker: 'id'
 * })
 */
export function createEndpointQuerySchema(config: EndpointQueryConfig) {
  return createQuerySpec('query', config)
}
