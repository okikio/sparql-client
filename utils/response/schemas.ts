// utils/response/schemas.ts
/**
 * Response types and schemas following RFC 7807 (Problem Details) and success envelopes
 * 
 * Architecture:
 * - Everything is a Zod schema first
 * - Types are inferred from schemas via z.infer
 * - Factory functions create generic schemas (like in fields.ts, filtering.ts)
 * - Follows same pattern as query processing utilities
 * - Aligns with Hono's ContentfulStatusCode and ContentlessStatusCode types
 */

import type { ContentfulStatusCode, ContentlessStatusCode } from 'hono/utils/http-status'
import type { RequestHeader } from 'hono/utils/headers'

import { ContentfulStatusCodeSchema } from './status-codes.ts'
import { QuerySpecSchema } from '../query/schemas.ts'
import { z } from 'zod'

// ============================================================================
// BASE COMPONENT SCHEMAS
// ============================================================================

/**
 * Validation error detail schema
 * Individual field-level or rule-level validation error
 */
export const ValidationErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string()
})

export type ValidationErrorDetail = z.infer<typeof ValidationErrorDetailSchema>

/**
 * RFC 7807 Problem Details base schema
 */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: ContentfulStatusCodeSchema,
  detail: z.string(),
  instance: z.string(),
  timestamp: z.coerce.date(),
  docs: z.url().optional()
})

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>

/**
 * RFC 7807 Problem Details with validation errors array
 */
export const ProblemDetailsWithErrorsSchema = ProblemDetailsSchema.extend({
  errors: z.array(ValidationErrorDetailSchema)
})

export type ProblemDetailsWithErrors = z.infer<typeof ProblemDetailsWithErrorsSchema>

/**
 * Metadata describing the pagination state of a result set.
 *
 * This interface is designed to support both cursor-based and offset-based
 * pagination strategies. It captures the current slice of data and provides
 * hints for navigating forward/backward.
 * 
 * Supports cursor-based and offset-based pagination, plus
 * optional approximate totals and expiry timestamps.
 */
export const PaginationSchema = z.object({
  hasMore: z.boolean(),
  limit: z.number().int().positive(),
  count: z.number().int().min(0),
  nextCursor: z.string().optional(),
  prevCursor: z.string().optional(),
  offset: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
  approxTotal: z.number().int().min(0).optional(),
  expiresAt: z.coerce.date().optional()
})

export type Pagination = z.infer<typeof PaginationSchema>

/**
 * Base metadata schema - accepts arbitrary additional fields
 */
export const DataMetadataSchema = z.object().catchall(z.unknown())

export type DataMetadata = z.infer<typeof DataMetadataSchema>

/**
 * LinkMap
 *
 * Normalized representation of RFC 8288-style links for a single response.
 *
 * - Keys are **link relation types** (`rel`): "self", "next", "prev", "first", "last", etc.
 * - Values are URI references (often relative paths like `/articles?page=2`).
 * - `self` is **required** and must be non-empty.
 * - Standard pagination rels (`first`, `last`, `next`, `prev`) are optional.
 * - Any additional rel (e.g. "describedby", "up", custom rels) is allowed via catchall.
 *
 * @example
 * const links = LinkMapSchema.parse({
 *   self: "/articles?offset=40&limit=20",
 *   first: "/articles?offset=0&limit=20",
 *   prev: "/articles?offset=20&limit=20",
 *   next: "/articles?offset=60&limit=20",
 *   last: "/articles?offset=120&limit=20",
 * })
 *
 * @example
 * // With custom rels
 * const links = LinkMapSchema.parse({
 *   self: "/articles?offset=0&limit=20",
 *   describedby: "https://api.example.com/schemas/articles",
 *   profile: "https://api.example.com/profiles/pagination",
 * })
 */
export const LinkMapSchema = z
  .object({
    self: z.string().min(1, "self link must be a non-empty URI reference"),

    // Common pagination link relations (all optional)
    first: z.string().min(1).optional(),
    last: z.string().min(1).optional(),
    next: z.string().min(1).optional(),
    prev: z.string().min(1).optional(),
  })
  // Allow additional rels like "describedby", "up", "profile", etc.
  .catchall(z.string().min(1));

export type LinkMap = z.infer<typeof LinkMapSchema>;

// ============================================================================
// HEADER SCHEMAS
// ============================================================================

/** Standard Headers - properties are optional but must be strings when present */
export const StandardHeadersSchema = z.object().catchall(z.string());

/**
 * Standard JSON response headers
 */
export const JsonHeadersSchema = StandardHeadersSchema.extend({
  'Content-Type': z.union([z.literal('application/json'), z.string()])
})

export type JsonHeaders = z.infer<typeof JsonHeadersSchema>

/**
 * Pagination response headers (includes RFC 8288 Link header)
 */
