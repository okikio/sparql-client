// utils/query/pagination.ts
/**
 * Cursor-based and offset-based pagination with multi-source support
 * 
 * Features:
 * - Auto-detects cursor vs offset from any source
 * - HMAC-signed cursors with expiration
 * - Configurable limits per endpoint
 * - 410 Gone for expired cursors
 * - Query/JSON/FormData source adapters
 */

import type { CursorPaginationNormalized, OffsetPaginationNormalized, PaginationConfig, SortDirection } from './schemas.ts'
import type { Pagination, PaginationMetadata } from '../response/schemas.ts'
import type { QuerySpec } from './schemas.ts'

import { z } from 'zod'
import { createHmac } from 'node:crypto'
import { Buffer } from 'node:buffer'

import { BaseQuerySchema, BaseJsonSchema, BaseFormSchema, ZStringOrStringArray } from '../endpoint/schemas.ts'
import {
  PaginationNormalizedSchema,
  CursorDataSchema,
  type CursorData,
} from './schemas.ts'
import { badRequest, ok, gone } from '../response/index.ts'
import { isSuccessResponse } from '../response/success.ts'

// ============================================================================
// CURSOR ENCODING/DECODING (existing, unchanged)
// ============================================================================

const EncodedCursorSchema = z.object({
  data: CursorDataSchema,
  signature: z.hex().length(64)
}).strict()

/**
 * @based on `@mofax/sorted-stringify` https://jsr.io/@mofax/sorted-stringify/0.0.4/index.ts
 * Recursively sorts the keys of an object or elements of an array.
 *
 * - If the input is not an object or array, the value is returned as is.
 * - If the input is an array, it recursively sorts each element in the array.
 * - If the input is an object, it sorts the object by its keys and recursively sorts the values.
 *
 * @param obj - The input object, array, or any other value to be sorted.
 * @returns The sorted object, array, or the original value if it's not an object or array.
 *
 * @example
 * ```typescript
 * const obj = {
 *   z: 1,
 *   a: { c: 3, b: 2 },
 *   array: [ { b: 2, a: 1 }, 3 ]
 * };
 * const sortedObj = sortObj(obj);
 * console.log(sortedObj);
 * // Output:
 * // {
 * //   a: { b: 2, c: 3 },
 * //   array: [ { a: 1, b: 2 }, 3 ],
 * //   z: 1
 * // }
 * ```
 */
export function sortObject<T>(obj: T): T {
  if (obj instanceof Date) return obj.toISOString() as T; // normalize precision
  if (obj == null || typeof obj !== "object") return obj;
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return obj as T;
  if (Array.isArray(obj)) return obj.map(sortObject) as T;

  return Object.entries(obj)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .reduce((sortedObj: Record<string, unknown>, [key, value]) => {
      sortedObj[key] = sortObject(value);
      return sortedObj;
    }, {}) as T;
}

/**
 * Codec: string (base64url JSON)  <->  { data, signature }
 * - decode(): wire -> structured
 * - encode(): structured -> wire
 *
 * Note: defaults/prefaults apply in forward (decode) direction,
 * not in backward (encode) direction. Keep that in mind. 
 */
export const Base64UrlJsonCursorCodec = z.codec(
  z.string(),                // wire type (Input)
  EncodedCursorSchema,       // domain type (Output)
  {
    decode: (token) => {
      // base64url decode
      const decoded = Buffer.from(token, 'base64url').toString('utf-8')
      const parsed = JSON.parse(decoded)
      return parsed;
    },
    encode: (obj) => {
      const json = JSON.stringify(obj)
      return Buffer.from(json).toString('base64url');
    },
  }
);

export function hmacSha256Hex(secret: string, payload: unknown): string {
  // Important: canonicalize to avoid key-order signature drift.
  // If you don't have a stable stringify util, ensure 'data' is serialized consistently.
  // The order of the objects keys affects how the object is stringified
  const data = sortObject(payload);
  const json = JSON.stringify(data);
  return createHmac("sha256", secret)
    .update(json)
    .digest("hex");
}

