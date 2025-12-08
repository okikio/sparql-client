// utils/query/filtering.ts

/**
 * Query Filtering — URL shapes, parsing, validation, and why `arrayOperators` exist.
 *
 * ## The two client-facing representations
 *
 * 1) **Bracket notation (URL-friendly; recommended for GET)**
 *    Structure: `filter[<field>][<operator>]=<value>`
 *
 *    - Operator is optional; missing operator implies `eq`.
 *      Example:
 *      `/api/posts?filter[status]=published`
 *      → `status eq 'published'` (operator defaults to `eq`). 
 *
 *    - Multiple filters AND together:
 *      `/api/products?filter[category]=electronics&filter[price][gte]=50&filter[price][lte]=200`
 *      → `category = 'electronics' AND price >= 50 AND price <= 200`.
 *
 *    - Null checks use keywords (not booleans):
 *      `/api/posts?filter[deleted_at]=null`     → `IS NULL`
 *      `/api/posts?filter[published_at]=not_null` → `IS NOT NULL`. 
 *
 *    - Set operators use comma-separated lists in the URL:
 *      `/api/issues?filter[status][in]=open,in_review,blocked`
 *      `/api/issues?filter[status][nin]=wontfix,duplicate`. 
 *
 *    Parsing flow:
 *    - `parseBracketNotation(...)` walks query keys with `/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/`,
 *      extracts `{ field, operator? }`, defaults operator to `eq`, and turns `null` / `not_null`
 *      into `is_null` / `is_not_null`. The rest pass through as `{ field, operator, value }`.
 *      This produces a `FiltersNormalized[]` array for downstream validation. 
 *
 * 2) **Structured JSON filters (body POST/PUT), or URL-encoded JSON as a single param**
 *    Shape:
 *    ```json
 *    { "filters": [
 *        { "field": "category", "operator": "eq", "value": "electronics" },
 *        { "field": "price",    "operator": "gte","value": "50" }
 *      ] }
 *    ```
 *    - Use `createFiltersJsonAdapter()` to parse the request body into `FiltersNormalized`.
 *      If you must keep GET-only, you *may* URL-encode the JSON into a single `filters` param
 *      and parse it prior to validation, then feed this same adapter. 
 *
 * ## Where `arrayOperators` matter
 *
 * - Instead of hardcoding that `'in'`/`'nin'` always expect arrays, each field’s registry entry
 *   can *declare* which operators consume arrays via `arrayOperators`. This allows per-field policy
 *   (e.g., `status` allows `in`; `title` does not), and future operators like `between`, `overlaps`,
 *   or geo/json containment to be opt-in for the fields that support them. 
 *
 * - In bracket notation, clients still send comma-separated lists; validation reads the registry
 *   to decide whether to split/coerce into arrays. In JSON, clients send actual arrays for `value`.
 *   Either way, we normalize to the *same* `FiltersNormalized` shape. 
 *
 * ## Validation layer (what this module enforces)
 *
 * - **Allowlist fields & operators per resource**: We require a `FilterRegistry` describing
 *   what’s filterable and with which operators, including the expected scalar type (string/number/
 *   boolean/date/enum/uuid) and allowed enum values. 
 *
 * - **Type-aware coercion**: The validator converts values based on the field type and operator:
 *   - numbers for `gt/gte/lt/lte/eq/ne` (rejects NaN),
 *   - booleans for `eq/ne`,
 *   - dates to ISO strings for `gt/gte/lt/lte/eq/ne` (rejects invalid dates),
 *   - enum membership checks,
 *   - UUID format checks, etc. 
 *
 * - **Null operators** never require a `value` (`is_null`, `is_not_null`). 
 *
 * - **Array operators** (as declared per field) require arrays; URL commas split into arrays.
 *   (We also recommend adding per-endpoint caps on list lengths via `LimitsConfig` to avoid abuse.) 
 *
 * - **DoS protection**: We cap the **number of filters** per request (default 20; configurable)
 *   and fail fast if exceeded. 
 *
 * ## Security & performance notes
 *
 * - **Security**: Always allowlist fields/operators and type-check values before building queries.
 *   Don’t ever string-concatenate SQL; use parameterized calls. 
 *
 * - **Performance**: Index columns you filter/sort on; prefer compound indexes that align to
 *   common filter+sort patterns. This is especially important for high-cardinality fields and
 *   for cursor-based pagination where tiebreakers (e.g., `created_at,id`) must be indexed. 
 *
 * ## Worked examples (URL)
 *
 * - Equality (implicit operator):
 *   `/api/posts?filter[status]=published` → `{ field:'status', operator:'eq', value:'published' }` 
 *
 * - Ranged price:
 *   `/api/products?filter[price][gte]=50&filter[price][lte]=200` → two normalized filters; numbers coerced. 
 *
 * - Null checks:
 *   `/api/posts?filter[deleted_at]=null&filter[published_at]=not_null` → `is_null` / `is_not_null` (no values).
 *
 * - Set membership (array operator via registry):
 *   `/api/issues?filter[status][in]=open,in_review,blocked`
 *   → value coerced to `['open','in_review','blocked']` when `status` declares `in` under `arrayOperators`. 
 *
 * ## Worked examples (JSON)
 *
 * ```json
 * { 
 *   "filters": [
 *     { "field": "category", "operator": "eq", "value": "electronics" },
 *     { "field": "price", "operator": "gte", "value": "50" },
 *     { "field": "status", "operator": "in", "value": ["open","in_review","blocked"] }
 *   ]
 * }
 * ```
 * - Parsed via `createFiltersJsonAdapter()` into the same `FiltersNormalized[]`; array handling
 *   and type coercion follow the registry+validation rules above. 
 *
 * ---
 * 
 * Implementation notes:
 * - The adapters (`createFiltersQueryAdapter`, `createFiltersJsonAdapter`, `createFiltersFormAdapter`)
 *   only handle source parsing: they normalize different input formats (query strings, JSON bodies, form data)
 *   into a consistent internal shape.
 *
 * - The actual business rules live in `createFiltersSchema(...).superRefine(...)`:
 *   • Enforce allowlists (only certain fields/operators allowed)
 *   • Match operators to correct value types
 *   • Split arrays consistently (e.g. "a,b,c" → ["a","b","c"])
 *   • Apply caps/limits (e.g. max filters)
 *
 * - This separation keeps parsing concerns **independent from** validation rules,
 *   making the system easier to extend and reason about. 
 */