export const JsonHeadersWithLinksSchema = JsonHeadersSchema.extend({
  'Link': z.string(),
  'X-Total-Count': z.string().optional(),
  'X-Per-Page': z.string().optional(),
  'X-Page': z.string().optional(),
  'X-Total-Pages': z.string().optional(),
  'Preference-Applied': z.string().optional(),
  'Range-Unit': z.string().optional(),
  'Content-Range': z.string().optional()
})

export type JsonHeadersWithLinks = z.infer<typeof JsonHeadersWithLinksSchema>

/**
 * RFC 7807 problem+json headers
 */
export const ProblemHeadersSchema = StandardHeadersSchema.extend({
  'Content-Type': z.literal('application/problem+json')
})

export type ProblemHeaders = z.infer<typeof ProblemHeadersSchema>

/**
 * Generic standard headers type (for helper function signatures)
 */
export type StandardHeaders = {
  [K in RequestHeader]?: string
} & z.infer<typeof StandardHeadersSchema>

// ============================================================================
// ENVELOPE SCHEMA FACTORIES (for generic data types)
// ============================================================================

/**
 * Create success envelope schema
 * 
 * Structure: { data: T, meta: { timestamp: string, ...custom } }
 * 
 * @example
 * const UserSchema = z.object({ id: z.string(), name: z.string() })
 * const EnvelopeSchema = makeSuccessEnvelopeSchema(UserSchema)
 * type Envelope = z.infer<typeof EnvelopeSchema>
 * // => { data: User, meta: { timestamp: string } }
 */
export function makeSuccessEnvelopeSchema<
  TData extends z.ZodType,
  TMeta extends z.ZodObject<any> = z.ZodObject<{}>
>(
  dataSchema: TData,
  metaSchema?: TMeta
) {
  const baseMeta = z.object({
    timestamp: z.coerce.date(),
  })

  const meta = metaSchema
    ? z.intersection(baseMeta, metaSchema)
    : baseMeta

  return z.object({
    data: dataSchema,
    meta: meta
  })
}

/**
 * Generic success envelope type (for helpers like ok(), created())
 * For actual validation, use makeSuccessEnvelopeSchema()
 */
export interface SuccessEnvelope<T = unknown, M extends DataMetadata = DataMetadata> {
  data: T
  meta: M & { timestamp: string }
}


/**
 * Create pagination envelope schema
 * 
 * Structure: { data: T[], meta: { timestamp: string, pagination: Pagination } }
 * 
 * @example
 * const UserSchema = z.object({ id: z.string(), name: z.string() })
 * const EnvelopeSchema = makePaginationEnvelopeSchema(z.array(UserSchema))
 * type Envelope = z.infer<typeof EnvelopeSchema>
 */
export function makePaginationEnvelopeSchema<TData extends z.ZodType>(
  dataSchema: TData
) {
  return makeSuccessEnvelopeSchema(dataSchema, PaginationMetadataSchema)
}

/**
 * Generic pagination envelope type (for helpers like paginate())
 * For actual validation, use makePaginationEnvelopeSchema()
 */
export type PaginationEnvelope<T = unknown> = SuccessEnvelope<T, PaginationMetadata>

/**
 * Pagination metadata schema (pre-built)
 */
export const PaginationMetadataSchema = DataMetadataSchema.extend({
  pagination: PaginationSchema,
  query: QuerySpecSchema.optional(),
})

export type PaginationMetadata = z.infer<typeof PaginationMetadataSchema>

/**
 * Create contentless result tuple schema
 * For responses with no body (204, 101, 205, 304)
 * 
 * @example
 * const ResultSchema = makeContentlessResultSchema(204)
 * type Result = z.infer<typeof ResultSchema>
 * // => readonly [undefined, 204, JsonHeaders]
 */
export const ContentlessResultSchema = z.tuple([
  z.undefined(),
  ContentfulStatusCodeSchema,
  JsonHeadersSchema
])

/**
 * Generic contentless result tuple type
 * For actual validation, use makeContentlessResultSchema()
 */
export type ContentlessResult = readonly [
  undefined,
  ContentlessStatusCode,
  JsonHeaders
]

// ============================================================================
// RESULT TUPLE SCHEMA FACTORIES
// ============================================================================

/**
 * Create success result tuple schema
 * For responses with data (200, 201, etc.)
 * 
 * @example
 * const UserSchema = z.object({ id: z.string() })
 * const ResultSchema = makeSuccessResultSchema(UserSchema, 200)
 * type Result = z.infer<typeof ResultSchema>
 * // => readonly [{ data: User, meta: { timestamp: string } }, 200, JsonHeaders]
 */
export function makeSuccessResultSchema<
  TData extends z.ZodType
>(
  dataSchema: TData,
  metaSchema?: z.ZodObject<any>
) {
  return z.tuple([
    makeSuccessEnvelopeSchema(dataSchema, metaSchema),
    ContentfulStatusCodeSchema,
    JsonHeadersSchema
  ])
}

/**
 * Generic success result tuple type
 * For actual validation, use makeSuccessResultSchema()
 */
export type GenericSuccessResult<E extends SuccessEnvelope = SuccessEnvelope, H extends JsonHeaders = JsonHeaders> = readonly [
  E,
  ContentfulStatusCode,
  H
]