/**
 * Decode + verify a cursor token. Return domain result or throw mapped HTTP errors.
 * - 400 if format/signature invalid
 * - 410 if expired
 */
export function decodeAndVerifyCursor(
  token: string,
  secret: string,
  ttlSeconds = 86_400, // 24h
) {
  // 1) Decode token -> { data, signature }
  const decoded = Base64UrlJsonCursorCodec.decode(token);
  const parsed = EncodedCursorSchema.safeParse(decoded);

  if (!parsed.success) {
    // Map Zod issues to your error envelope at the HTTP boundary:
    return badRequest(token, `Invalid cursor: ${parsed.error.issues?.[0]?.message}`)
  }

  const { data, signature } = parsed.data;

  // 2) Verify HMAC
  const expected = hmacSha256Hex(secret, data);
  if (signature !== expected) {
    return badRequest(token, "Cursor signature mismatch")
  }

  // 3) Verify TTL (use epoch seconds; avoid Date#getDate bug)
  const nowSec = Math.floor(Date.now() / 1000);
  const createdSec = Math.floor(data.createdAt.getTime() / 1000);
  const age = nowSec - createdSec;

  if (age > ttlSeconds) {
    return gone(String(age), `Cursor has expired (${age - ttlSeconds})`, {
      deltaSeconds: age - ttlSeconds,
    });
  }

  // 4) Success: return normalized CursorData
  return ok<CursorData>(data, 200);
}

/**
 * Create a new signed cursor token from CursorData.
 */
export function encodeCursor(data: CursorData, secret: string): string {
  const envelope = Object.assign({}, {
    data,
    signature: hmacSha256Hex(secret, data),
  });

  return Base64UrlJsonCursorCodec.encode(envelope);
}

// ============================================================================
// SOURCE ADAPTERS
// ============================================================================

// Query wire schema (raw incoming)
export const PaginationQueryWire = BaseQuerySchema.extend({
  offset: ZStringOrStringArray.optional(),
  limit: ZStringOrStringArray.optional(),
  page: ZStringOrStringArray.optional(),
  per_page: ZStringOrStringArray.optional(),
  cursor: ZStringOrStringArray.optional()
})

// JSON wire schema (raw incoming)
export const PaginationJsonWire = BaseJsonSchema; // you already have this

// Form wire schema (raw incoming)
export const PaginationFormWire = BaseFormSchema;

// Extract first value if array
const getString = (val: unknown): string | undefined => {
  if (Array.isArray(val)) return val[0]
  if (typeof val === 'string') return val
  return undefined
}

// Extract first value of a specific key if array of string
const pickForm = (raw: Record<string, unknown>, key: string): string | undefined => {
  const val = getString(raw[key])
  if (val) return String(val)
  return val
}


/**
 * Query parameter adapter (extends BaseQuerySchema)
 * Supports: ?offset=0&limit=20, ?page=1&per_page=20, ?cursor=abc&limit=20
 */
export function createPaginationQueryAdapter(defaultLimit: number = 20) {
  return z.codec(
    PaginationQueryWire,                 // Input (wire)
    PaginationNormalizedSchema,          // Output (normalized)
    {
      decode: (raw) => {
        const cursor = getString(raw.cursor)
        const offset = getString(raw.offset)
        const page = getString(raw.page)
        const limit = getString(raw.limit)
        const perPage = getString(raw.per_page)

        // Cursor-based
        if (cursor !== undefined) {
          return {
            type: 'cursor',
            cursor: cursor || undefined,
            limit: parseInt(limit ?? String(defaultLimit), 10)
          } as CursorPaginationNormalized
        }

        // Page-based
        if (page !== undefined) {
          const pageNum = parseInt(page, 10)
          const limitNum = parseInt(perPage ?? limit ?? String(defaultLimit), 10)
          return {
            type: 'offset',
            offset: (pageNum - 1) * limitNum,
            limit: limitNum
          } as OffsetPaginationNormalized
        }

        // Offset-based
        return {
          type: 'offset',
          offset: parseInt(offset ?? '0', 10),
          limit: parseInt(limit ?? String(defaultLimit), 10)
        } as OffsetPaginationNormalized
      },
      // optional if you want to emit back out to wire shape:
      encode: (norm) => {
        if (norm.type === "cursor") {
          return {
            cursor: norm.cursor,
            limit: String(norm.limit),
          } as z.input<typeof PaginationQueryWire>;
        }
        return {
          offset: String(norm.offset),
          limit: String(norm.limit),
        } as z.input<typeof PaginationQueryWire>;
      },
    })
}