import { z } from 'zod'

import { BaseQuerySchema, BaseJsonSchema, BaseFormSchema } from '../endpoint/schemas.ts'
import {
  FiltersNormalizedSchema,
  type FilterNormalized,
  type FiltersNormalized,
  type FilterOperator,
  type FilterRegistry,
  type FiltersConfig,
} from './schemas.ts'

// ============================================================================
// WIRE SCHEMAS (raw incoming data)
// ============================================================================

/**
 * Query parameter wire schema (raw incoming)
 * Supports: ?filter[category][eq]=electronics&filter[price][gte]=50
 */
export const FiltersQueryWire = BaseQuerySchema

/**
 * JSON body wire schema (raw incoming)
 * Expects: { filters: [{ field: 'category', operator: 'eq', value: 'electronics' }] }
 */
export const FiltersJsonWire = BaseJsonSchema.pipe(
  z.object({
    filters: FiltersNormalizedSchema.default([])
  })
)

/**
 * FormData wire schema (raw incoming)
 */
export const FiltersFormWire = BaseFormSchema

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse bracket notation from query parameters or form data
 * Syntax: filter[field][operator]=value
 * 
 * @param data Raw query or form data
 * @returns Array of normalized filters
 * 
 * @example
 * parseBracketNotation({ 
 *   'filter[status]': 'published',
 *   'filter[price][gte]': '50' 
 * })
 * // => [
 * //   { field: 'status', operator: 'eq', value: 'published' },
 * //   { field: 'price', operator: 'gte', value: '50' }
 * // ]
 */
function parseBracketNotation(data: Record<string, unknown>): FiltersNormalized {
  const filters: FilterNormalized[] = []

  for (const [key, rawValue] of Object.entries(data)) {
    const match = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/)
    if (!match) continue

    const field = match[1]
    const operator = (match[2] || 'eq') as FilterOperator
    
    // Extract value (handle arrays from ZStringOrStringArray)
    let value: string
    if (Array.isArray(rawValue)) {
      value = String(rawValue[0] ?? '')
    } else {
      value = String(rawValue ?? '')
    }

    // Handle null keywords
    if (value === 'null') {
      filters.push({ field, operator: 'is_null' })
    } else if (value === 'not_null') {
      filters.push({ field, operator: 'is_not_null' })
    } else {
      filters.push({ field, operator, value })
    }
  }

  return filters
}