/**
 * Success Result
 */
export type SuccessResult<T = unknown, M extends DataMetadata = DataMetadata> = GenericSuccessResult<SuccessEnvelope<T, M>>

/**
 * Create pagination result tuple schema
 * Always returns 200 with pagination metadata
 * 
 * @example
 * const UserSchema = z.object({ id: z.string() })
 * const ResultSchema = makePaginationResultSchema(z.array(UserSchema))
 * type Result = z.infer<typeof ResultSchema>
 * // => readonly [{ data: User[], meta: { timestamp: string, pagination: Pagination } }, 200, JsonHeadersWithLinks]
 */
export function makePaginationResultSchema<TData extends z.ZodType>(
  dataSchema: TData
) {
  return z.tuple([
    makePaginationEnvelopeSchema(dataSchema),
    ContentfulStatusCodeSchema,
    JsonHeadersWithLinksSchema
  ])
}

/**
 * Generic pagination result tuple type
 * For actual validation, use makePaginationResultSchema()
 */
export type PaginationResult<T = unknown> = GenericSuccessResult<PaginationEnvelope<T>, JsonHeadersWithLinks>

/**
 * Create error result tuple schema
 * For RFC 7807 error responses
 * 
 * @example
 * const ResultSchema = ErrorResultSchema
 * type Result = z.infer<typeof ResultSchema>
 * // => readonly [ProblemDetails, 404, ProblemHeaders]
 */
export const ErrorResultSchema = z.tuple([
  ProblemDetailsSchema,
  ContentfulStatusCodeSchema,
  ProblemHeadersSchema
])

/**
 * Generic error result tuple type
 * For actual validation, use makeErrorResultSchema()
 */
export type ErrorResult = readonly [
  ProblemDetails,
  ContentfulStatusCode,
  ProblemHeaders
]

/**
 * Create validation errors result tuple schema
 * For 422 responses with multiple field errors
 * 
 * @example
 * const ResultSchema = makeErrorsResultSchema()
 * type Result = z.infer<typeof ResultSchema>
 * // => readonly [ProblemDetailsWithErrors, 422, ProblemHeaders]
 */
export const ErrorsResultSchema = z.tuple([
  ProblemDetailsWithErrorsSchema,
  ContentfulStatusCodeSchema,
  ProblemHeadersSchema
])

/**
 * Generic errors result tuple type (with validation errors array)
 * For actual validation, use makeErrorsResultSchema()
 */
export type ErrorsResult = readonly [
  ProblemDetailsWithErrors,
  ContentfulStatusCode,
  ProblemHeaders
]

// ============================================================================
// RESPONSE UNION SCHEMAS (for comprehensive validation)
// ============================================================================

/**
 * Create success response union schema
 * Includes contentless (204), success, and pagination results
 * 
 * @example
 * const UserSchema = z.object({ id: z.string() })
 * const ResponseSchema = makeSuccessResponseSchema(UserSchema)
 * 
 * // Can validate any of:
 * // - [{ data: User, meta }, 200, JsonHeaders]
 * // - [{ data: User[], meta: { pagination } }, 200, JsonHeadersWithLinks]
 * // - [undefined, 204, JsonHeaders]
 */
export function makeSuccessResponseSchema<TData extends z.ZodType>(
  dataSchema: TData
) {
  return z.union([
    makeSuccessResultSchema(dataSchema),
    makePaginationResultSchema(dataSchema),
    ContentlessResultSchema
  ])
}

/**
 * Union of success response types
 */
export type SuccessResponse<T = unknown> =
  | SuccessResult<T>
  | PaginationResult<T>
  | ContentlessResult

/**
 * Create error response union schema
 * Includes common error status codes
 * 
 * @example
 * const ResponseSchema = ErrorResponseSchema
 * 
 * // Can validate any of:
 * // - [ProblemDetails, 400, ProblemHeaders]
 * // - [ProblemDetails, 404, ProblemHeaders]
 * // - [ProblemDetailsWithErrors, 422, ProblemHeaders]
 * // - [ProblemDetails, 500, ProblemHeaders]
 */
export const ErrorResponseSchema = z.union([
  ErrorResultSchema,
  ErrorsResultSchema
])

/**
 * Union of error response types
 */
export type ErrorResponse =
  | ErrorResult
  | ErrorsResult


/**
 * Create complete response union schema
 * Includes all success and error variants
 * 
 * @example
 * const UserSchema = z.object({ id: z.string() })
 * const ResponseSchema = makeResponseResultSchema(UserSchema)
 * 
 * // Can validate any response tuple from your API
 */
export function makeResponseResultSchema<TData extends z.ZodType>(
  dataSchema: TData
) {
  return z.union([
    makeSuccessResponseSchema(dataSchema),
    ErrorResponseSchema,
  ])
}

/**
 * Union of all response tuple types
 */
export type ResponseResult<T = unknown> =
  | SuccessResponse<T>
  | ErrorResponse