// utils/query/fields.ts
/**
 * Field selection (sparse fieldsets) with multi-source support
 * 
 * Features:
 * - JSON:API syntax: fields[type]=a,b,c
 * - Simple syntax: fields=a,b,c
 * - Field allowlists via registry
 * - De-duplication
 * - Wildcard handling
 * - Query/JSON/FormData source adapters
 */

import { z } from 'zod'

import { BaseQuerySchema, BaseJsonSchema, BaseFormSchema } from '../endpoint/schemas.ts'
import {
  FieldSelectionNormalizedSchema,
  type FieldsConfig,
  type FieldSelectionNormalized
} from './schemas.ts'

// ============================================================================
// WIRE SCHEMAS (raw incoming data)
// ============================================================================

/**
 * Query parameter wire schema (raw incoming)
 * Supports both:
 * - Simple: ?fields=a,b,c
 * - JSON:API: ?fields[products]=a,b,c&fields[categories]=x,y
 */
export const FieldsQueryWire = BaseQuerySchema

/**
 * JSON body wire schema (raw incoming)
 * Expects: { fields: { type: 'simple', fields: ['a', 'b'] } }
 */
export const FieldsJsonWire = BaseJsonSchema.pipe(
  z.object({
    fields: FieldSelectionNormalizedSchema.nullable().default(null)
  })
)

/**
 * FormData wire schema (raw incoming)
 */
export const FieldsFormWire = BaseFormSchema

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract string value from ZStringOrStringArray
 */
const getString = (val: unknown): string | undefined => {
  if (Array.isArray(val)) return val[0]
  if (typeof val === 'string') return val
  return undefined
}

/**
 * Detect JSON:API vs simple syntax from query/form data
 * 
 * Detection priority:
 * 1. Check for JSON:API syntax: fields[type]=...
 * 2. Fall back to simple syntax: fields=...
 * 3. Return null if neither found
 * 
 * @param data Raw query or form data
 * @returns Normalized field selection or null
 * 
 * @example
 * // JSON:API syntax
 * detectFieldSyntax({ 'fields[products]': 'id,name', 'fields[categories]': 'name' })
 * // => { type: 'jsonapi', fields: { products: ['id', 'name'], categories: ['name'] } }
 * 
 * // Simple syntax
 * detectFieldSyntax({ fields: 'id,name,price' })
 * // => { type: 'simple', fields: ['id', 'name', 'price'] }
 * 
 * // No field selection
 * detectFieldSyntax({ page: '1' })
 * // => null
 */
function detectFieldSyntax(data: Record<string, unknown>): FieldSelectionNormalized | null {
  // Check for JSON:API syntax: fields[type]=...
  const jsonApiFields: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(data)) {
    const match = key.match(/^fields\[([^\]]+)\]$/)
    if (match) {
      const type = match[1]
      
      // Extract value (handle arrays from ZStringOrStringArray)
      const stringValue = String(getString(value) ?? '')
      const fields = stringValue
        .split(',')
        .map(f => f.trim())
        .filter(f => f)

      if (fields.length > 0) {
        jsonApiFields[type] = fields
      }
    }
  }

  if (Object.keys(jsonApiFields).length > 0) {
    return { type: 'jsonapi', fields: jsonApiFields }
  }

  // Fall back to simple syntax: fields=...
  const fieldsValue = data.fields
  if (fieldsValue) {
    // Extract value (handle arrays from ZStringOrStringArray)
    const stringValue = String(getString(fieldsValue) ?? '')
    const fields = stringValue
      .split(',')
      .map(f => f.trim())
      .filter(f => f)

    if (fields.length > 0) {
      return { type: 'simple', fields }
    }
  }

  return null
}

/**
 * Encode field selection back to wire format
 * Used for round-trip serialization
 * 
 * @param selection Normalized field selection
 * @returns Wire format object
 * 
 * @example
 * encodeFieldSelection({ type: 'simple', fields: ['id', 'name'] })
 * // => { fields: 'id,name' }
 * 
 * encodeFieldSelection({ 
 *   type: 'jsonapi', 
 *   fields: { products: ['id', 'name'], categories: ['name'] } 
 * })
 * // => { 'fields[products]': 'id,name', 'fields[categories]': 'name' }
 */
function encodeFieldSelection(selection: FieldSelectionNormalized | null): Record<string, string> {
  if (!selection) return {}

  if (selection.type === 'simple') {
    return { fields: selection.fields.join(',') }
  }

  // JSON:API format
  const result: Record<string, string> = {}
  for (const [type, fields] of Object.entries(selection.fields)) {
    result[`fields[${type}]`] = fields.join(',')
  }
  return result
}

// ============================================================================
// SOURCE ADAPTERS
// ============================================================================

/**
 * Query parameter adapter (uses z.codec)
 * Supports: ?fields=a,b,c or ?fields[products]=a,b,c
 * 
 * @example
 * const adapter = createFieldsQueryAdapter()
 * 
 * // Simple syntax
 * const simple = adapter.decode({ fields: 'id,name,price' })
 * // => { type: 'simple', fields: ['id', 'name', 'price'] }
 * 
 * // JSON:API syntax
 * const jsonapi = adapter.decode({ 
 *   'fields[products]': 'id,name', 
 *   'fields[categories]': 'name' 
 * })
 * // => { type: 'jsonapi', fields: { products: ['id', 'name'], categories: ['name'] } }
 */