/**
 * Encode filters back to bracket notation
 * 
 * @param filters Normalized filters array
 * @returns Wire format object
 * 
 * @example
 * encodeBracketNotation([
 *   { field: 'status', operator: 'eq', value: 'published' },
 *   { field: 'price', operator: 'gte', value: 50 }
 * ])
 * // => {
 * //   'filter[status]': 'published',
 * //   'filter[price][gte]': '50'
 * // }
 */
function encodeBracketNotation(filters: FiltersNormalized): Record<string, string> {
  const result: Record<string, string> = {}

  for (const filter of filters) {
    // Handle null operators (no value)
    if (filter.operator === 'is_null') {
      result[`filter[${filter.field}]`] = 'null'
      continue
    }

    if (filter.operator === 'is_not_null') {
      result[`filter[${filter.field}]`] = 'not_null'
      continue
    }

    // Handle value-based operators
    const value = filter.value
    const stringValue = Array.isArray(value) 
      ? value.join(',') 
      : String(value ?? '')

    // Use bracket notation for non-eq operators
    const key = filter.operator === 'eq'
      ? `filter[${filter.field}]`
      : `filter[${filter.field}][${filter.operator}]`

    result[key] = stringValue
  }

  return result
}

// ============================================================================
// SOURCE ADAPTERS
// ============================================================================

/**
 * Query parameter adapter (uses z.codec)
 * Supports: ?filter[category][eq]=electronics&filter[price][gte]=50
 * 
 * @example
 * const adapter = createFiltersQueryAdapter()
 * const normalized = adapter.decode({ 
 *   'filter[status]': 'published',
 *   'filter[price][gte]': '50'
 * })
 * // => [
 * //   { field: 'status', operator: 'eq', value: 'published' },
 * //   { field: 'price', operator: 'gte', value: '50' }
 * // ]
 */
export function createFiltersQueryAdapter() {
  return z.codec(
    FiltersQueryWire,            // Input (wire)
    FiltersNormalizedSchema,     // Output (normalized)
    {
      decode: (raw) => {
        return parseBracketNotation(raw)
      },
      encode: (normalized) => {
        return encodeBracketNotation(normalized)
      }
    }
  )
}

/**
 * JSON body adapter (uses z.codec)
 * Expects: { filters: [{ field: 'category', operator: 'eq', value: 'electronics' }] }
 * 
 * @example
 * const adapter = createFiltersJsonAdapter()
 * const normalized = adapter.decode({ 
 *   filters: [{ field: 'category', operator: 'eq', value: 'electronics' }] 
 * })
 */
export function createFiltersJsonAdapter() {
  return z.codec(
    FiltersJsonWire,          // Input (wire)
    FiltersNormalizedSchema,  // Output (normalized)
    {
      decode: (raw) => {
        return raw.filters as FiltersNormalized
      },
      encode: (normalized) => {
        return { filters: normalized }
      }
    }
  )
}

/**
 * FormData adapter (uses z.codec)
 * Supports same bracket notation as query adapter
 * 
 * @example
 * const adapter = createFiltersFormAdapter()
 * const formData = new FormData()
 * formData.append('filter[status]', 'published')
 * const normalized = adapter.decode(formData)
 */