/**
 * JSON body adapter (uses BaseJsonSchema)
 * Expects: { pagination: { type: 'cursor', cursor: '...', limit: 20 } }
 */
export function createPaginationJsonAdapter(defaultLimit: number = 20) {
  const JsonEnvelope = z.object({
    pagination: PaginationNormalizedSchema.optional().default({
      type: 'offset',
      offset: 0,
      limit: defaultLimit
    })
  })

  return z.codec(
    BaseJsonSchema,                 // Input wire (your BaseJsonSchema)
    PaginationNormalizedSchema,         // Output normalized
    {
      decode: (raw) => JsonEnvelope.parse(raw).pagination,
      encode: (norm) => ({ pagination: norm }) as z.input<typeof BaseJsonSchema>,
    }
  );
}

/**
 * FormData adapter (uses makeBaseFormSchema)
 * Supports same params as query adapter
 */
export function createPaginationFormAdapter(defaultLimit: number = 20) {
  return z.codec(
    PaginationFormWire,                 // Input wire
    PaginationNormalizedSchema,         // Output normalized
    {
      decode: (raw) => {
        const cursor = pickForm(raw, 'cursor')
        const offset = pickForm(raw, 'offset')
        const page = pickForm(raw, 'page')
        const limit = pickForm(raw, 'limit')
        const perPage = pickForm(raw, 'per_page')

        // Cursor-based
        if (cursor !== undefined) {
          return {
            type: 'cursor',
            cursor: cursor || undefined,
            limit: parseInt(limit ?? String(defaultLimit), 10)
          } as CursorPaginationNormalized
        }

        // Page-based
        if (page !== undefined) {
          const pageNum = parseInt(page, 10)
          const limitNum = parseInt(perPage ?? limit ?? String(defaultLimit), 10)
          return {
            type: 'offset',
            offset: (pageNum - 1) * limitNum,
            limit: limitNum
          } as OffsetPaginationNormalized
        }

        // Offset-based
        return {
          type: 'offset',
          offset: parseInt(offset ?? '0', 10),
          limit: parseInt(limit ?? String(defaultLimit), 10)
        } as OffsetPaginationNormalized
      },
      encode: (norm) => {
        if (norm.type === "cursor")
          return {
            cursor: norm.cursor,
            limit: String(norm.limit)
          } as z.infer<typeof PaginationFormWire>;

        return {
          offset: String(norm.offset),
          limit: String(norm.limit)
        } as z.infer<typeof PaginationFormWire>;
      },
    })
}

// ============================================================================
// SCHEMA COMPOSITION WITH VALIDATION
// ============================================================================

/**
 * Create endpoint-specific pagination schema with validation
 * All validation happens in .superRefine() so middleware handles errors
 */