export function createFieldsQueryAdapter() {
  return z.codec(
    FieldsQueryWire,                              // Input (wire)
    FieldSelectionNormalizedSchema.nullable(),    // Output (normalized)
    {
      decode: (raw) => {
        return detectFieldSyntax(raw)
      },
      encode: (normalized) => {
        return encodeFieldSelection(normalized)
      }
    }
  )
}

/**
 * JSON body adapter (uses z.codec)
 * Expects: { fields: { type: 'simple', fields: ['a', 'b'] } }
 * 
 * @example
 * const adapter = createFieldsJsonAdapter()
 * const normalized = adapter.decode({ 
 *   fields: { type: 'simple', fields: ['id', 'name'] } 
 * })
 * // => { type: 'simple', fields: ['id', 'name'] }
 */
export function createFieldsJsonAdapter() {
  return z.codec(
    FieldsJsonWire,               // Input (wire)
    FieldSelectionNormalizedSchema.nullable(),    // Output (normalized)
    {
      decode: (raw) => {
        return raw.fields as FieldSelectionNormalized | null
      },
      encode: (normalized) => {
        return { fields: normalized }
      }
    }
  )
}

/**
 * FormData adapter (uses z.codec)
 * Supports: fields=a,b,c or fields[products]=a,b,c
 * 
 * @example
 * const adapter = createFieldsFormAdapter()
 * const formData = new FormData()
 * formData.append('fields', 'id,name,price')
 * const normalized = adapter.decode(formData)
 * // => { type: 'simple', fields: ['id', 'name', 'price'] }
 */
export function createFieldsFormAdapter() {
  return z.codec(
    FieldsFormWire,                               // Input (wire)
    FieldSelectionNormalizedSchema.nullable(),    // Output (normalized)
    {
      decode: (raw): FieldSelectionNormalized | null => {
        // Convert FormValue to plain record for detectFieldSyntax
        const plainObj: Record<string, string> = {}
        
        for (const [key, value] of Object.entries(raw)) {
          plainObj[key] = String(getString(value) ?? '')
        }
        
        return detectFieldSyntax(plainObj)
      },
      encode: (normalized) => {
        return encodeFieldSelection(normalized)
      }
    }
  )
}

// ============================================================================
// SCHEMA COMPOSITION WITH VALIDATION
// ============================================================================

/**
 * Create endpoint-specific fields schema with validation
 * All validation happens in .superRefine() so middleware handles errors
 * 
 * @param config Configuration for field selection validation
 * @param config.source Input source type ('query' | 'json' | 'form')
 * @param config.allowedFields Array of selectable field names (allowlist)
 * @param config.resourceType Resource type for JSON:API validation
 * @param config.defaultFields Default fields when none provided
 * 
 * @example
 * const schema = createFieldsSchema({
 *   source: 'query',
 *   allowedFields: ['id', 'name', 'price', 'created_at'],
 *   defaultFields: ['id', 'name']
 * })
 * 
 * // Parse and validate
 * const fields = schema.parse({ fields: 'id,name,price' })
 * // => { type: 'simple', fields: ['id', 'name', 'price'] }
 * 
 * // With wildcard
 * const allFields = schema.parse({ fields: '*' })
 * // => { type: 'simple', fields: ['id', 'name', 'price', 'created_at'] }
 * 
 * // Invalid field rejected
 * schema.parse({ fields: 'id,invalid_field' })
 * // => Throws validation error
 */
export function createFieldsSchema(config: {
  source: 'query' | 'json' | 'form'
} & FieldsConfig) {
  // When disabled, always return null
  if (config.disabled) {
    return z.null()
  }

  const adapter =
    config.source === 'query' ? createFieldsQueryAdapter() :
    config.source === 'json' ? createFieldsJsonAdapter() :
    createFieldsFormAdapter()

  return adapter
    .transform((selection): FieldSelectionNormalized | null => {
      // Apply defaults when no selection provided
      if (!selection && config.defaults && config.defaults.length > 0) {
        return {
          type: 'simple',
          fields: [...config.defaults] // Copy to avoid mutation
        }
      }
      return selection
    })
    .superRefine((selection, ctx) => {
      // No selection - use default or allow null
      if (!selection) { return; }

      // Get fields to validate based on selection type
      const fieldsToValidate = 
        selection.type === 'simple'
          ? selection.fields
          : config.resourceType
            ? selection.fields[config.resourceType] ?? []
            : Object.values(selection.fields).flat()

      // De-duplicate fields
      const uniqueFields = Array.from(new Set(fieldsToValidate))

      // Handle wildcard
      const hasWildcard = uniqueFields.includes('*')
      if (hasWildcard) {
        // Wildcard with no restrictions
        if (!config.allowedFields) return
        
        // Replace wildcard with all allowed fields
        if (selection.type === 'simple') {
          selection.fields = [...config.allowedFields]
        } else if (config.resourceType) {
          selection.fields[config.resourceType] = [...config.allowedFields]
        }
        
        return
      }

      // Validate against allowlist
      if (config.allowedFields && config.allowedFields.length > 0) {
        const invalidFields = uniqueFields.filter(f => !config.allowedFields!.includes(f))
        
        if (invalidFields.length > 0) {
          ctx.addIssue({
            code: "custom",
            path: selection.type === 'simple' ? ['fields'] : ['fields', config.resourceType ?? '*'],
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed fields: ${config.allowedFields.join(', ')}`
          })
          return
        }
      }

      // De-duplicate fields in the selection
      if (selection.type === 'simple') {
        selection.fields = uniqueFields
      } else {
        // For JSON:API, de-duplicate each resource type
        for (const [type, fields] of Object.entries(selection.fields)) {
          selection.fields[type] = Array.from(new Set(fields))
        }
      }
    })
}