export function createFiltersFormAdapter() {
  return z.codec(
    FiltersFormWire,             // Input (wire)
    FiltersNormalizedSchema,     // Output (normalized)
    {
      decode: (raw): FiltersNormalized => {
        // Convert FormValue to plain record for parseBracketNotation
        return parseBracketNotation(raw)
      },
      encode: (normalized) => {
        return encodeBracketNotation(normalized)
      }
    }
  )
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate and coerce operator value based on field type
 * Mutates the filter object with coerced value
 * 
 * @param filter Filter to validate and coerce
 * @param fieldDef Field definition from registry
 * @param ctx Zod refinement context for error reporting
 * @param path Path for error reporting
 */
function validateAndCoerceOperatorValue(
  filter: FilterNormalized,
  fieldDef: FilterRegistry[string],
  ctx: z.RefinementCtx,
  path: (string | number)[]
) {
  const { operator, value, field } = filter

  // Null operators don't need values
  if (operator === 'is_null' || operator === 'is_not_null') {
    return
  }

  // Between operator needs exactly 2 values
  if (operator === 'between') {
    let arrayValue: unknown[]
    if (Array.isArray(value)) {
      arrayValue = value
    } else if (typeof value === 'string') {
      arrayValue = value.split(',').map(v => v.trim()).filter(Boolean)
    } else {
      arrayValue = [value]
    }

    if (arrayValue.length !== 2) {
      ctx.addIssue({
        code: 'custom',
        input: ctx.value,
        path: [...path, 'value'],
        message: `Operator 'between' on field '${field}' requires exactly 2 values (min,max). Got ${arrayValue.length}.`
      })
      return
    }

    // Coerce based on field type
    if (fieldDef.type === 'number') {
      const [min, max] = arrayValue.map(Number)
      if (isNaN(min) || isNaN(max)) {
        ctx.addIssue({
          code: 'custom',
          input: ctx.value,
          path: [...path, 'value'],
          message: `Field '${field}' requires numeric values for 'between' operator`
        })
        return
      }

      if (min > max) {
        ctx.addIssue({
          code: 'custom',
          input: ctx.value,
          path: [...path, 'value'],
          message: `Field '${field}' 'between' operator requires min <= max. Got min=${min}, max=${max}.`
        })
        return
      }
      filter.value = [min, max]
    } else if (fieldDef.type === 'date') {
      const [minDate, maxDate] = arrayValue.map(v => new Date(String(v)))
      if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) {
        ctx.addIssue({
          code: 'custom',
          input: ctx.value,
          path: [...path, 'value'],
          message: `Field '${field}' requires valid dates for 'between' operator`
        })
        return
      }

      if (minDate > maxDate) {
        ctx.addIssue({
          code: 'custom',
          input: ctx.value,
          path: [...path, 'value'],
          message: `Field '${field}' 'between' operator requires start date <= end date.`
        })
        return
      }

      filter.value = [minDate.toISOString(), maxDate.toISOString()]
    } else {
      ctx.addIssue({
        code: 'custom',
        input: ctx.value,
        path: [...path, 'operator'],
        message: `Operator 'between' not supported for field type '${fieldDef.type}' on field '${field}'`
      })
    }
    return
  }

  // Array operators need special handling
  const isArrayOperator = fieldDef.arrayOperators?.includes(operator) ?? false  
  if (isArrayOperator) {
    // Ensure value is an array
    let arrayValue: unknown[]
    if (Array.isArray(value)) {
      arrayValue = value
    } else if (typeof value === 'string') {
      arrayValue = value.split(',').map(v => v.trim()).filter(Boolean)
    } else {
      arrayValue = [value]
    }

    if (arrayValue.length === 0) {
      ctx.addIssue({
        code: 'too_small',             // v4 literal (not the enum)
        minimum: 1,
        origin: 'array',
        path: [...path, 'value'],
        message: `Operator '${operator}' on field '${field}' requires an array or comma-separated value with at least 1 value.`
      });
      return; // stop further processing for this filter
    }

    filter.value = arrayValue
    return
  }

  // Non-array operators - coerce based on field type
  switch (fieldDef.type) {
    case 'number':
      if (['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].includes(operator)) {
        const numValue = Number(value)
        if (isNaN(numValue)) {
          ctx.addIssue({
            code: "custom",
            input: ctx.value,
            path: [...path, 'value'],
            message: `Field '${field}' requires numeric value for operator '${operator}'`
          })
          return
        }

        filter.value = numValue
      }
      break

    case 'boolean':
      if (operator === 'eq' || operator === 'ne') {
        const boolValue = value === 'true' || value === '1' || value === 1
        filter.value = boolValue
      }
      break

    case 'date':
      if (['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].includes(operator)) {
        const dateValue = new Date(String(value))
        if (isNaN(dateValue.getTime())) {
          ctx.addIssue({
            code: "custom",
            input: ctx.value,
            path: [...path, 'value'],
            message: `Field '${field}' requires valid date for operator '${operator}'`
          })
          return
        }

        filter.value = dateValue.toISOString()
      }
      break

    case 'enum':
      if (operator === 'eq' || operator === 'ne') {
        const strValue = String(value)
        if (fieldDef.values && !fieldDef.values.includes(strValue)) {
          ctx.addIssue({
            code: "custom",
            input: ctx.value,
            path: [...path, 'value'],
            message: `Invalid value '${strValue}' for enum field '${field}'. Allowed values: ${fieldDef.values.join(', ')}`
          })

          return
        }
      }
      break

    case 'uuid':
      if (operator === 'eq' || operator === 'ne') {
        const uuidCheck = z.uuid().safeParse(String(value))
        if (!uuidCheck.success) {
          const uuidIssue = uuidCheck.error.issues[0];
          ctx.addIssue({
            ...uuidIssue,
            path: [...path, 'value'],
            message: `Field '${field}' requires valid UUID for operator '${operator}'. ${uuidIssue.message}`
          })
          return
        }
      }
      break

    case 'string':
      // String operators accept any value, coerce to string
      filter.value = String(value)
      break
  }
}

// ============================================================================
// SCHEMA COMPOSITION WITH VALIDATION
// ============================================================================

/**
 * Create endpoint-specific filters schema with validation
 * All validation happens in .superRefine() so middleware handles errors
 * 
 * @param config Configuration for filter validation
 * @param config.source Input source type ('query' | 'json' | 'form')
 * @param config.registry Filter registry with field definitions
 * @param config.limits Optional limits configuration (maxFilters)
 * 
 * @example
 * const schema = createFiltersSchema({
 *   source: 'query',
 *   registry: {
 *     price: {
 *       operators: ['gte', 'lte'],
 *       type: 'number'
 *     },
 *     status: {
 *       operators: ['eq', 'in'],
 *       type: 'enum',
 *       values: ['draft', 'published'],
 *       arrayOperators: ['in']
 *     }
 *   },
 *   limits: { maxFilters: 10 }
 * })
 * 
 * // Parse and validate
 * const filters = schema.parse({ 
 *   'filter[price][gte]': '50',
 *   'filter[status][in]': 'draft,published'
 * })
 */
export function createFiltersSchema(config: {
  source: 'query' | 'json' | 'form'
} & FiltersConfig) {
  // When disabled, always return null
  if (config.disabled) {
    return z.null()
  }

  // Select appropriate adapter based on source
  const adapter =
    config.source === 'query' ? createFiltersQueryAdapter() :
    config.source === 'json' ? createFiltersJsonAdapter() :
    createFiltersFormAdapter()
  
  const maxFilters = config.limits?.maxFilters ?? 20
  const mergeDefaults = config.mergeDefaults ?? true

  const registry = config.registry ?? {}
  const allowedFields = Object.keys(registry)

  return adapter
    .transform((filters): FiltersNormalized => {
      // Apply default filters
      if (config.defaults && config.defaults.length > 0) {
        if (filters.length === 0) {
          // No user filters - use defaults
          return [...config.defaults]
        } else if (mergeDefaults) {
          // Merge defaults with user filters
          // Defaults come first (applied before user filters)
          return [...config.defaults, ...filters]
        }
      }
      
      return filters
    })
    .superRefine((filters, ctx) => {
      // Check filter count (DoS protection)
      if (filters.length > maxFilters) {
        ctx.addIssue({
          code: "too_big",
          maximum: maxFilters,
          origin: 'array',
          path: [],
          message: `Too many filters: maximum ${maxFilters} allowed, got ${filters.length}`
        })
        return // Don't continue validating individual filters
      }

      // No registry = skip field/operator validation
      if (!config.registry) {
        return
      }

      // Validate each filter
      filters.forEach((filter, idx) => {
        const { field, operator = 'eq', value } = filter

        // Check if field is filterable
        const fieldDef = registry[field]
        if (!fieldDef && allowedFields.length > 0) {
          ctx.addIssue({
            code: "custom",
            input: ctx.value,
            path: [idx, 'field'],
            message: `Field '${field}' is not filterable. Allowed fields: ${allowedFields.join(', ')}`
          })
          return // Skip further validation for this filter
        }

        // If field is in registry, validate operator
        if (fieldDef) {
          if (!fieldDef.operators.includes(operator)) {
            ctx.addIssue({
              code: "custom",
              input: ctx.value,
              path: [idx, 'operator'],
              message: `Operator '${operator}' not allowed for field '${field}'. Allowed operators: ${fieldDef.operators.join(', ')}`
            })
            return
          }

          // Validate operator-value type compatibility and coerce
          validateAndCoerceOperatorValue(filter, fieldDef, ctx, [idx])
        }
      })
  })
}