export function createPaginationSchema(config: {
  source: 'query' | 'json' | 'form'
} & PaginationConfig) {
  const limits = config.limits ?? {} as NonNullable<PaginationConfig['limits']>
  const defaultLimit = config.limits?.defaultLimit ?? 20

  const adapter =
    config.source === 'query' ? createPaginationQueryAdapter(defaultLimit) :
    config.source === 'json' ? createPaginationJsonAdapter(defaultLimit) :
    createPaginationFormAdapter(defaultLimit)

  return adapter.superRefine((pagination, ctx) => {
    // Validate limits
    if (pagination.limit < limits.minLimit) {
      ctx.addIssue({
        code: "too_small",
        minimum: limits.minLimit,
        origin: "number",
        path: ['limit'],
        message: `Limit must be between ${limits.minLimit} and ${limits.maxLimit} (exclusive), got ${pagination.limit}`,
        input: ctx.value
      })
    }

    if (pagination.limit > limits.maxLimit) {
      ctx.addIssue({
        code: "too_big",
        maximum: limits.maxLimit,
        origin: "number",
        path: ['limit'],
        message: `Limit must be between ${limits.minLimit} and ${limits.maxLimit} (exclusive), got ${pagination.limit}`,
        input: ctx.value
      })
    }

    // Validate offset for DoS protection
    if (pagination.type === 'offset' && pagination.offset > limits.maxOffset) {
      ctx.addIssue({
        code: "too_big",
        maximum: limits.maxOffset,
        origin: "number",
        path: ['offset'],
        message: `Offset cannot exceed ${limits.maxOffset} (DoS protection), got ${pagination.offset}`,
        input: ctx.value
      })
    }

    // Decode cursor if present (execution-time error, not validation)
    if (pagination.type === 'cursor' && pagination.cursor && config.cursorSecret) {
      const result = decodeAndVerifyCursor(pagination.cursor, config.cursorSecret, limits.cursorTTL);
      if (isSuccessResponse(result)) {
        // Mutation is safe here - Zod creates new object per parse
        const [decoded] = result
        pagination.decodedCursor = decoded.data
      } else { 
        const [error] = result
        ctx.addIssue({
          code: "custom",
          path: ['decodedCursor'],
          message: error.detail || 'Invalid or expired cursor',
          input: ctx.value
        })
      }
    }
  })
}

// ============================================================================
// RESPONSE GENERATION (existing, mostly unchanged)
// ============================================================================

/**
 * Create CursorData from a DB row.
 * Keep this close to the query code so it's obvious which fields drive the cursor.
 *
 * @example
 *   const head = rows[0], tail = rows[rows.length - 1]
 *   const nextData  = cursorFromRow(tail,  { sortField: "created_at", tiebreaker: "id", direction: "asc"  })
 *   const prevData  = cursorFromRow(head,  { sortField: "created_at", tiebreaker: "id", direction: "desc" })
 */
export function cursorFromRow<Row extends Record<string, unknown>>(row: Row, cfg: {
  sortField: string;
  tiebreaker: string;
  direction: SortDirection;
}): CursorData {
  const sortValue = row[cfg.sortField];
  const tieValue = row[cfg.tiebreaker];

  // Normalize known primitives; let CursorDataSchema enforce the rest.
  const data = Object.assign({}, {
    sortField: cfg.sortField,
    sortValue: sortValue as unknown,
    tiebreaker: cfg.tiebreaker,
    tiebreakerValue: tieValue as string | number,
    direction: cfg.direction,
    createdAt: new Date(), // mint time the cursor was issued
  });

  // Validate to keep types honest
  return CursorDataSchema.parse(data);
}

/**
 * Compute next/prev tokens for keyset pages.
 * - `hasMoreForward`: whether there are more rows after the last one you returned.
 * - `hasMoreBackward`: whether there are rows before the first one (optional; set if you probe backward).
 */
