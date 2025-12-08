/**
 * RFC 7807 + Success Envelope Utilities for Hono
 * ------------------------------------------------
 * - Canonical status titles & problem type/docs registries
 * - Strict tuples for success & error responses (stable 3-tuple shape)
 * - Convenience error factories for all common HTTP errors
 * - Success helpers: ok, created (201 + Location), accepted (202), noContent (204), paginate
 * - errs() + validationFailed() for multi-error payloads
 * - Header utilities: extraProblemHeaders() and withHeaders() with precise typing
 *
 * Notes
 * - Uses Object.assign for meta/header building to match your style preferences.
 * - Avoids `any` in public types; no unsafe casts in user-facing APIs.
 * - ESM-friendly, Deno v2 / TS strict, tree-shakeable.
 */

export type * from "./schemas.ts";
export * from "./errors.ts";
export * from "./success.ts";
export * from "./status-codes.ts"

// ============================================================================
// Quick usage examples (copy/paste into handlers)
// ============================================================================
//
// // OK
// return c.json(...ok({ id: 'like-1' }))
//
// // Created + Location
// const res = created({ id }, `/api/things/${id}`)
// return c.json(...withHeaders(res, { Location: `/api/things/${id}` }))
//
// // Rate limited with Retry-After header
// const err429 = rateLimitExceeded(c.req.path, 120)
// return c.json(...withHeaders(err429, extraProblemHeaders(429, { retryAfter: 120 })))
//
// // Validation
// return c.json(...validationFailed(c.req.path, [{ field: 'email', message: 'Invalid' }]))
//
// // Status-agnostic
// return c.json(...err(404, c.req.path, 'Thing not found'))