export function makeCursorTokens<Row extends Record<string, unknown>>(args: {
  items: Row[];
  limit: number;
  sortField: string;
  tiebreaker: string;
  secret: string;
  direction: "asc" | "desc";
  hasMoreForward: boolean;
  hasMoreBackward?: boolean;
}) {
  const count = args.items.length;
  if (count === 0) {
    return Object.assign({}, {
      next: undefined as string | undefined,
      prev: undefined as string | undefined
    });
  }

  const head = args.items[0];
  const tail = args.items[count - 1];

  // For "next" we point past the last item we actually returned.
  const nextData: CursorData | undefined = args.hasMoreForward
    ? cursorFromRow(tail, { sortField: args.sortField, tiebreaker: args.tiebreaker, direction: args.direction })
    : undefined;

  // For "prev" we point before the first item; invert direction to walk back.
  const prevData: CursorData | undefined = args.hasMoreBackward
    ? cursorFromRow(head, { sortField: args.sortField, tiebreaker: args.tiebreaker, direction: args.direction === "asc" ? "desc" : "asc" })
    : undefined;

  return Object.assign({}, {
    next: nextData ? encodeCursor(nextData, args.secret) : undefined,
    prev: prevData ? encodeCursor(prevData, args.secret) : undefined,
  });
}

/**
 * Computes a page expiry timestamp (ISO) from:
 * - The cursor TTL policy (if cursor pagination)
 * - An optional global page TTL (offset pagination or policy override)
 *
 * Semantics:
 * - If you minted a "next" cursor, its expiry governs page expiry.
 * - If both "next" and "prev" exist, choose the earliest.
 * - If neither cursor exists (e.g., empty result or offset mode), use a global TTL (optional).
 */
export function computeExpiresAt(opts: {
  now?: Date;                 // for testability
  ttlSecs?: number;  // same units you pass to decode/verify
  hasCursor?: boolean;
}): Date | undefined {
  const now = opts.now ?? new Date()
  if (opts.hasCursor && typeof opts.ttlSecs === 'number') {
    const expiry = new Date(now.getTime() + opts.ttlSecs * 1000)
    return expiry
  }
  return undefined
}

/**
 * Comprehensive pagination bridge.
 * - Trims rows via limit+1 strategy
 * - Computes hasMore
 * - Generates next/prev cursor tokens (cursor mode)
 * - Computes next/prev offsets (offset mode)
 * - Optionally computes expiresAt from TTL
 */
export function buildPaginationMeta<Row extends Record<string, unknown>>(args: {
  rows: Row[];
  query: QuerySpec;
  sortField?: string;
  tiebreaker?: string;
  direction?: "asc" | "desc";
  secret?: string;
  ttlSec?: number; // optional TTL for expiresAt
  total?: number;
  approxTotal?: number;
}): { items: Row[]; } & PaginationMetadata {
  const { rows, query } = args;
  const limit = query.pagination.limit;

  // finalizePage logic
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  // common base
  const base: Pagination = {
    hasMore,
    limit,
    count: items.length,
    total: args.total,
    approxTotal: args.approxTotal,
  };

  if (query.pagination.type === "cursor") {
    const { sortField = "id", tiebreaker = "id", direction = "asc", secret = "" } = args;

    const { next, prev } = makeCursorTokens({
      items,
      limit,
      sortField,
      tiebreaker,
      secret,
      direction,
      hasMoreForward: hasMore,
      // hasMoreBackward could be probed separately if needed
    });

    // optional expiry
    if (args.ttlSec && args.ttlSec > 0) {
      const expiresAt = computeExpiresAt({
        ttlSecs: args.ttlSec,
        hasCursor: query.pagination.type === "cursor"
      })
      base.expiresAt = expiresAt;
    }

    return {
      items,
      pagination: {
        ...base,
        nextCursor: next,
        prevCursor: prev,
      },
      query
    };
  }

  if (query.pagination.type === "offset") {
    const nextOffset = hasMore ? query.pagination.offset + limit : undefined;
    const prevOffset = query.pagination.offset > 0 ? Math.max(0, query.pagination.offset - limit) : undefined;

    return {
      items,
      pagination: {
        ...base,
        offset: query.pagination.offset,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        ...(prevOffset !== undefined ? { prevOffset } : {}),
      },
      query
    };
  }

  // exhaustive guard
  return { items, pagination: base };
}
